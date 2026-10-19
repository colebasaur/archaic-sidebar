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

async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 1200);
}

export async function copyText(text: string): Promise<void> {
  try {
    await ensureOffscreen();
    const message: OffscreenCopyMessage = { offscreen: 'copy', text };
    const ok = (await chrome.runtime.sendMessage(message)) as boolean;
    if (!ok) throw new Error('copy failed');
    await flashBadge('✓', '#3a7d44');
  } catch (err) {
    console.error('Copy failed', err);
    await flashBadge('!', '#b3261e');
  }
}
