import { newId, setSession } from '../lib/storage';
import type { LauncherMode, LauncherTarget } from '../lib/types';
import { focusTab, openEntry, restoreArchived } from './actions';

const OVERLAY_ID = 'archaic-sidebar-launcher-overlay';

/** Runs in the page; must be self-contained. Toggles the launcher iframe. */
function injectOverlay(src: string, overlayId: string): void {
  type Overlay = HTMLIFrameElement & { arcClose?: () => void };
  const existing = document.getElementById(overlayId) as Overlay | null;
  if (existing) {
    existing.arcClose?.();
    return;
  }
  const frame: Overlay = document.createElement('iframe');
  frame.id = overlayId;
  frame.src = src;
  frame.setAttribute('allow', 'clipboard-write');
  frame.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;' +
    'background:transparent;color-scheme:normal;';
  const origin = new URL(src).origin;
  const onMessage = (event: MessageEvent) => {
    if (event.origin === origin && event.data?.type === 'arc-launcher-close') frame.arcClose?.();
  };
  frame.arcClose = () => {
    window.removeEventListener('message', onMessage);
    frame.remove();
  };
  window.addEventListener('message', onMessage);
  frame.addEventListener('load', () => frame.focus());
  document.documentElement.appendChild(frame);
}

/**
 * The launcher page is web-accessible so it can be framed, which means any site could
 * frame it too. A per-open token it must find in session storage keeps it blank there.
 */
async function launcherUrl(mode: LauncherMode, hostTabId: number): Promise<string> {
  const token = newId();
  await setSession('launcherToken', token);
  return chrome.runtime.getURL(`launcher/index.html?mode=${mode}&host=${hostTabId}&token=${token}`);
}

export async function openLauncherOverlay(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const src = await launcherUrl('overlay', tab.id);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectOverlay,
      args: [src, OVERLAY_ID],
    });
  } catch {
    // chrome://, the Web Store, and other extension pages can't be scripted.
    const popup = await launcherUrl('popup', tab.id);
    const win = await chrome.windows.get(tab.windowId);
    const width = 680;
    const height = 480;
    await chrome.windows.create({
      url: popup,
      type: 'popup',
      width,
      height,
      left: Math.round((win.left ?? 0) + ((win.width ?? width) - width) / 2),
      top: Math.round((win.top ?? 0) + 80),
      focused: true,
    });
  }
}

async function hostWindowId(hostTabId: number | undefined): Promise<number> {
  if (hostTabId !== undefined) {
    try {
      return (await chrome.tabs.get(hostTabId)).windowId;
    } catch {
      // Host tab is gone; fall through.
    }
  }
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  return win.id as number;
}

/** New things open in a new tab in the host tab's window. */
export async function launch(target: LauncherTarget, hostTabId: number | undefined): Promise<void> {
  switch (target.kind) {
    case 'tab':
      await focusTab(target.tabId);
      return;
    case 'entry':
      await openEntry(target.id, await hostWindowId(hostTabId));
      return;
    case 'archived':
      await restoreArchived(target.id, await hostWindowId(hostTabId));
      return;
    case 'url':
      await focusTab((await openTab(target.url, hostTabId)) as number);
      return;
    case 'search': {
      const tabId = await openTab(undefined, hostTabId);
      if (tabId !== undefined) {
        await chrome.search.query({ text: target.text, tabId });
        await focusTab(tabId);
      }
      return;
    }
  }
}

async function openTab(
  url: string | undefined,
  hostTabId: number | undefined,
): Promise<number | undefined> {
  const windowId = await hostWindowId(hostTabId);
  const tab = await chrome.tabs.create({ url: url ?? 'about:blank', windowId, active: true });
  return tab.id;
}
