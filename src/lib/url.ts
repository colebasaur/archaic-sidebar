const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'yclid',
  '_hsenc',
  '_hsmi',
  'ref_src',
  'ref_url',
  'si',
]);

export function cleanUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_') || TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function markdownLink(title: string, url: string): string {
  const safeTitle = title.replace(/([[\]\\])/g, '\\$1');
  return `[${safeTitle}](${url.replace(/\)/g, '%29')})`;
}

/**
 * Returns a navigable URL if the input looks like one, otherwise undefined
 * (meaning the input should be treated as a search).
 */
export function toUrl(input: string): string | undefined {
  const text = input.trim();
  if (!text || /\s/.test(text)) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|chrome|data|file):/i.test(text)) {
    return text;
  }
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) {
    return `http://${text}`;
  }
  if (/^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(text)) return `https://${text}`;
  return undefined;
}

/** Remote or inline icons worth remembering; chrome:// and oversized data URLs are not. */
export function isStorableIcon(url: string | undefined): url is string {
  return !!url && (/^https?:/.test(url) || (url.startsWith('data:') && url.length < 8192));
}

export function faviconUrl(pageUrl: string, size = 32): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}

export function displayHost(raw: string): string {
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw;
  }
}

export function isLauncherUrl(raw: string | undefined): boolean {
  return !!raw && raw.startsWith(chrome.runtime.getURL('launcher/'));
}
