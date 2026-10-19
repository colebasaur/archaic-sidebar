export interface Entry {
  kind: 'entry';
  id: string;
  url: string;
  title: string;
  customTitle?: string;
  favIconUrl?: string;
}

export interface Folder {
  kind: 'folder';
  id: string;
  title: string;
  /** Key into FOLDER_ICONS; unset shows no icon. */
  icon?: string;
  collapsed: boolean;
  children: PinnedNode[];
}

export type PinnedNode = Entry | Folder;

export interface ArchivedTab {
  id: string;
  url: string;
  title: string;
  customTitle?: string;
  archivedAt: number;
}

export interface Settings {
  archiveAfterHours: number;
  archiveRetentionDays: number;
  /** Hex color; unset follows the system light/dark default. */
  sidebarColor?: string;
  /** Film-grain strength over the sidebar background, 0–100; unset means none. */
  sidebarGrain?: number;
  /** Shown atop the sidebar ("Work", "Personal"); per profile, never exported. */
  profileLabel?: string;
}

export interface Layout {
  favorites: Entry[];
  pinned: PinnedNode[];
}

export interface TabMeta {
  lastActiveAt: number;
  createdAt: number;
  customTitle?: string;
}

export type CursorPos = { kind: 'node'; id: string } | { kind: 'tab'; tabId: number };

/** Session-scoped state; tab ids are only meaningful until the browser restarts. */
export interface SessionState {
  tabMeta: Record<number, TabMeta>;
  bindings: Record<string, number>;
  pendingRenameTabId?: number;
  launcherToken?: string;
  sidepanelWindows: number[];
  /** Per window; only set while the keyboard cursor rests somewhere other than the active tab. */
  sidebarCursor: Record<number, CursorPos>;
}

export type DropTarget =
  | { zone: 'favorites'; beforeId?: string }
  | { zone: 'pinned'; parentId?: string; beforeId?: string }
  | { zone: 'today' };

export type DragSource = { kind: 'node'; id: string } | { kind: 'tab'; tabId: number };

/** A sidebar item picked for a bulk action; same shape as a drag source. */
export type SelectionItem = DragSource;

export type BulkOp = 'close' | 'archive' | 'pin' | 'favorite' | 'moveToFolder' | 'unpin';

export type LauncherTarget =
  | { kind: 'tab'; tabId: number }
  | { kind: 'entry'; id: string }
  | { kind: 'archived'; id: string }
  | { kind: 'url'; url: string }
  | { kind: 'search'; text: string };

export type LauncherMode = 'overlay' | 'popup';

export type Message =
  | { type: 'openEntry'; id: string; windowId: number }
  | { type: 'closeEntryTab'; id: string }
  | { type: 'resetEntry'; id: string }
  | { type: 'renameNode'; id: string; title: string }
  | { type: 'renameTab'; tabId: number; title: string }
  | { type: 'pinTab'; tabId: number; target: DropTarget }
  | { type: 'unpinNode'; id: string }
  | { type: 'moveNode'; id: string; target: DropTarget }
  | { type: 'createFolder'; title: string; id?: string }
  | { type: 'deleteFolder'; id: string }
  | { type: 'setFolderIcon'; id: string; icon?: string }
  | { type: 'toggleFolder'; id: string }
  | { type: 'restoreArchived'; id: string; windowId: number }
  | { type: 'deleteArchived'; id: string }
  | { type: 'clearPendingRename' }
  | { type: 'launch'; target: LauncherTarget; mode: LauncherMode; hostTabId?: number }
  | { type: 'importData'; data: unknown }
  | { type: 'updateSettings'; settings: Partial<Settings> }
  | { type: 'bulk'; op: BulkOp; items: SelectionItem[]; folderId?: string }
  | { type: 'setEntryUrl'; id: string };
