import type { ArchivedTab, Layout, SessionState, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  archiveAfterHours: 12,
  archiveRetentionDays: 30,
};

interface LocalState {
  layout: Layout;
  archive: ArchivedTab[];
  settings: Settings;
}

const LOCAL_DEFAULTS: LocalState = {
  layout: { favorites: [], pinned: [] },
  archive: [],
  settings: DEFAULT_SETTINGS,
};

const SESSION_DEFAULTS: SessionState = {
  tabMeta: {},
  bindings: {},
  sidepanelWindows: [],
  sidebarCursor: {},
};

export async function getLocal<K extends keyof LocalState>(key: K): Promise<LocalState[K]> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as LocalState[K] | undefined) ?? structuredClone(LOCAL_DEFAULTS[key]);
}

export async function setLocal<K extends keyof LocalState>(
  key: K,
  value: LocalState[K],
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getLocal('settings')) };
}

export async function getSession<K extends keyof SessionState>(
  key: K,
): Promise<SessionState[K]> {
  const result = await chrome.storage.session.get(key);
  return (result[key] as SessionState[K] | undefined) ?? structuredClone(SESSION_DEFAULTS[key]);
}

export async function setSession<K extends keyof SessionState>(
  key: K,
  value: SessionState[K],
): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}

export function newId(): string {
  return crypto.randomUUID();
}
