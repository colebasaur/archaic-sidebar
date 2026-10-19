import { getSession, setSession } from '../lib/storage';

export const SIDEPANEL_PORT = 'sidepanel';

// In memory because toggle must decide synchronously; mirrored to session storage so a
// restarted service worker still knows which panels are open.
const openWindows = new Set<number>();
void getSession('sidepanelWindows').then((ids) => ids.forEach((id) => openWindows.add(id)));

function persist(): void {
  void setSession('sidepanelWindows', [...openWindows]);
}

export function registerSidepanelTracking(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SIDEPANEL_PORT) return;
    let windowId: number | undefined;
    port.onMessage.addListener((msg: { windowId: number }) => {
      windowId = msg.windowId;
      openWindows.add(windowId);
      persist();
    });
    port.onDisconnect.addListener(() => {
      if (windowId === undefined) return;
      openWindows.delete(windowId);
      persist();
    });
  });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

/**
 * Must be called synchronously from a user gesture (command / action click):
 * sidePanel.open() rejects if anything is awaited first.
 */
export function openSidepanel(windowId: number): Promise<void> {
  return chrome.sidePanel.open({ windowId });
}

export function toggleSidepanel(windowId: number): Promise<void> {
  if (openWindows.has(windowId)) return chrome.sidePanel.close({ windowId });
  return openSidepanel(windowId);
}
