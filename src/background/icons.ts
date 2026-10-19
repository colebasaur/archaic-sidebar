import { iconCandidates, sameSite } from '../lib/icons';
import { getLocal, getSession, setLocal } from '../lib/storage';
import { walkEntries } from '../lib/tree';
import type { Entry, Layout } from '../lib/types';
import { serial } from './serial';

const MAX_ICON_BYTES = 32 * 1024;
const MAX_HTML_CHARS = 300_000;
const FETCH_TIMEOUT_MS = 8000;

// Per service-worker lifetime, so a site with no usable icon isn't refetched every sweep.
// Keyed by pin and URL so pointing a pin somewhere new tries again.
const attempted = new Set<string>();

async function toDataUrl(iconUrl: string): Promise<string | undefined> {
  if (iconUrl.startsWith('data:')) return iconUrl.length <= MAX_ICON_BYTES * 1.4 ? iconUrl : undefined;
  if (!/^https?:/.test(iconUrl)) return undefined;
  try {
    const response = await fetch(iconUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    const type = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
    const looksLikeIcon = type.startsWith('image/') || /\.ico(\?|$)/i.test(iconUrl);
    if (!looksLikeIcon) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return undefined;
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `data:${type.startsWith('image/') ? type : 'image/x-icon'};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

async function discoverIcon(pageUrl: string): Promise<string | undefined> {
  let html = '';
  let finalUrl = pageUrl;
  try {
    const response = await fetch(pageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    finalUrl = response.url || pageUrl;
    if (response.ok) html = (await response.text()).slice(0, MAX_HTML_CHARS);
  } catch {
    // Unreachable page; /favicon.ico may still work.
  }
  for (const candidate of iconCandidates(html, finalUrl)) {
    const data = await toDataUrl(candidate);
    if (data) return data;
  }
  return undefined;
}

function allEntries(layout: Layout): Entry[] {
  return [...layout.favorites, ...walkEntries(layout.pinned)];
}

async function saveIcon(entryId: string, dataUrl: string): Promise<void> {
  await serial(async () => {
    const layout = await getLocal('layout');
    const entry = allEntries(layout).find((e) => e.id === entryId);
    if (!entry || entry.favIconUrl === dataUrl) return;
    entry.favIconUrl = dataUrl;
    await setLocal('layout', layout);
  });
}

/** A pinned tab showed an icon: keep it if the tab is still on the pin's site. */
export async function captureTabIcon(tabId: number, iconUrl: string): Promise<void> {
  const [layout, bindings, tab] = await Promise.all([
    getLocal('layout'),
    getSession('bindings'),
    chrome.tabs.get(tabId).catch(() => undefined),
  ]);
  const entryId = Object.keys(bindings).find((id) => bindings[id] === tabId);
  const entry = entryId ? allEntries(layout).find((e) => e.id === entryId) : undefined;
  if (!entry || !sameSite(tab?.url, entry.url)) return;
  if (entry.favIconUrl?.startsWith('data:') && entry.favIconUrl === iconUrl) return;
  const data = await toDataUrl(iconUrl);
  if (data) await saveIcon(entry.id, data);
}

/** Fetches icons for pins that have none saved (or only a remote link), without opening tabs. */
export async function backfillIcons(): Promise<void> {
  const layout = await getLocal('layout');
  const missing = allEntries(layout).filter(
    (e) => !e.favIconUrl?.startsWith('data:') && !attempted.has(`${e.id} ${e.url}`),
  );
  for (const entry of missing) {
    attempted.add(`${entry.id} ${entry.url}`);
    const data = (entry.favIconUrl && (await toDataUrl(entry.favIconUrl))) || (await discoverIcon(entry.url));
    if (data) await saveIcon(entry.id, data);
  }
}

export function registerIconCapture(): void {
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.favIconUrl) void captureTabIcon(tabId, change.favIconUrl);
  });
}
