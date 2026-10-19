const REL_PRIORITY = ['icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'];

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/**
 * Icon URLs a page declares, best first, ending with the conventional /favicon.ico.
 * Regex rather than DOMParser because service workers don't have a DOM.
 */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const found: { url: string; rank: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase().trim().replace(/\s+/g, ' ');
    const href = attr(tag, 'href');
    if (!rel || !href) continue;
    const rank = REL_PRIORITY.indexOf(rel);
    if (rank < 0) continue;
    try {
      found.push({ url: new URL(href.replace(/&amp;/g, '&'), pageUrl).toString(), rank });
    } catch {
      // Unresolvable href; skip it.
    }
  }
  const ordered = found.sort((a, b) => a.rank - b.rank).map((f) => f.url);
  try {
    ordered.push(new URL('/favicon.ico', pageUrl).toString());
  } catch {
    // Not a fetchable page URL.
  }
  return [...new Set(ordered)];
}

export function sameSite(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    const strip = (host: string) => host.replace(/^www\./, '');
    return strip(new URL(a).hostname) === strip(new URL(b).hostname);
  } catch {
    return false;
  }
}
