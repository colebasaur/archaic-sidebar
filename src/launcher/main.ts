import { send } from '../lib/messages';
import { CONFIDENT_SCORE, rank, type Candidate, type CandidateKind } from '../lib/rank';
import { getLocal, getSession } from '../lib/storage';
import { walkEntries } from '../lib/tree';
import type { LauncherMode, LauncherTarget } from '../lib/types';
import { displayHost, faviconUrl, isLauncherUrl, toUrl } from '../lib/url';
import { favicon, h } from '../shared/dom';

interface Row {
  title: string;
  url?: string;
  label: string;
  glyph?: string;
  target: LauncherTarget;
}

const KIND_LABEL: Record<CandidateKind, string> = {
  tab: 'Switch to tab',
  entry: 'Pinned',
  archived: 'Archived',
  bookmark: 'Bookmark',
  history: 'History',
};

const params = new URLSearchParams(location.search);
const mode = params.get('mode') as LauncherMode;
const input = document.getElementById('query') as HTMLInputElement;
const list = document.getElementById('results') as HTMLUListElement;
const backdrop = document.getElementById('backdrop') as HTMLElement;

let hostTabId = params.has('host') ? Number(params.get('host')) : undefined;
let rows: Row[] = [];
let selected = 0;
let searchSeq = 0;

function close(): void {
  if (mode === 'overlay') window.parent.postMessage({ type: 'arc-launcher-close' }, '*');
  else if (mode === 'popup') window.close();
}

async function baseCandidates(): Promise<Candidate[]> {
  const [tabs, layout, bindings, meta, archive] = await Promise.all([
    chrome.tabs.query({}),
    getLocal('layout'),
    getSession('bindings'),
    getSession('tabMeta'),
    getLocal('archive'),
  ]);
  const bound = new Set(Object.values(bindings));
  const tabCandidates: Candidate[] = tabs
    .filter((t) => t.id !== undefined && t.id !== hostTabId && !bound.has(t.id) && t.url)
    .filter((t) => !isLauncherUrl(t.url) && !t.url?.startsWith('chrome://newtab'))
    .map((t) => ({
      kind: 'tab',
      title: meta[t.id as number]?.customTitle || t.title || t.url || '',
      url: t.url as string,
      target: { kind: 'tab', tabId: t.id as number },
      bonus: Math.max(0, 100 - (Date.now() - (meta[t.id as number]?.lastActiveAt ?? 0)) / 3_600_000),
    }));
  const entryCandidates: Candidate[] = [...layout.favorites, ...walkEntries(layout.pinned)].map(
    (e) => ({
      kind: 'entry',
      title: e.customTitle || e.title,
      url: e.url,
      target: { kind: 'entry', id: e.id },
    }),
  );
  const archiveCandidates: Candidate[] = archive.map((a) => ({
    kind: 'archived',
    title: a.title,
    url: a.url,
    target: { kind: 'archived', id: a.id },
  }));
  return [...tabCandidates, ...entryCandidates, ...archiveCandidates];
}

async function remoteCandidates(query: string): Promise<Candidate[]> {
  const [bookmarks, history] = await Promise.all([
    chrome.bookmarks.search(query),
    chrome.history.search({ text: query, startTime: 0, maxResults: 50 }),
  ]);
  return [
    ...bookmarks
      .filter((b) => b.url && !b.url.startsWith('javascript:'))
      .map((b): Candidate => ({
        kind: 'bookmark',
        title: b.title || (b.url as string),
        url: b.url as string,
        target: { kind: 'url', url: b.url as string },
      })),
    ...history
      .filter((item) => item.url)
      .map((item): Candidate => ({
        kind: 'history',
        title: item.title || (item.url as string),
        url: item.url as string,
        target: { kind: 'url', url: item.url as string },
        bonus: (item.visitCount ?? 0) * 2,
      })),
  ];
}

function toRow(c: Candidate): Row {
  return { title: c.title, url: c.url, label: KIND_LABEL[c.kind], target: c.target };
}

async function update(): Promise<void> {
  const seq = ++searchSeq;
  const query = input.value.trim();
  const base = await baseCandidates();
  if (seq !== searchSeq) return;

  if (!query) {
    const tabs = base
      .filter((c) => c.kind === 'tab')
      .sort((a, b) => (b.bonus ?? 0) - (a.bonus ?? 0))
      .slice(0, 5);
    const seen = new Set(tabs.map((t) => t.url));
    const history = (await chrome.history.search({ text: '', maxResults: 30 }))
      .filter((item) => item.url && !seen.has(item.url) && !item.url.startsWith('javascript:'))
      .slice(0, 10 - tabs.length)
      .map((item): Candidate => ({
        kind: 'history',
        title: item.title || (item.url as string),
        url: item.url as string,
        target: { kind: 'url', url: item.url as string },
      }));
    if (seq === searchSeq) show([...tabs, ...history].map(toRow));
    return;
  }

  const url = toUrl(query);
  const action: Row = url
    ? { title: url, label: 'Open', glyph: '↗', target: { kind: 'url', url } }
    : { title: `Search for “${query}”`, label: 'Search', glyph: '⌕', target: { kind: 'search', text: query } };

  // Show local matches immediately; history and bookmarks can take a moment.
  const render = (candidates: Candidate[]) => {
    const ranked = rank(query, candidates);
    const confident = !url && ranked.length > 0 && ranked[0].score >= CONFIDENT_SCORE;
    const results = ranked.map(toRow);
    show(confident ? [...results, action] : [action, ...results]);
  };
  render(base);
  const remote = await remoteCandidates(query);
  if (seq === searchSeq) render([...base, ...remote]);
}

function rowKey(row: Row): string {
  return JSON.stringify(row.target);
}

/** Keeps the highlighted row selected when late results re-rank the list underneath it. */
function show(next: Row[]): void {
  const previous = rows[selected];
  rows = next;
  const kept = previous ? rows.findIndex((r) => rowKey(r) === rowKey(previous)) : -1;
  selected = kept >= 0 && input.dataset.moved === 'true' ? kept : 0;
  list.replaceChildren(
    ...rows.map((row, i) =>
      h(
        'li',
        {
          class: i === selected ? 'result selected' : 'result',
          role: 'option',
          onmousemove: () => {
            input.dataset.moved = 'true';
            select(i);
          },
          onclick: () => void choose(i),
        },
        row.glyph ? h('span', { class: 'glyph' }, row.glyph) : favicon(faviconUrl(row.url ?? '')),
        h(
          'span',
          { class: 'title' },
          row.title,
          row.url && row.url !== row.title && h('span', { class: 'url' }, displayHost(row.url)),
        ),
        h('span', { class: 'kind' }, row.label),
      ),
    ),
  );
}

function select(i: number): void {
  if (rows.length === 0) return;
  selected = (i + rows.length) % rows.length;
  list.querySelectorAll('.result').forEach((el, idx) => el.classList.toggle('selected', idx === selected));
  list.children[selected]?.scrollIntoView({ block: 'nearest' });
}

async function choose(i: number): Promise<void> {
  const row = rows[i];
  if (!row) return;
  try {
    await send({ type: 'launch', target: row.target, mode, hostTabId });
  } finally {
    close();
  }
}

input.addEventListener('input', () => {
  input.dataset.moved = 'false';
  void update();
});
input.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.key === 'ArrowDown' || (ctrl && (e.key === 'n' || e.key === 'j'))) {
    e.preventDefault();
    input.dataset.moved = 'true';
    select(selected + 1);
  } else if (e.key === 'ArrowUp' || (ctrl && (e.key === 'p' || e.key === 'k'))) {
    e.preventDefault();
    input.dataset.moved = 'true';
    select(selected - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    void choose(selected);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (input.value) {
      input.value = '';
      void update();
    } else {
      close();
    }
  }
});
backdrop.addEventListener('mousedown', (e) => {
  if (e.target === backdrop) close();
});
window.addEventListener('focus', () => input.focus());
if (mode === 'popup') window.addEventListener('blur', close);

/** Framed by any site in theory; only render when the background issued our token. */
async function authorized(): Promise<boolean> {
  const token = await getSession('launcherToken');
  return !!token && token === params.get('token');
}

async function init(): Promise<void> {
  document.documentElement.classList.add(mode);
  if (!(await authorized())) {
    backdrop.remove();
    return;
  }
  input.focus();
  await update();
}

void init();
