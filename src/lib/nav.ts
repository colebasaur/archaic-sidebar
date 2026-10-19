import { todayTabs, type TabLike } from './order';
import { findNode } from './tree';
import type { CursorPos, Layout, PinnedNode, TabMeta } from './types';

export type SidebarItem =
  | { kind: 'entry'; id: string; tabId?: number; parentId?: string }
  | { kind: 'folder'; id: string; collapsed: boolean; parentId?: string }
  | { kind: 'tab'; tabId: number };

export type NavAction = 'up' | 'down' | 'in' | 'out';

export interface NavPlan {
  /** Expand/collapse a folder before moving. */
  setCollapsed?: { id: string; collapsed: boolean };
  /** Switch to an open tab; the cursor then follows the active tab. */
  activate?: number;
  /** Rest the cursor on an item that isn't an open tab here (a folder or closed pin). */
  cursor?: CursorPos;
  /** Open a closed pinned entry. */
  open?: string;
}

/**
 * Everything the cursor can stop on, in display order: favorites, the pinned tree
 * (skipping collapsed folders' contents), then Today. `tabId` is only set on entries whose
 * tab lives in this window; anything else counts as closed here.
 */
export function sidebarItems<T extends TabLike>(
  layout: Layout,
  windowTabs: T[],
  bindings: Record<string, number>,
  tabMeta: Record<number, TabMeta>,
): SidebarItem[] {
  const inWindow = new Set(windowTabs.map((t) => t.id));
  const tabFor = (entryId: string) =>
    inWindow.has(bindings[entryId]) ? bindings[entryId] : undefined;

  const items: SidebarItem[] = layout.favorites.map((f) => ({
    kind: 'entry',
    id: f.id,
    tabId: tabFor(f.id),
  }));
  const walk = (nodes: PinnedNode[], parentId?: string) => {
    for (const n of nodes) {
      if (n.kind === 'entry') {
        items.push({ kind: 'entry', id: n.id, tabId: tabFor(n.id), parentId });
      } else {
        items.push({ kind: 'folder', id: n.id, collapsed: n.collapsed, parentId });
        if (!n.collapsed) walk(n.children, n.id);
      }
    }
  };
  walk(layout.pinned);
  for (const t of todayTabs(windowTabs, bindings, tabMeta)) {
    items.push({ kind: 'tab', tabId: t.id as number });
  }
  return items;
}

/** The stored cursor if it still points at something visible, else the active tab's row. */
export function cursorIndex(
  items: SidebarItem[],
  cursor: CursorPos | undefined,
  activeTabId: number | undefined,
): number {
  if (cursor) {
    const idx = items.findIndex((it) =>
      cursor.kind === 'tab'
        ? it.kind === 'tab' && it.tabId === cursor.tabId
        : it.kind !== 'tab' && it.id === cursor.id,
    );
    if (idx >= 0) return idx;
  }
  return items.findIndex((it) => it.kind !== 'folder' && it.tabId === activeTabId);
}

function landOn(item: SidebarItem): NavPlan {
  if (item.kind === 'tab') return { activate: item.tabId };
  if (item.kind === 'entry' && item.tabId !== undefined) return { activate: item.tabId };
  return { cursor: { kind: 'node', id: item.id } };
}

export function planNav(
  layout: Layout,
  items: SidebarItem[],
  index: number,
  action: NavAction,
  bindingsInWindow: (entryId: string) => number | undefined,
): NavPlan {
  if (items.length === 0) return {};
  if (action === 'up' || action === 'down') {
    const delta = action === 'down' ? 1 : -1;
    const next =
      index < 0
        ? delta > 0
          ? 0
          : items.length - 1
        : (index + delta + items.length) % items.length;
    return landOn(items[next]);
  }

  const item = items[index];
  if (!item) return {};

  if (action === 'in') {
    if (item.kind === 'entry' && item.tabId === undefined) return { open: item.id };
    if (item.kind !== 'folder') return {};
    const folder = findNode(layout.pinned, item.id);
    const child = folder?.kind === 'folder' ? folder.children[0] : undefined;
    const plan: NavPlan = item.collapsed ? { setCollapsed: { id: item.id, collapsed: false } } : {};
    if (!child) return plan;
    const childItem: SidebarItem =
      child.kind === 'entry'
        ? { kind: 'entry', id: child.id, tabId: bindingsInWindow(child.id), parentId: item.id }
        : { kind: 'folder', id: child.id, collapsed: child.collapsed, parentId: item.id };
    return { ...plan, ...landOn(childItem) };
  }

  if (item.kind === 'folder' && !item.collapsed) {
    return { setCollapsed: { id: item.id, collapsed: true }, cursor: { kind: 'node', id: item.id } };
  }
  if (item.kind !== 'tab' && item.parentId) {
    return {
      setCollapsed: { id: item.parentId, collapsed: true },
      cursor: { kind: 'node', id: item.parentId },
    };
  }
  return {};
}
