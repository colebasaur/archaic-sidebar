import { FOLDER_ICONS } from '../lib/folderIcons';
import { send } from '../lib/messages';
import { todayTabs } from '../lib/order';
import { getLocal, getSession, getSettings } from '../lib/storage';
import type {
  ArchivedTab,
  BulkOp,
  CursorPos,
  DragSource,
  DropTarget,
  Entry,
  Folder,
  Layout,
  PinnedNode,
  SelectionItem,
  SessionState,
} from '../lib/types';
import { walkEntries } from '../lib/tree';
import { displayHost, faviconUrl, isLauncherUrl, isStorableIcon } from '../lib/url';
import { favicon, h, inlineEdit, resetIconPool, showMenu, type MenuItem } from '../shared/dom';
import { SIDEBAR_PRESETS, applySidebarColor, applySidebarGrain } from '../shared/sidebarTheme';

const SIDEPANEL_PORT = 'sidepanel';

interface Snapshot {
  layout: Layout;
  archive: ArchivedTab[];
  bindings: SessionState['bindings'];
  tabMeta: SessionState['tabMeta'];
  pendingRenameTabId?: number;
  tabsById: Map<number, chrome.tabs.Tab>;
  windowTabs: chrome.tabs.Tab[];
  sidebarColor?: string;
  sidebarGrain?: number;
  profileLabel?: string;
  cursor?: CursorPos;
}

const app = document.getElementById('app') as HTMLElement;
let windowId: number = chrome.windows.WINDOW_ID_CURRENT;
let view: 'main' | 'archive' = 'main';
let archiveQuery = '';
let busy = 0;
let renderQueued = false;
let dragSource: DragSource | undefined;
let current: Snapshot | undefined;
let pendingFolderRename: string | undefined;

// Multi-select: keys are "node:<id>" (favorites/pins) or "tab:<id>" (Today).
const selection = new Set<string>();
let anchor: string | undefined;

function connect(): void {
  const port = chrome.runtime.connect({ name: SIDEPANEL_PORT });
  port.postMessage({ windowId });
  // The service worker can be torn down at any time; reconnect so toggle state stays known.
  port.onDisconnect.addListener(() => {
    // runtime.id disappears once the extension is reloaded; this page is dead then.
    if (chrome.runtime?.id) setTimeout(connect, 250);
  });
}

async function load(): Promise<Snapshot> {
  const [layout, archive, bindings, tabMeta, pendingRenameTabId, allTabs, settings, cursors] =
    await Promise.all([
      getLocal('layout'),
      getLocal('archive'),
      getSession('bindings'),
      getSession('tabMeta'),
      getSession('pendingRenameTabId'),
      chrome.tabs.query({}),
      getSettings(),
      getSession('sidebarCursor'),
    ]);
  const tabsById = new Map(
    allTabs.filter((t) => t.id !== undefined).map((t) => [t.id as number, t]),
  );
  const windowTabs = allTabs.filter((t) => t.windowId === windowId);
  return {
    layout,
    archive,
    bindings,
    tabMeta,
    pendingRenameTabId,
    tabsById,
    windowTabs,
    sidebarColor: settings.sidebarColor,
    sidebarGrain: settings.sidebarGrain,
    profileLabel: settings.profileLabel,
    cursor: cursors[windowId],
  };
}

function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (busy > 0) return;
    void render();
  });
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T> {
  busy++;
  try {
    return await fn();
  } finally {
    busy--;
    scheduleRender();
  }
}

// Chrome drops favIconUrl while a page is loading; keep showing the last good one.
const lastIcon = new Map<number, string>();

function tabIcon(tab: chrome.tabs.Tab): HTMLImageElement {
  const pageIcon = faviconUrl(tab.url || tab.pendingUrl || '');
  if (tab.id !== undefined && isStorableIcon(tab.favIconUrl)) lastIcon.set(tab.id, tab.favIconUrl);
  const known = tab.id !== undefined ? lastIcon.get(tab.id) : undefined;
  return known ? favicon(known, pageIcon) : favicon(pageIcon);
}

function entryIcon(entry: Entry, tab: chrome.tabs.Tab | undefined): HTMLImageElement {
  if (tab) return tabIcon(tab);
  const pageIcon = faviconUrl(entry.url);
  return entry.favIconUrl ? favicon(entry.favIconUrl, pageIcon) : favicon(pageIcon);
}

function tabTitle(tab: chrome.tabs.Tab, s: Snapshot): string {
  const custom = tab.id !== undefined ? s.tabMeta[tab.id]?.customTitle : undefined;
  if (custom) return custom;
  if (isLauncherUrl(tab.url) || tab.url?.startsWith('chrome://newtab')) return 'New Tab';
  return tab.title || tab.url || 'Untitled';
}

function entryTab(entry: Entry, s: Snapshot): chrome.tabs.Tab | undefined {
  const id = s.bindings[entry.id];
  return id === undefined ? undefined : s.tabsById.get(id);
}

function entryTitle(entry: Entry, s: Snapshot): string {
  return entry.customTitle || entryTab(entry, s)?.title || entry.title;
}

function isDrifted(entry: Entry, tab: chrome.tabs.Tab | undefined): boolean {
  return !!tab?.url && tab.url !== entry.url;
}

// ---------- Drag & drop ----------

function clearDropMarks(): void {
  for (const el of document.querySelectorAll('.drop-before, .drop-into')) {
    el.classList.remove('drop-before', 'drop-into');
  }
}

function draggable(el: HTMLElement, source: DragSource): void {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    busy++;
    dragSource = source;
    el.classList.add('dragging');
    e.dataTransfer?.setData('text/plain', '');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragSource = undefined;
    clearDropMarks();
    busy--;
    scheduleRender();
  });
}

type Resolve = (e: DragEvent, source: DragSource) => { target: DropTarget; mark: string } | undefined;

function dropZone(el: HTMLElement, resolve: Resolve): void {
  el.addEventListener('dragover', (e) => {
    if (!dragSource) return;
    const hit = resolve(e, dragSource);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    el.classList.add(hit.mark);
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node)) el.classList.remove('drop-before', 'drop-into');
  });
  el.addEventListener('drop', (e) => {
    const source = dragSource;
    if (!source) return;
    const hit = resolve(e, source);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    void (source.kind === 'tab'
      ? send({ type: 'pinTab', tabId: source.tabId, target: hit.target })
      : send({ type: 'moveNode', id: source.id, target: hit.target }));
  });
}

// ---------- Rename ----------

function startRename(titleEl: HTMLElement, current: string, commit: (v: string) => Promise<void>) {
  return withBusy(async () => {
    const value = await inlineEdit(titleEl, current);
    if (value !== undefined && value !== current) await commit(value);
  });
}

function renameRow(row: HTMLElement): void {
  const titleEl = row.querySelector<HTMLElement>('.title');
  if (!titleEl) return;
  const current = titleEl.textContent ?? '';
  const { nodeId, tabId } = row.dataset;
  if (nodeId) {
    void startRename(titleEl, current, (title) => send({ type: 'renameNode', id: nodeId, title }));
  } else if (tabId) {
    void startRename(titleEl, current, (title) =>
      send({ type: 'renameTab', tabId: Number(tabId), title }),
    );
  }
}

/** Favorites have no visible title, so edit in a temporary row under the grid. */
function renameFavorite(tile: HTMLElement): void {
  const nodeId = tile.dataset.nodeId;
  if (!nodeId) return;
  const holder = h('span', { class: 'title' }, tile.title);
  const wrapper = h('div', { class: 'row' }, holder);
  tile.closest('.favorites')?.after(wrapper);
  void withBusy(async () => {
    const value = await inlineEdit(holder, tile.title);
    wrapper.remove();
    if (value !== undefined && value !== tile.title) {
      await send({ type: 'renameNode', id: nodeId, title: value });
    }
  });
}

// ---------- Rows ----------

function closeButton(label: string, glyph: string, onClick: () => void): HTMLButtonElement {
  return h(
    'button',
    {
      class: 'icon-btn',
      title: label,
      'aria-label': label,
      onclick: (e: Event) => {
        e.stopPropagation();
        onClick();
      },
    },
    glyph,
  );
}

const DOUBLE_CLICK_MS = 250;

/**
 * Opening a closed pin creates a tab, which pulls focus out of the side panel and would kill
 * a rename started by the same double-click. So closed pins wait to see if a second click
 * follows before opening; open ones switch immediately.
 */
function clickOrRename(el: HTMLElement, entry: Entry, isOpen: boolean, rename: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => void send({ type: 'openEntry', id: entry.id, windowId });
  el.addEventListener('click', (e) => {
    if (e.detail > 1) return;
    if (isOpen) open();
    else timer = setTimeout(open, DOUBLE_CLICK_MS);
  });
  el.addEventListener('dblclick', () => {
    clearTimeout(timer);
    rename();
  });
}

// ---------- Selection ----------

function selKey(item: SelectionItem): string {
  return item.kind === 'tab' ? `tab:${item.tabId}` : `node:${item.id}`;
}

function parseSelKey(key: string): SelectionItem {
  const [kind, id] = key.split(':');
  return kind === 'tab' ? { kind: 'tab', tabId: Number(id) } : { kind: 'node', id };
}

function orderedKeys(): string[] {
  return [...app.querySelectorAll<HTMLElement>('[data-sel]')].map((el) => el.dataset.sel as string);
}

function paintSelection(): void {
  for (const el of app.querySelectorAll<HTMLElement>('[data-sel]')) {
    el.classList.toggle('selected', selection.has(el.dataset.sel as string));
  }
}

function clearSelection(): void {
  if (selection.size === 0) return;
  selection.clear();
  paintSelection();
}

/**
 * Shift-click selects a range from the last plain-clicked item (or the active tab);
 * Cmd/Ctrl-click toggles one item. Either way the click doesn't open anything. A plain
 * click clears the selection and behaves normally.
 */
function selectable(el: HTMLElement, item: SelectionItem): void {
  const key = selKey(item);
  el.dataset.sel = key;
  el.addEventListener(
    'click',
    (e) => {
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        clearSelection();
        anchor = key;
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.shiftKey) {
        const from =
          anchor ?? app.querySelector<HTMLElement>('.active[data-sel]')?.dataset.sel ?? key;
        const keys = orderedKeys();
        const [a, b] = [keys.indexOf(from), keys.indexOf(key)].sort((x, y) => x - y);
        selection.clear();
        for (const k of a < 0 ? [key] : keys.slice(a, b + 1)) selection.add(k);
      } else {
        if (selection.has(key)) selection.delete(key);
        else selection.add(key);
        anchor = key;
      }
      paintSelection();
    },
    true,
  );
}

function folderPaths(nodes: PinnedNode[], prefix = ''): { id: string; path: string }[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder'
      ? [{ id: n.id, path: prefix + n.title }, ...folderPaths(n.children, `${prefix}${n.title} / `)]
      : [],
  );
}

function bulkMenu(): MenuItem[] {
  const s = current;
  const keys = orderedKeys().filter((k, i, all) => selection.has(k) && all.indexOf(k) === i);
  const items = keys.map(parseSelKey);
  if (!s || items.length === 0) return [];
  const tabs = items.filter((i) => i.kind === 'tab').length;
  const entries = items.length - tabs;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const run = (op: BulkOp, folderId?: string) => () => {
    void send({ type: 'bulk', op, items, folderId }).then(clearSelection);
  };
  const allEntries = [...s.layout.favorites, ...walkEntries(s.layout.pinned)];
  const urls = items
    .map((i) =>
      i.kind === 'tab' ? s.tabsById.get(i.tabId)?.url : allEntries.find((e) => e.id === i.id)?.url,
    )
    .filter((u): u is string => !!u);

  const menu: MenuItem[] = [];
  if (tabs) menu.push({ label: `Pin ${plural(tabs, 'tab')}`, run: run('pin') });
  menu.push({ label: 'Add to Favorites', run: run('favorite') });
  menu.push({
    label: 'Move to new folder',
    run: () => {
      const id = crypto.randomUUID();
      void send({ type: 'createFolder', title: 'New Folder', id })
        .then(() => send({ type: 'bulk', op: 'moveToFolder', items, folderId: id }))
        .then(() => {
          pendingFolderRename = id;
          clearSelection();
          scheduleRender();
        });
    },
  });
  for (const folder of folderPaths(s.layout.pinned)) {
    menu.push({ label: `Move to “${folder.path}”`, run: run('moveToFolder', folder.id) });
  }
  if (entries) menu.push({ label: `Unpin ${plural(entries, 'item')}`, run: run('unpin') });
  menu.push({
    label: `Copy ${plural(urls.length, 'URL')}`,
    run: () => void navigator.clipboard.writeText(urls.join('\n')).then(clearSelection),
  });
  if (tabs) menu.push({ label: `Archive ${plural(tabs, 'tab')}`, run: run('archive') });
  menu.push({ label: `Close ${plural(items.length, 'item')}`, danger: true, run: run('close') });
  return menu;
}

function menuOn(el: HTMLElement, items: () => MenuItem[]): void {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const key = el.dataset.sel;
    const bulk = !!key && selection.size > 1 && selection.has(key);
    if (!bulk) clearSelection();
    showMenu(e.clientX, e.clientY, bulk ? bulkMenu() : items());
  });
}

function favoriteTile(entry: Entry, s: Snapshot): HTMLElement {
  const tab = entryTab(entry, s);
  const title = entryTitle(entry, s);
  const tile = h(
    'button',
    {
      class: ['fav', tab ? '' : 'unloaded', tab?.active && tab.windowId === windowId ? 'active' : '']
        .filter(Boolean)
        .join(' '),
      title,
      'data-node-id': entry.id,
      'data-tab-id': tab?.id,
    },
    entryIcon(entry, tab),
  );
  selectable(tile, { kind: 'node', id: entry.id });
  clickOrRename(tile, entry, !!tab, () => renameFavorite(tile));
  draggable(tile, { kind: 'node', id: entry.id });
  dropZone(tile, () => ({ target: { zone: 'favorites', beforeId: entry.id }, mark: 'drop-before' }));
  menuOn(tile, () => [
    { label: 'Rename', run: () => renameFavorite(tile) },
    ...entryMenu(entry, tab),
    { label: 'Move to Pinned', run: () => void send({ type: 'moveNode', id: entry.id, target: { zone: 'pinned' } }) },
    { label: 'Remove from Favorites', danger: true, run: () => void send({ type: 'unpinNode', id: entry.id }) },
  ]);
  return tile;
}

function entryMenu(entry: Entry, tab: chrome.tabs.Tab | undefined): MenuItem[] {
  const items: MenuItem[] = [];
  if (isDrifted(entry, tab)) {
    items.push({ label: 'Back to pinned URL', run: () => void send({ type: 'resetEntry', id: entry.id }) });
  }
  if (tab?.url && tab.url !== entry.url) {
    items.push({
      label: 'Set pinned URL to this page',
      run: () => void send({ type: 'setEntryUrl', id: entry.id }),
    });
  }
  if (entry.customTitle) {
    items.push({
      label: 'Reset name',
      run: () => void send({ type: 'renameNode', id: entry.id, title: '' }),
    });
  }
  items.push({ label: 'Copy URL', run: () => void navigator.clipboard.writeText(entry.url) });
  if (tab) {
    items.push({ label: 'Close tab', run: () => void send({ type: 'closeEntryTab', id: entry.id }) });
  }
  return items;
}

function entryRow(entry: Entry, parentId: string | undefined, s: Snapshot): HTMLElement {
  const tab = entryTab(entry, s);
  const active = tab?.active && tab.windowId === windowId;
  const drifted = isDrifted(entry, tab);
  const titleEl = h('span', { class: 'title' }, entryTitle(entry, s));
  const row = h(
    'div',
    {
      class: ['row', tab ? '' : 'unloaded', active ? 'active' : ''].filter(Boolean).join(' '),
      title: tab?.url ?? entry.url,
      'data-node-id': entry.id,
      'data-tab-id': tab?.id,
    },
    entryIcon(entry, tab),
    titleEl,
    tab?.audible ? h('span', { class: 'audible', title: 'Playing audio' }, '♪') : null,
    h(
      'span',
      { class: drifted ? 'actions always' : 'actions' },
      drifted &&
        closeButton('Back to pinned URL', '↺', () => void send({ type: 'resetEntry', id: entry.id })),
      tab
        ? closeButton('Close tab (keeps pin)', '−', () => void send({ type: 'closeEntryTab', id: entry.id }))
        : closeButton('Unpin', '×', () => void send({ type: 'unpinNode', id: entry.id })),
    ),
  );
  selectable(row, { kind: 'node', id: entry.id });
  clickOrRename(row, entry, !!tab, () => renameRow(row));
  draggable(row, { kind: 'node', id: entry.id });
  dropZone(row, () => ({ target: { zone: 'pinned', parentId, beforeId: entry.id }, mark: 'drop-before' }));
  menuOn(row, () => [
    { label: 'Rename', run: () => renameRow(row) },
    ...entryMenu(entry, tab),
    { label: 'Add to Favorites', run: () => void send({ type: 'moveNode', id: entry.id, target: { zone: 'favorites' } }) },
    { label: 'Unpin', danger: true, run: () => void send({ type: 'unpinNode', id: entry.id }) },
  ]);
  return row;
}

function folderBlock(folder: Folder, parentId: string | undefined, s: Snapshot): HTMLElement {
  const row = h(
    'div',
    {
      class: folder.collapsed ? 'row folder collapsed' : 'row folder',
      'data-node-id': folder.id,
      onclick: () => void send({ type: 'toggleFolder', id: folder.id }),
      ondblclick: (e: Event) => {
        e.stopPropagation();
        renameRow(row);
      },
    },
    h('span', { class: 'chevron' }, '▼'),
    folder.icon && Object.hasOwn(FOLDER_ICONS, folder.icon) && folderIcon(folder.icon),
    h('span', { class: 'title' }, folder.title),
  );
  draggable(row, { kind: 'node', id: folder.id });
  dropZone(row, (e, source) => {
    const rect = row.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height * 0.3 || (source.kind === 'node' && source.id === folder.id)) {
      return { target: { zone: 'pinned', parentId, beforeId: folder.id }, mark: 'drop-before' };
    }
    return { target: { zone: 'pinned', parentId: folder.id }, mark: 'drop-into' };
  });
  menuOn(row, () => [
    { label: 'Rename', run: () => renameRow(row) },
    { label: 'Change icon…', run: () => showIconPicker(row, folder) },
    { label: 'Delete folder (keeps contents)', danger: true, run: () => void send({ type: 'deleteFolder', id: folder.id }) },
  ]);

  const children = h(
    'div',
    { class: 'children' },
    ...(folder.collapsed ? [] : folder.children.map((c) => nodeEl(c, folder.id, s))),
  );
  return h('div', {}, row, children);
}

function nodeEl(node: Entry | Folder, parentId: string | undefined, s: Snapshot): HTMLElement {
  return node.kind === 'folder' ? folderBlock(node, parentId, s) : entryRow(node, parentId, s);
}

function todayRow(tab: chrome.tabs.Tab, s: Snapshot): HTMLElement {
  const tabId = tab.id as number;
  const row = h(
    'div',
    {
      class: tab.active ? 'row active' : 'row',
      title: tab.url,
      'data-tab-id': tabId,
      onclick: () => void chrome.tabs.update(tabId, { active: true }),
      ondblclick: () => renameRow(row),
      onauxclick: (e: MouseEvent) => {
        if (e.button === 1) void chrome.tabs.remove(tabId);
      },
    },
    tabIcon(tab),
    h('span', { class: 'title' }, tabTitle(tab, s)),
    tab.audible ? h('span', { class: 'audible', title: 'Playing audio' }, '♪') : null,
    h('span', { class: 'actions' }, closeButton('Close tab', '×', () => void chrome.tabs.remove(tabId))),
  );
  selectable(row, { kind: 'tab', tabId });
  draggable(row, { kind: 'tab', tabId });
  menuOn(row, () => [
    { label: 'Rename', run: () => renameRow(row) },
    ...(s.tabMeta[tabId]?.customTitle
      ? [{ label: 'Reset name', run: () => void send({ type: 'renameTab', tabId, title: '' }) }]
      : []),
    { label: 'Pin', run: () => void send({ type: 'pinTab', tabId, target: { zone: 'pinned' } }) },
    { label: 'Add to Favorites', run: () => void send({ type: 'pinTab', tabId, target: { zone: 'favorites' } }) },
    { label: 'Duplicate', run: () => void chrome.tabs.duplicate(tabId) },
    { label: 'Close', danger: true, run: () => void chrome.tabs.remove(tabId) },
  ]);
  return row;
}

// ---------- Views ----------

function profileHeader(s: Snapshot): HTMLElement {
  const label = h(
    'span',
    { class: s.profileLabel ? 'title' : 'title placeholder' },
    s.profileLabel ?? 'Name this profile',
  );
  const header = h(
    'div',
    {
      class: 'profile',
      role: 'button',
      tabindex: '0',
      title: 'Click to rename this profile',
      onclick: () =>
        void withBusy(async () => {
          const value = await inlineEdit(label, s.profileLabel ?? '');
          if (value !== undefined && value !== (s.profileLabel ?? '')) {
            await send({ type: 'updateSettings', settings: { profileLabel: value } });
          }
        }),
    },
    label,
  );
  return header;
}

function renderMain(s: Snapshot): HTMLElement[] {
  const favorites = h(
    'div',
    { class: s.layout.favorites.length ? 'favorites' : 'favorites empty' },
    ...(s.layout.favorites.length
      ? s.layout.favorites.map((f) => favoriteTile(f, s))
      : ['Drag here for Favorites']),
  );
  dropZone(favorites, () => ({ target: { zone: 'favorites' }, mark: 'drop-into' }));

  const pinned = h(
    'div',
    { class: 'section pinned' },
    ...s.layout.pinned.map((n) => nodeEl(n, undefined, s)),
    s.layout.pinned.length === 0 && h('div', { class: 'hint' }, 'Drag tabs here to pin them'),
  );
  dropZone(pinned, () => ({ target: { zone: 'pinned' }, mark: 'drop-into' }));
  menuOn(pinned, () => [
    { label: 'New folder', run: () => void send({ type: 'createFolder', title: 'New Folder' }) },
  ]);

  const today = todayTabs(s.windowTabs, s.bindings, s.tabMeta);
  const todaySection = h(
    'div',
    { class: 'section today' },
    h(
      'button',
      { class: 'row new-tab', onclick: () => void chrome.tabs.create({ windowId }) },
      h('span', { class: 'plus' }, '+'),
      h('span', { class: 'title' }, 'New Tab'),
    ),
    ...today.map((t) => todayRow(t, s)),
  );
  dropZone(todaySection, (_e, source) =>
    source.kind === 'node' && s.bindings[source.id] !== undefined
      ? { target: { zone: 'today' }, mark: 'drop-into' }
      : undefined,
  );

  const scroll = h('div', { class: 'scroll' }, favorites, pinned, h('div', { class: 'divider' }), todaySection);
  const footer = h(
    'div',
    { class: 'footer' },
    h('button', { onclick: () => switchView('archive') }, `Archive (${s.archive.length})`),
    h(
      'span',
      {},
      h('button', { title: 'New folder', onclick: () => void send({ type: 'createFolder', title: 'New Folder' }) }, '+ Folder'),
      h(
        'button',
        {
          title: 'Sidebar color',
          onclick: (e: MouseEvent) => showPalette(e.clientX, e.clientY, s.sidebarColor, s.sidebarGrain),
        },
        '◐',
      ),
      h('button', { title: 'Settings', onclick: () => void chrome.runtime.openOptionsPage() }, '⚙'),
    ),
  );
  return [profileHeader(s), scroll, footer];
}

function setColor(color: string | undefined): void {
  applySidebarColor(color);
  void send({ type: 'updateSettings', settings: { sidebarColor: color } });
}

// Lives outside the palette menu: opening the native picker blurs the panel, which closes menus.
const customColor = h('input', {
  type: 'color',
  class: 'visually-hidden',
  tabindex: '-1',
  oninput: (e: Event) => applySidebarColor((e.target as HTMLInputElement).value),
  onchange: (e: Event) => setColor((e.target as HTMLInputElement).value),
});
document.body.append(customColor);

/** A context menu with a grid of buttons above its items; `grid` gets the menu to close it. */
function gridMenu(x: number, y: number, items: MenuItem[], grid: (menu: Element) => HTMLElement): void {
  // Reuse the context-menu shell for dismissal, then prepend the grid.
  showMenu(x, y, items);
  const menu = document.querySelector('.menu');
  if (!menu) return;
  menu.prepend(grid(menu));
  const rect = menu.getBoundingClientRect();
  (menu as HTMLElement).style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
}

function folderIcon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'folder-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = FOLDER_ICONS[name];
  return svg;
}

function showIconPicker(row: HTMLElement, folder: Folder): void {
  const rect = row.getBoundingClientRect();
  const setIcon = (icon?: string) => void send({ type: 'setFolderIcon', id: folder.id, icon });
  gridMenu(rect.left + 8, rect.bottom + 2, [{ label: 'No icon', run: () => setIcon(undefined) }], (menu) =>
    h(
      'div',
      { class: 'icon-grid' },
      ...Object.keys(FOLDER_ICONS).map((name) =>
        h(
          'button',
          {
            class: name === folder.icon ? 'icon-choice selected' : 'icon-choice',
            title: name,
            'aria-label': `Folder icon ${name}`,
            onclick: () => {
              menu.remove();
              setIcon(name);
            },
          },
          folderIcon(name),
        ),
      ),
    ),
  );
}

function grainSlider(grain: number | undefined): HTMLElement {
  return h(
    'label',
    { class: 'grain' },
    'Grain',
    h('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: String(grain ?? 0),
      oninput: (e: Event) => applySidebarGrain(Number((e.target as HTMLInputElement).value)),
      onchange: (e: Event) => {
        const value = Number((e.target as HTMLInputElement).value);
        void send({ type: 'updateSettings', settings: { sidebarGrain: value } });
      },
    }),
  );
}

function showPalette(
  x: number,
  y: number,
  current: string | undefined,
  grain: number | undefined,
): void {
  gridMenu(x, y, [{ label: 'Default (follow system)', run: () => setColor(undefined) }], (menu) =>
    h(
      'div',
      {},
      h(
        'div',
        { class: 'palette' },
        ...SIDEBAR_PRESETS.map((color) =>
          h('button', {
            class: color === current ? 'swatch selected' : 'swatch',
            style: `background:${color}`,
            title: color,
            'aria-label': `Sidebar color ${color}`,
            onclick: () => {
              menu.remove();
              setColor(color);
            },
          }),
        ),
        h('button', {
          class: 'swatch custom',
          title: 'Custom color',
          'aria-label': 'Custom color',
          onclick: () => {
            menu.remove();
            customColor.value = current ?? SIDEBAR_PRESETS[0];
            customColor.showPicker();
          },
        }),
      ),
      grainSlider(grain),
    ),
  );
}

function timeGroup(ts: number): string {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - 86_400_000) return 'Yesterday';
  if (ts >= startOfToday - 6 * 86_400_000) return 'This week';
  return 'Older';
}

function relativeTime(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

let archiveList: HTMLElement | undefined;

function renderArchiveList(s: Snapshot): void {
  if (!archiveList) return;
  const q = archiveQuery.toLowerCase();
  const items = q
    ? s.archive.filter((a) => a.title.toLowerCase().includes(q) || a.url.toLowerCase().includes(q))
    : s.archive;
  const children: HTMLElement[] = [];
  let lastGroup = '';
  for (const item of items) {
    const group = timeGroup(item.archivedAt);
    if (group !== lastGroup) {
      children.push(h('div', { class: 'group-label' }, group));
      lastGroup = group;
    }
    children.push(
      h(
        'div',
        {
          class: 'row',
          title: item.url,
          onclick: () => void send({ type: 'restoreArchived', id: item.id, windowId }),
        },
        favicon(faviconUrl(item.url)),
        h('span', { class: 'title' }, item.title || displayHost(item.url)),
        h('span', { class: 'sub' }, relativeTime(item.archivedAt)),
        h(
          'span',
          { class: 'actions' },
          closeButton('Delete from archive', '×', () => void send({ type: 'deleteArchived', id: item.id })),
        ),
      ),
    );
  }
  if (children.length === 0) {
    children.push(h('div', { class: 'hint' }, q ? 'No matches' : 'Nothing archived yet'));
  }
  archiveList.replaceChildren(...children);
}

function switchView(next: 'main' | 'archive'): void {
  view = next;
  archiveQuery = '';
  archiveList = undefined;
  if (next === 'archive') {
    const search = h('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Search archive',
      oninput: (e: Event) => {
        archiveQuery = (e.target as HTMLInputElement).value;
        scheduleRender();
      },
    });
    archiveList = h('div', { class: 'section' });
    app.replaceChildren(
      h(
        'div',
        { class: 'archive-head' },
        h('button', { class: 'icon-btn', title: 'Back', onclick: () => switchView('main') }, '←'),
        search,
      ),
      h('div', { class: 'scroll' }, archiveList),
    );
    search.focus();
  }
  scheduleRender();
}

let renderGen = 0;

async function render(): Promise<void> {
  const gen = ++renderGen;
  const s = await load();
  if (gen !== renderGen || busy > 0) return;
  applySidebarColor(s.sidebarColor);
  applySidebarGrain(s.sidebarGrain);
  if (view === 'archive') {
    resetIconPool();
    renderArchiveList(s);
    return;
  }
  const scrollTop = app.querySelector('.scroll')?.scrollTop ?? 0;
  resetIconPool();
  current = s;
  app.replaceChildren(...renderMain(s));
  const present = new Set(orderedKeys());
  for (const key of selection) if (!present.has(key)) selection.delete(key);
  paintSelection();
  const scroll = app.querySelector('.scroll');
  if (scroll) scroll.scrollTop = scrollTop;
  showCursor(s.cursor);
  handlePendingRename(s);
  if (pendingFolderRename) {
    const row = app.querySelector<HTMLElement>(`.folder[data-node-id="${pendingFolderRename}"]`);
    pendingFolderRename = undefined;
    if (row) renameRow(row);
  }
}

function showCursor(cursor: CursorPos | undefined): void {
  if (!cursor) return;
  const selector =
    cursor.kind === 'tab' ? `[data-tab-id="${cursor.tabId}"]` : `[data-node-id="${cursor.id}"]`;
  const el = app.querySelector<HTMLElement>(`.row${selector}, .fav${selector}`);
  el?.classList.add('cursor');
  el?.scrollIntoView({ block: 'nearest' });
}

function handlePendingRename(s: Snapshot): void {
  const tabId = s.pendingRenameTabId;
  if (tabId === undefined || s.tabsById.get(tabId)?.windowId !== windowId) return;
  void send({ type: 'clearPendingRename' });
  const row =
    app.querySelector<HTMLElement>(`.row[data-tab-id="${tabId}"]`) ??
    app.querySelector<HTMLElement>(`.fav[data-tab-id="${tabId}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'nearest' });
  if (row.classList.contains('fav')) renameFavorite(row);
  else renameRow(row);
}

async function init(): Promise<void> {
  windowId = (await chrome.windows.getCurrent()).id ?? windowId;
  connect();

  chrome.tabs.onCreated.addListener(scheduleRender);
  chrome.tabs.onRemoved.addListener((tabId) => {
    lastIcon.delete(tabId);
    scheduleRender();
  });
  chrome.tabs.onActivated.addListener(scheduleRender);
  chrome.tabs.onMoved.addListener(scheduleRender);
  chrome.tabs.onAttached.addListener(scheduleRender);
  chrome.tabs.onDetached.addListener(scheduleRender);
  chrome.tabs.onReplaced.addListener(scheduleRender);
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.title || info.url || info.favIconUrl || info.audible !== undefined || info.status) {
      scheduleRender();
    }
  });
  chrome.storage.onChanged.addListener(scheduleRender);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.menu')) clearSelection();
    if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.closest('input, textarea')) return;
      e.preventDefault();
      void send({ type: 'undoArchive', windowId });
    }
  });

  await render();
}

void init();
