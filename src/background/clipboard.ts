const OFFSCREEN_PATH = 'offscreen/index.html';

export interface OffscreenCopyMessage {
  offscreen: 'copy';
  text: string;
}

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length > 0) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Copy the current tab URL/title from keyboard shortcuts',
    });
  } catch (err) {
    // Two copies racing can both see "no document"; the loser's create fails harmlessly.
    if (!String(err).includes('single offscreen')) throw err;
  }
}

const TOAST_ID = 'archaic-sidebar-copy-toast';

/** Runs in the page; must be self-contained. Shows a brief pill at the top of the page. */
function injectToast(message: string, ok: boolean, toastId: string): void {
  document.getElementById(toastId)?.remove();
  const host = document.createElement('div');
  host.id = toastId;
  host.style.cssText =
    'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'pointer-events:none;';
  const pill = document.createElement('div');
  pill.textContent = message;
  pill.style.cssText =
    'font:500 13px/1.2 system-ui,-apple-system,sans-serif;color:#fff;padding:8px 14px;' +
    `border-radius:999px;background:${ok ? '#2f6f3a' : '#b3261e'};` +
    'box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:0;transform:translateY(-6px);' +
    'transition:opacity .15s ease,transform .15s ease;';
  host.attachShadow({ mode: 'open' }).appendChild(pill);
  document.documentElement.appendChild(host);
  requestAnimationFrame(() => {
    pill.style.opacity = '1';
    pill.style.transform = 'none';
  });
  setTimeout(() => {
    pill.style.opacity = '0';
    setTimeout(() => host.remove(), 200);
  }, 1400);
}

async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 1200);
}

async function notify(tabId: number | undefined, message: string, ok: boolean): Promise<void> {
  await flashBadge(ok ? '✓' : '!', ok ? '#3a7d44' : '#b3261e');
  if (tabId === undefined) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: injectToast,
      args: [message, ok, TOAST_ID],
    });
  } catch {
    // chrome:// and Web Store pages can't be scripted; the badge is all they get.
  }
}

export async function copyText(text: string, label: string, tabId?: number): Promise<void> {
  try {
    await ensureOffscreen();
    const message: OffscreenCopyMessage = { offscreen: 'copy', text };
    const ok = (await chrome.runtime.sendMessage(message)) as boolean;
    if (!ok) throw new Error('copy failed');
    await notify(tabId, `Copied ${label}`, true);
  } catch (err) {
    console.error('Copy failed', err);
    await notify(tabId, `Couldn't copy ${label}`, false);
  }
}
