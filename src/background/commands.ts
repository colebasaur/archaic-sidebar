import { cursorIndex, planNav, sidebarItems, type NavAction } from '../lib/nav';
import { getLocal, getSession, setSession } from '../lib/storage';
import { walkEntries } from '../lib/tree';
import { cleanUrl, markdownLink } from '../lib/url';
import {
  archiveTabs,
  closeEntryTab,
  openEntry,
  pinTab,
  resetEntry,
  restoreArchived,
  setFolderCollapsed,
  unpinNode,
} from './actions';
import { copyText } from './clipboard';
import { backfillIcons } from './icons';
import { openLauncherOverlay } from './launcher';
import { serial } from './serial';
import { openSidepanel, toggleSidepanel } from './sidepanel';
import { entryIdForTab } from './tabs';

async function displayTitle(tab: chrome.tabs.Tab): Promise<string> {
  if (tab.id === undefined) return tab.title ?? '';
  const entryId = await entryIdForTab(tab.id);
  if (entryId) {
    const layout = await getLocal('layout');
    const entry = [...layout.favorites, ...walkEntries(layout.pinned)].find((e) => e.id === entryId);
    if (entry?.customTitle) return entry.customTitle;
  } else {
    const meta = await getSession('tabMeta');
    if (meta[tab.id]?.customTitle) return meta[tab.id].customTitle as string;
  }
  return tab.title ?? tab.url ?? '';
}

const NAV_COMMANDS: Record<string, NavAction> = {
  'nav-up': 'up',
  'nav-down': 'down',
  'nav-in': 'in',
  'nav-out': 'out',
};

async function navigate(tab: chrome.tabs.Tab, action: NavAction): Promise<void> {
  const [layout, bindings, meta, cursors, windowTabs] = await Promise.all([
    getLocal('layout'),
    getSession('bindings'),
    getSession('tabMeta'),
    getSession('sidebarCursor'),
    chrome.tabs.query({ windowId: tab.windowId }),
  ]);
  const items = sidebarItems(layout, windowTabs, bindings, meta);
  const index = cursorIndex(items, cursors[tab.windowId], tab.id);
  const inWindow = new Set(windowTabs.map((t) => t.id));
  const plan = planNav(layout, items, index, action, (id) =>
    inWindow.has(bindings[id]) ? bindings[id] : undefined,
  );

  if (plan.setCollapsed) await setFolderCollapsed(plan.setCollapsed.id, plan.setCollapsed.collapsed);
  // Clear explicitly too: activating the tab that's already active fires no onActivated.
  if (plan.cursor || plan.activate !== undefined) {
    if (plan.cursor) cursors[tab.windowId] = plan.cursor;
    else delete cursors[tab.windowId];
    await setSession('sidebarCursor', cursors);
  }
  if (plan.activate !== undefined) await chrome.tabs.update(plan.activate, { active: true });
  if (plan.open) await openEntry(plan.open, tab.windowId);
}

async function handle(command: string, tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id;
  switch (command) {
    case 'open-launcher':
      return openLauncherOverlay(tab);
    case 'copy-url':
      return copyText(tab.url ?? '', 'URL', tabId);
    case 'copy-clean-url':
      return copyText(cleanUrl(tab.url ?? ''), 'clean URL', tabId);
    case 'copy-title':
      return copyText(await displayTitle(tab), 'title', tabId);
    case 'copy-markdown':
      return copyText(markdownLink(await displayTitle(tab), tab.url ?? ''), 'Markdown link', tabId);
    case 'duplicate-tab':
      if (tabId !== undefined) await chrome.tabs.duplicate(tabId);
      return;
  }
  if (tabId === undefined) return;

  await serial(async () => {
    if (command in NAV_COMMANDS) return navigate(tab, NAV_COMMANDS[command]);
    const entryId = await entryIdForTab(tabId);
    switch (command) {
      case 'toggle-pin':
        if (entryId) await unpinNode(entryId);
        else {
          await pinTab(tabId, { zone: 'pinned' });
          // Not awaited: it queues its own serial writes behind this one.
          void backfillIcons();
        }
        return;
      case 'reset-pinned':
        if (entryId) await resetEntry(entryId);
        return;
      case 'archive-tab':
        if (entryId) await closeEntryTab(entryId);
        else await archiveTabs([tab]);
        return;
      case 'reopen-archived': {
        const [latest] = await getLocal('archive');
        if (latest) await restoreArchived(latest.id, tab.windowId);
        return;
      }
      case 'rename-tab':
        await setSession('pendingRenameTabId', tabId);
        return;
    }
  });
}

function runCommand(command: string, tab: chrome.tabs.Tab | undefined): void {
  // sidePanel.open() only works while the gesture is live, so call it before any await.
  if (command === 'toggle-sidebar') {
    if (tab) void toggleSidepanel(tab.windowId).catch(console.error);
    return;
  }
  if (tab && command === 'rename-tab') {
    void openSidepanel(tab.windowId).catch(console.error);
  }
  void (async () => {
    const target = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (target) await handle(command, target);
  })().catch(console.error);
}

export function registerCommands(): void {
  chrome.commands.onCommand.addListener((command, tab) => runCommand(command, tab));
}
