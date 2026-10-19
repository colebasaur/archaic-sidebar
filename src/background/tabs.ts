import { getLocal, getSession, setLocal, setSession } from '../lib/storage';
import { ancestorFolders, walkEntries } from '../lib/tree';
import { serial } from './serial';

export async function entryIdForTab(tabId: number): Promise<string | undefined> {
  const bindings = await getSession('bindings');
  return Object.keys(bindings).find((id) => bindings[id] === tabId);
}

function onCreated(tab: chrome.tabs.Tab): Promise<void> {
  return serial(async () => {
    if (tab.id === undefined) return;
    const meta = await getSession('tabMeta');
    const now = Date.now();
    // An action that created this tab may already have written meta (e.g. a restored name).
    meta[tab.id] = { ...meta[tab.id], createdAt: now, lastActiveAt: now };
    await setSession('tabMeta', meta);
  });
}

function onActivated({ tabId, windowId }: chrome.tabs.OnActivatedInfo): Promise<void> {
  return serial(async () => {
    const [meta, cursor] = await Promise.all([getSession('tabMeta'), getSession('sidebarCursor')]);
    const now = Date.now();
    meta[tabId] = { ...(meta[tabId] ?? { createdAt: now }), lastActiveAt: now };
    await setSession('tabMeta', meta);
    // Whatever made this tab active, the keyboard cursor snaps back to it.
    if (cursor[windowId]) {
      delete cursor[windowId];
      await setSession('sidebarCursor', cursor);
    }
    await revealInFolders(tabId);
  });
}

/** Expands any collapsed folders around the pin this tab belongs to, so it's visible. */
async function revealInFolders(tabId: number): Promise<void> {
  const bindings = await getSession('bindings');
  const entryId = Object.keys(bindings).find((id) => bindings[id] === tabId);
  if (!entryId) return;
  const layout = await getLocal('layout');
  const collapsed = ancestorFolders(layout.pinned, entryId).filter((f) => f.collapsed);
  if (collapsed.length === 0) return;
  for (const folder of collapsed) folder.collapsed = false;
  await setLocal('layout', layout);
}

function onRemoved(tabId: number): Promise<void> {
  return serial(async () => {
    const [meta, bindings] = await Promise.all([getSession('tabMeta'), getSession('bindings')]);
    delete meta[tabId];
    for (const [entryId, boundTab] of Object.entries(bindings)) {
      if (boundTab === tabId) delete bindings[entryId];
    }
    await Promise.all([setSession('tabMeta', meta), setSession('bindings', bindings)]);
  });
}

function onReplaced(addedTabId: number, removedTabId: number): Promise<void> {
  return serial(async () => {
    const [meta, bindings] = await Promise.all([getSession('tabMeta'), getSession('bindings')]);
    if (meta[removedTabId]) {
      meta[addedTabId] = meta[removedTabId];
      delete meta[removedTabId];
    }
    for (const [entryId, boundTab] of Object.entries(bindings)) {
      if (boundTab === removedTabId) bindings[entryId] = addedTabId;
    }
    await Promise.all([setSession('tabMeta', meta), setSession('bindings', bindings)]);
  });
}

/**
 * Brings session state in line with the tabs that actually exist: drops stale
 * entries and adds meta for unknown tabs. With `rebindByUrl`, also re-binds pinned
 * entries to tabs whose URL matches exactly, which is only safe right after a
 * browser restart or import; otherwise it would steal Today tabs.
 */
export function reconcile({ rebindByUrl = false } = {}): Promise<void> {
  return serial(async () => {
    const [tabs, meta, bindings, layout] = await Promise.all([
      chrome.tabs.query({}),
      getSession('tabMeta'),
      getSession('bindings'),
      getLocal('layout'),
    ]);
    const live = new Map(tabs.filter((t) => t.id !== undefined).map((t) => [t.id as number, t]));
    const now = Date.now();

    for (const id of Object.keys(meta).map(Number)) {
      if (!live.has(id)) delete meta[id];
    }
    for (const [i, tab] of tabs.entries()) {
      if (tab.id !== undefined && !meta[tab.id]) {
        meta[tab.id] = { createdAt: now - (tabs.length - i), lastActiveAt: now };
      }
    }

    const entries = [...layout.favorites, ...walkEntries(layout.pinned)];
    const entryIds = new Set(entries.map((e) => e.id));
    for (const [entryId, tabId] of Object.entries(bindings)) {
      if (!entryIds.has(entryId) || !live.has(tabId)) delete bindings[entryId];
    }
    const bound = new Set(Object.values(bindings));
    for (const entry of rebindByUrl ? entries : []) {
      if (bindings[entry.id] !== undefined) continue;
      const match = tabs.find((t) => t.id !== undefined && !bound.has(t.id) && t.url === entry.url);
      if (match?.id !== undefined) {
        bindings[entry.id] = match.id;
        bound.add(match.id);
      }
    }

    await Promise.all([setSession('tabMeta', meta), setSession('bindings', bindings)]);
  });
}

export function registerTabListeners(): void {
  chrome.tabs.onCreated.addListener((tab) => void onCreated(tab));
  chrome.tabs.onActivated.addListener((info) => void onActivated(info));
  chrome.tabs.onRemoved.addListener((tabId) => void onRemoved(tabId));
  chrome.tabs.onReplaced.addListener((added, removed) => void onReplaced(added, removed));
}
