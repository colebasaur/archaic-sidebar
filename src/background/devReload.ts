const STAMP_PATH = 'dev-build.txt';

async function readStamp(): Promise<string | undefined> {
  try {
    const response = await fetch(chrome.runtime.getURL(STAMP_PATH), { cache: 'no-store' });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Dev only: unpacked extensions read files straight from disk, so polling the stamp that
 * `vite build --watch` rewrites is enough to notice a rebuild and reload ourselves.
 */
export async function watchForRebuilds(): Promise<void> {
  let current = await readStamp();
  setInterval(async () => {
    // Any extension API call resets the idle timer, keeping the worker (and this poll) alive.
    await chrome.runtime.getPlatformInfo();
    const next = await readStamp();
    if (next && current && next !== current) chrome.runtime.reload();
    current ??= next;
  }, 1000);
}
