import { getLocal, getSession, getSettings, newId, setLocal, setSession } from '../lib/storage';
import { containsNode, findNode, insertNode, isFolder, removeNode, walkEntries } from '../lib/tree';
import type {
  ArchivedTab,
  BulkOp,
  SelectionItem,
  DropTarget,
  Entry,
  Layout,
  PinnedNode,
  Settings,
} from '../lib/types';
import { isLauncherUrl, isStorableIcon } from '../lib/url';
import { parseImport } from '../lib/backup';
import { FOLDER_ICONS } from '../lib/folderIcons';

const MAX_ARCHIVE = 2000;

// Everything in this module assumes it is already running inside `serial`.

function findAnywhere(layout: Layout, id: string): PinnedNode | undefined {
  return layout.favorites.find((f) => f.id === id) ?? findNode(layout.pinned, id);
}

function removeAnywhere(layout: Layout, id: string): PinnedNode | undefined {
  const favIdx = layout.favorites.findIndex((f) => f.id === id);
  if (favIdx >= 0) return layout.favorites.splice(favIdx, 1)[0];
  return removeNode(layout.pinned, id);
}

function insertAt(layout: Layout, node: PinnedNode, target: DropTarget): boolean {
  if (target.zone === 'favorites') {
    if (node.kind !== 'entry') return false;
    const idx = target.beforeId ? layout.favorites.findIndex((f) => f.id === target.beforeId) : -1;
    if (idx >= 0) layout.favorites.splice(idx, 0, node);
    else layout.favorites.push(node);
    return true;
  }
  if (target.zone === 'pinned') {
    insertNode(layout.pinned, node, target.parentId, target.beforeId);
    return true;
  }
  return false;
}

export async function focusTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

export async function openEntry(id: string, windowId: number): Promise<void> {
  const [layout, bindings] = await Promise.all([getLocal('layout'), getSession('bindings')]);
  const entry = findAnywhere(layout, id);
  if (entry?.kind !== 'entry') return;
  const bound = bindings[id];
  if (bound !== undefined) {
    await focusTab(bound);
    return;
  }
  const tab = await chrome.tabs.create({ url: entry.url, windowId, active: true });
  if (tab.id !== undefined) {
    bindings[id] = tab.id;
    await setSession('bindings', bindings);
  }
}

export async function closeEntryTab(id: string): Promise<void> {
  const bindings = await getSession('bindings');
  if (bindings[id] !== undefined) await chrome.tabs.remove(bindings[id]);
}

export async function resetEntry(id: string): Promise<void> {
  const [layout, bindings] = await Promise.all([getLocal('layout'), getSession('bindings')]);
  const entry = findAnywhere(layout, id);
  if (entry?.kind === 'entry' && bindings[id] !== undefined) {
    await chrome.tabs.update(bindings[id], { url: entry.url });
  }
}

export async function renameNode(id: string, title: string): Promise<void> {
  const layout = await getLocal('layout');
  const node = findAnywhere(layout, id);
  if (!node) return;
  const trimmed = title.trim();
  if (node.kind === 'folder') {
    if (trimmed) node.title = trimmed;
  } else if (trimmed && trimmed !== node.title) {
    node.customTitle = trimmed;
  } else {
    delete node.customTitle;
  }
  await setLocal('layout', layout);
}

export async function setFolderIcon(id: string, icon: string | undefined): Promise<void> {
  const layout = await getLocal('layout');
  const node = findAnywhere(layout, id);
  if (node?.kind !== 'folder') return;
  if (icon && Object.hasOwn(FOLDER_ICONS, icon)) node.icon = icon;
  else delete node.icon;
  await setLocal('layout', layout);
}

export async function renameTab(tabId: number, title: string): Promise<void> {
  const bindings = await getSession('bindings');
  const entryId = Object.keys(bindings).find((id) => bindings[id] === tabId);
  if (entryId) {
    await renameNode(entryId, title);
    return;
  }
  const [meta, tab] = await Promise.all([getSession('tabMeta'), chrome.tabs.get(tabId)]);
  const now = Date.now();
  const current = meta[tabId] ?? { createdAt: now, lastActiveAt: now };
  const trimmed = title.trim();
  if (trimmed && trimmed !== tab.title) current.customTitle = trimmed;
  else delete current.customTitle;
  meta[tabId] = current;
  await setSession('tabMeta', meta);
}

export async function pinTab(tabId: number, target: DropTarget): Promise<void> {
  if (target.zone === 'today') return;
  const [layout, bindings, meta, tab] = await Promise.all([
    getLocal('layout'),
    getSession('bindings'),
    getSession('tabMeta'),
    chrome.tabs.get(tabId),
  ]);
  if (!tab.url || Object.values(bindings).includes(tabId)) return;
  const entry: Entry = { kind: 'entry', id: newId(), url: tab.url, title: tab.title ?? tab.url };
  if (meta[tabId]?.customTitle) entry.customTitle = meta[tabId].customTitle;
  if (isStorableIcon(tab.favIconUrl)) entry.favIconUrl = tab.favIconUrl;
  if (!insertAt(layout, entry, target)) return;
  bindings[entry.id] = tabId;
  await Promise.all([setLocal('layout', layout), setSession('bindings', bindings)]);
}

/** Removes a favorite, pinned entry, or folder. Open tabs stay open and fall into Today. */
export async function unpinNode(id: string): Promise<void> {
  const [layout, bindings, meta] = await Promise.all([
    getLocal('layout'),
    getSession('bindings'),
    getSession('tabMeta'),
  ]);
  const removed = removeAnywhere(layout, id);
  if (!removed) return;
  const now = Date.now();
  for (const entry of walkEntries([removed])) {
    const tabId = bindings[entry.id];
    if (tabId === undefined) continue;
    delete bindings[entry.id];
    meta[tabId] = { ...(meta[tabId] ?? { lastActiveAt: now }), createdAt: now };
    if (entry.customTitle) meta[tabId].customTitle = entry.customTitle;
  }
  await Promise.all([
    setLocal('layout', layout),
    setSession('bindings', bindings),
    setSession('tabMeta', meta),
  ]);
}

export async function moveNode(id: string, target: DropTarget): Promise<void> {
  if (target.zone === 'today') {
    // Unpinning by drag only makes sense for an open tab; anything else would silently delete pins.
    const [layout, bindings] = await Promise.all([getLocal('layout'), getSession('bindings')]);
    if (findAnywhere(layout, id)?.kind === 'entry' && bindings[id] !== undefined) await unpinNode(id);
    return;
  }
  const layout = await getLocal('layout');
  const node = findAnywhere(layout, id);
  if (!node || target.beforeId === id) return;
  if (target.zone === 'favorites' && node.kind !== 'entry') return;
  if (target.zone === 'pinned' && target.parentId && containsNode(node, target.parentId)) return;
  if (target.zone === 'pinned' && target.parentId && !isFolder(findNode(layout.pinned, target.parentId))) {
    return;
  }
  removeAnywhere(layout, id);
  insertAt(layout, node, target);
  await setLocal('layout', layout);
}

/** Removes a folder but keeps its contents, moving them to where the folder was. */
export async function deleteFolder(id: string): Promise<void> {
  const layout = await getLocal('layout');
  const lift = (nodes: PinnedNode[]): boolean => {
    const idx = nodes.findIndex((n) => n.id === id);
    const node = nodes[idx];
    if (isFolder(node)) {
      nodes.splice(idx, 1, ...node.children);
      return true;
    }
    return nodes.some((n) => isFolder(n) && lift(n.children));
  };
  if (lift(layout.pinned)) await setLocal('layout', layout);
}

export async function createFolder(title: string, id = newId()): Promise<void> {
  const layout = await getLocal('layout');
  layout.pinned.unshift({
    kind: 'folder',
    id,
    title: title.trim() || 'New Folder',
    collapsed: false,
    children: [],
  });
  await setLocal('layout', layout);
}

export async function setFolderCollapsed(id: string, collapsed: boolean): Promise<void> {
  const layout = await getLocal('layout');
  const node = findNode(layout.pinned, id);
  if (!isFolder(node) || node.collapsed === collapsed) return;
  node.collapsed = collapsed;
  await setLocal('layout', layout);
}

export async function toggleFolder(id: string): Promise<void> {
  const layout = await getLocal('layout');
  const node = findNode(layout.pinned, id);
  if (!isFolder(node)) return;
  node.collapsed = !node.collapsed;
  await setLocal('layout', layout);
}

export async function archiveTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
  if (tabs.length === 0) return;
  const [archive, meta] = await Promise.all([getLocal('archive'), getSession('tabMeta')]);
  const now = Date.now();
  // Close one by one: a batch remove fails entirely if any single tab can't be closed.
  const results = await Promise.allSettled(
    tabs.map(async (t) => {
      if (t.id === undefined) throw new Error('tab has no id');
      await chrome.tabs.remove(t.id);
      return t;
    }),
  );
  const closed = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const added: ArchivedTab[] = closed
    .filter((t) => t.url && !isLauncherUrl(t.url) && !t.url.startsWith('chrome://newtab'))
    .map((t) => {
      const customTitle = t.id !== undefined ? meta[t.id]?.customTitle : undefined;
      return {
        id: newId(),
        url: t.url as string,
        title: customTitle || t.title || (t.url as string),
        ...(customTitle ? { customTitle } : {}),
        archivedAt: now,
      };
    });
  if (added.length === 0) return;
  const addedUrls = new Set(added.map((a) => a.url));
  const next = [...added, ...archive.filter((a) => !addedUrls.has(a.url))].slice(0, MAX_ARCHIVE);
  await setLocal('archive', next);
}

export async function setTabCustomTitle(tabId: number, customTitle: string): Promise<void> {
  const meta = await getSession('tabMeta');
  const now = Date.now();
  meta[tabId] = { ...(meta[tabId] ?? { createdAt: now, lastActiveAt: now }), customTitle };
  await setSession('tabMeta', meta);
}

export async function takeArchived(id: string): Promise<ArchivedTab | undefined> {
  const archive = await getLocal('archive');
  const idx = archive.findIndex((a) => a.id === id);
  if (idx < 0) return undefined;
  const [item] = archive.splice(idx, 1);
  await setLocal('archive', archive);
  return item;
}

export async function restoreArchived(id: string, windowId: number): Promise<void> {
  const item = await takeArchived(id);
  if (!item) return;
  const tab = await chrome.tabs.create({ url: item.url, windowId, active: true });
  if (tab.id !== undefined && item.customTitle) await setTabCustomTitle(tab.id, item.customTitle);
}

export async function deleteArchived(id: string): Promise<void> {
  await takeArchived(id);
}

export async function purgeArchive(): Promise<void> {
  const [archive, settings] = await Promise.all([getLocal('archive'), getSettings()]);
  const cutoff = Date.now() - settings.archiveRetentionDays * 86_400_000;
  const kept = archive.filter((a) => a.archivedAt >= cutoff);
  if (kept.length !== archive.length) await setLocal('archive', kept);
}

/** Makes the page a pinned tab is on now its saved URL (and name/icon source). */
export async function setEntryUrl(id: string): Promise<void> {
  const [layout, bindings] = await Promise.all([getLocal('layout'), getSession('bindings')]);
  const entry = findAnywhere(layout, id);
  const tabId = bindings[id];
  if (entry?.kind !== 'entry' || tabId === undefined) return;
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || tab.url === entry.url) return;
  entry.url = tab.url;
  entry.title = tab.title || tab.url;
  if (isStorableIcon(tab.favIconUrl)) entry.favIconUrl = tab.favIconUrl;
  else delete entry.favIconUrl;
  await setLocal('layout', layout);
}

/**
 * Applies one action to a multi-selection. Items are handled in sidebar order so pinned
 * results keep the order they were selected in. Ops that don't apply to an item skip it.
 */
export async function bulk(op: BulkOp, items: SelectionItem[], folderId?: string): Promise<void> {
  const tabIds = items.flatMap((i) => (i.kind === 'tab' ? [i.tabId] : []));
  const entryIds = items.flatMap((i) => (i.kind === 'node' ? [i.id] : []));

  if (op === 'close' || op === 'archive') {
    const bindings = await getSession('bindings');
    const entryTabs = entryIds.map((id) => bindings[id]).filter((t) => t !== undefined);
    if (op === 'archive') {
      const tabs = await Promise.all(tabIds.map((id) => chrome.tabs.get(id).catch(() => undefined)));
      await archiveTabs(tabs.filter((t) => t !== undefined));
    }
    const toClose = op === 'close' ? [...tabIds, ...entryTabs] : entryTabs;
    await Promise.allSettled(toClose.map((id) => chrome.tabs.remove(id)));
    return;
  }
  if (op === 'unpin') {
    for (const id of entryIds) await unpinNode(id);
    return;
  }

  const target: DropTarget =
    op === 'favorite'
      ? { zone: 'favorites' }
      : op === 'moveToFolder' && folderId
        ? { zone: 'pinned', parentId: folderId }
        : { zone: 'pinned' };
  for (const tabId of tabIds) await pinTab(tabId, target);
  if (op !== 'pin') {
    for (const id of entryIds) await moveNode(id, target);
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(await getSettings()), ...patch };
  if (!next.sidebarColor) delete next.sidebarColor;
  if (!next.sidebarGrain) delete next.sidebarGrain;
  if (!next.profileLabel?.trim()) delete next.profileLabel;
  else next.profileLabel = next.profileLabel.trim();
  await setLocal('settings', next);
}

export async function importData(data: unknown): Promise<void> {
  const parsed = parseImport(data);
  if (parsed.layout) {
    await setLocal('layout', parsed.layout);
    await setSession('bindings', {});
  }
  if (parsed.archive) await setLocal('archive', parsed.archive);
  if (Object.keys(parsed.settings).length) await updateSettings(parsed.settings);
}
