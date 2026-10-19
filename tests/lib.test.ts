import { describe, expect, it } from 'vitest';
import { serial } from '../src/background/serial';
import { buildExport, parseImport } from '../src/lib/backup';
import { fuzzyScore } from '../src/lib/fuzzy';
import { iconCandidates, sameSite } from '../src/lib/icons';
import { cursorIndex, planNav, sidebarItems, type SidebarItem } from '../src/lib/nav';
import { todayTabs } from '../src/lib/order';
import { CONFIDENT_SCORE, rank, type Candidate } from '../src/lib/rank';
import {
  ancestorFolders,
  containsNode,
  findNode,
  insertNode,
  removeNode,
  walkEntries,
} from '../src/lib/tree';
import type { Entry, Folder, Layout, PinnedNode } from '../src/lib/types';
import { cleanUrl, markdownLink, toUrl } from '../src/lib/url';
import { isDarkColor } from '../src/shared/sidebarTheme';

const entry = (id: string, url = `https://${id}.test/`): Entry => ({
  kind: 'entry',
  id,
  url,
  title: id,
});
const folder = (id: string, children: PinnedNode[] = []): Folder => ({
  kind: 'folder',
  id,
  title: id,
  collapsed: false,
  children,
});

describe('tree', () => {
  const build = () => [entry('a'), folder('f', [entry('b'), folder('g', [entry('c')])]), entry('d')];

  it('walks entries depth-first', () => {
    expect(walkEntries(build()).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each([
    ['a', 'a'],
    ['c', 'c'],
    ['g', 'g'],
    ['missing', undefined],
  ])('finds %s', (id, expected) => {
    expect(findNode(build(), id)?.id).toBe(expected);
  });

  it('removes nested nodes in place', () => {
    const nodes = build();
    expect(removeNode(nodes, 'c')?.id).toBe('c');
    expect(walkEntries(nodes).map((e) => e.id)).toEqual(['a', 'b', 'd']);
  });

  it.each([
    { parentId: undefined, beforeId: 'd', expected: ['a', 'b', 'c', 'x', 'd'] },
    { parentId: undefined, beforeId: undefined, expected: ['a', 'b', 'c', 'd', 'x'] },
    { parentId: 'f', beforeId: 'b', expected: ['a', 'x', 'b', 'c', 'd'] },
    { parentId: 'g', beforeId: undefined, expected: ['a', 'b', 'c', 'x', 'd'] },
    { parentId: 'f', beforeId: 'missing', expected: ['a', 'b', 'c', 'x', 'd'] },
  ])('inserts into $parentId before $beforeId', ({ parentId, beforeId, expected }) => {
    const nodes = build();
    insertNode(nodes, entry('x'), parentId, beforeId);
    expect(walkEntries(nodes).map((e) => e.id)).toEqual(expected);
  });

  it.each([
    ['c', ['f', 'g']],
    ['b', ['f']],
    ['a', []],
    ['missing', []],
  ])('lists folders enclosing %s', (id, expected) => {
    expect(ancestorFolders(build(), id).map((f) => f.id)).toEqual(expected);
  });

  it('detects descendants so a folder cannot move into itself', () => {
    const [, f] = build();
    expect(containsNode(f, 'g')).toBe(true);
    expect(containsNode(f, 'a')).toBe(false);
  });
});

describe('url', () => {
  it.each([
    ['https://a.test/?utm_source=x&id=1&fbclid=y', 'https://a.test/?id=1'],
    ['https://a.test/p?gclid=1', 'https://a.test/p'],
    ['https://a.test/p?q=1#frag', 'https://a.test/p?q=1#frag'],
    ['not a url', 'not a url'],
  ])('cleans %s', (input, expected) => {
    expect(cleanUrl(input)).toBe(expected);
  });

  it.each([
    ['example.com', 'https://example.com'],
    ['example.com/path?q=1', 'https://example.com/path?q=1'],
    ['https://x.test', 'https://x.test'],
    ['localhost:3000/api', 'http://localhost:3000/api'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['chrome://extensions', 'chrome://extensions'],
    ['how to tie a tie', undefined],
    ['pytest', undefined],
    ['', undefined],
  ])('toUrl(%j)', (input, expected) => {
    expect(toUrl(input)).toBe(expected);
  });

  it('escapes markdown links', () => {
    expect(markdownLink('a [b] c', 'https://x.test/(1)')).toBe(
      '[a \\[b\\] c](https://x.test/(1%29)',
    );
  });
});

describe('order', () => {
  const tabs = [
    { id: 1, index: 0 },
    { id: 2, index: 1 },
    { id: 3, index: 2 },
    { id: 4, index: 3 },
  ];
  const meta = {
    2: { createdAt: 300, lastActiveAt: 0 },
    3: { createdAt: 100, lastActiveAt: 0 },
    4: { createdAt: 200, lastActiveAt: 0 },
  };

  it('lists unbound tabs newest first', () => {
    expect(todayTabs(tabs, { e: 1 }, meta).map((t) => t.id)).toEqual([2, 4, 3]);
  });
});

describe('nav', () => {
  const tabs = [
    { id: 1, index: 0 },
    { id: 2, index: 1 },
    { id: 3, index: 2 },
    { id: 4, index: 3 },
  ];
  const meta = {
    2: { createdAt: 300, lastActiveAt: 0 },
    4: { createdAt: 200, lastActiveAt: 0 },
  };
  const layout: Layout = {
    favorites: [entry('fav')],
    pinned: [
      folder('f', [entry('pin'), entry('closed')]),
      { ...folder('g', [entry('hidden')]), collapsed: true },
      entry('elsewhere'),
    ],
  };
  const bindings = { fav: 3, pin: 1, elsewhere: 99 };
  const items = sidebarItems(layout, tabs, bindings, meta);
  const inWindow = (id: string) => (id in bindings && bindings[id as keyof typeof bindings] !== 99
    ? bindings[id as keyof typeof bindings]
    : undefined);
  const key = (it: SidebarItem) => (it.kind === 'tab' ? `tab:${it.tabId}` : `${it.kind}:${it.id}`);

  it('lists favorites, visible pinned tree, then today; other-window pins count as closed', () => {
    expect(items.map(key)).toEqual([
      'entry:fav',
      'folder:f',
      'entry:pin',
      'entry:closed',
      'folder:g',
      'entry:elsewhere',
      'tab:2',
      'tab:4',
    ]);
    expect(items.find((it) => it.kind === 'entry' && it.id === 'elsewhere')).toMatchObject({
      tabId: undefined,
    });
  });

  it.each([
    { name: 'stored cursor', cursor: { kind: 'node', id: 'f' } as const, active: 1, expected: 1 },
    { name: 'active tab fallback', cursor: undefined, active: 1, expected: 2 },
    { name: 'stale cursor', cursor: { kind: 'node', id: 'gone' } as const, active: 4, expected: 7 },
    { name: 'nothing', cursor: undefined, active: 42, expected: -1 },
  ])('finds cursor index: $name', ({ cursor, active, expected }) => {
    expect(cursorIndex(items, cursor, active)).toBe(expected);
  });

  it.each([
    { from: 'fav', action: 'down', plan: { cursor: { kind: 'node', id: 'f' } } },
    { from: 'f', action: 'down', plan: { activate: 1 } },
    { from: 'pin', action: 'down', plan: { cursor: { kind: 'node', id: 'closed' } } },
    { from: 'fav', action: 'up', plan: { activate: 4 } },
    { from: 'none', action: 'down', plan: { activate: 3 } },
    { from: 'f', action: 'in', plan: { activate: 1 } },
    {
      from: 'g',
      action: 'in',
      plan: { setCollapsed: { id: 'g', collapsed: false }, cursor: { kind: 'node', id: 'hidden' } },
    },
    { from: 'closed', action: 'in', plan: { open: 'closed' } },
    { from: 'tab:2', action: 'in', plan: {} },
    {
      from: 'pin',
      action: 'out',
      plan: { setCollapsed: { id: 'f', collapsed: true }, cursor: { kind: 'node', id: 'f' } },
    },
    {
      from: 'f',
      action: 'out',
      plan: { setCollapsed: { id: 'f', collapsed: true }, cursor: { kind: 'node', id: 'f' } },
    },
    { from: 'g', action: 'out', plan: {} },
    { from: 'tab:2', action: 'out', plan: {} },
  ] as const)('$action from $from', ({ from, action, plan }) => {
    const index = items.findIndex((it) => key(it).endsWith(`:${from}`) || key(it) === from);
    expect(planNav(layout, items, index, action, inWindow)).toEqual(plan);
  });
});

describe('fuzzy + rank', () => {
  it.each([
    ['gl', 'GitLab', true],
    ['gtlb', 'GitLab', true],
    ['xyz', 'GitLab', false],
  ])('%s matches %s: %s', (q, text, matches) => {
    expect(fuzzyScore(q, text) >= 0).toBe(matches);
  });

  it('prefers substring and word-start matches', () => {
    expect(fuzzyScore('lab', 'GitLab')).toBeGreaterThan(fuzzyScore('lab', 'Lots about bananas'));
    expect(fuzzyScore('mr', 'MR dashboard')).toBeGreaterThan(fuzzyScore('mr', 'summer'));
  });

  const candidate = (kind: Candidate['kind'], title: string, url: string): Candidate => ({
    kind,
    title,
    url,
    target: { kind: 'url', url },
  });

  it('dedupes by URL keeping the most actionable kind', () => {
    const ranked = rank('jira', [
      candidate('history', 'Jira board', 'https://jira.test/'),
      candidate('tab', 'Jira board', 'https://jira.test/'),
      candidate('bookmark', 'Jira docs', 'https://jira.test/docs'),
    ]);
    expect(ranked.map((r) => [r.kind, r.url])).toEqual([
      ['tab', 'https://jira.test/'],
      ['bookmark', 'https://jira.test/docs'],
    ]);
  });

  it('flags confident substring matches but not loose ones', () => {
    const [strong] = rank('notion', [candidate('history', 'Notion', 'https://notion.so')]);
    const [weak] = rank('ntn', [candidate('history', 'Notion', 'https://example.test')]);
    expect(strong.score).toBeGreaterThanOrEqual(CONFIDENT_SCORE);
    expect(weak.score).toBeLessThan(CONFIDENT_SCORE);
  });
});

describe('serial', () => {
  it('runs tasks one at a time even if one fails', async () => {
    const log: string[] = [];
    const task = (name: string, ms: number, fail = false) =>
      serial(async () => {
        log.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`end ${name}`);
        if (fail) throw new Error(name);
      });
    const results = await Promise.allSettled([task('a', 20, true), task('b', 1)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('sidebar theme', () => {
  it.each([
    ['#e9e4f2', false],
    ['#f6e2d6', false],
    ['#ffffff', false],
    ['#2b2f3a', true],
    ['#1b1f2e', true],
    ['#000000', true],
  ])('%s is dark: %s', (color, dark) => {
    expect(isDarkColor(color)).toBe(dark);
  });
});

describe('icons', () => {
  it('orders declared icons by rel and appends /favicon.ico', () => {
    const html = `
      <link rel="apple-touch-icon" href="/apple.png">
      <link href='//cdn.test/i.svg' rel='icon' type='image/svg+xml'>
      <link rel="Shortcut  Icon" href="fav.png?v=1&amp;x=2">
      <link rel="stylesheet" href="/style.css">`;
    expect(iconCandidates(html, 'https://app.test/a/b')).toEqual([
      'https://cdn.test/i.svg',
      'https://app.test/a/fav.png?v=1&x=2',
      'https://app.test/apple.png',
      'https://app.test/favicon.ico',
    ]);
  });

  it('falls back to /favicon.ico with no declared icons', () => {
    expect(iconCandidates('', 'https://x.test/deep/page')).toEqual(['https://x.test/favicon.ico']);
  });

  it.each([
    ['https://www.gitlab.com/a', 'https://gitlab.com/b', true],
    ['https://mail.google.com/mail/u/0', 'https://mail.google.com/', true],
    ['https://accounts.google.com/', 'https://mail.google.com/', false],
    [undefined, 'https://x.test', false],
  ])('sameSite(%s, %s) is %s', (a, b, expected) => {
    expect(sameSite(a, b)).toBe(expected);
  });
});

describe('backup', () => {
  const source = {
    layout: { favorites: [entry('fav')], pinned: [folder('f', [entry('a')])] } as Layout,
    archive: [{ id: 'x', url: 'https://x.test', title: 'x', archivedAt: 1 }],
    settings: {
      archiveAfterHours: 12,
      archiveRetentionDays: 30,
      sidebarColor: '#2b2f3a',
      sidebarGrain: 40,
    },
  };

  it('exports only the chosen sections', () => {
    expect(buildExport(['appearance'], source)).toEqual({
      version: 2,
      settings: { sidebarColor: '#2b2f3a', sidebarGrain: 40 },
    });
    expect(Object.keys(buildExport(['pins', 'archive'], source)).sort()).toEqual([
      'archive',
      'layout',
      'version',
    ]);
  });

  it.each([
    [['appearance'], ['appearance']],
    [['appearance', 'archiveSettings'], ['appearance', 'archiveSettings']],
    [['pins', 'appearance', 'archiveSettings', 'archive'],
      ['pins', 'appearance', 'archiveSettings', 'archive']],
  ] as const)('round-trips %j', (chosen, expected) => {
    const parsed = parseImport(JSON.parse(JSON.stringify(buildExport([...chosen], source))));
    expect(parsed.sections).toEqual(expected);
  });

  it('leaves untouched sections out of a color-only import', () => {
    const parsed = parseImport(buildExport(['appearance'], source));
    expect(parsed.layout).toBeUndefined();
    expect(parsed.archive).toBeUndefined();
    expect(parsed.settings).toEqual({ sidebarColor: '#2b2f3a', sidebarGrain: 40 });
  });

  it('still reads v1 full backups', () => {
    const parsed = parseImport({ version: 1, ...source });
    expect(parsed.sections).toEqual(['pins', 'appearance', 'archiveSettings', 'archive']);
  });

  it.each([
    [{ version: 3 }, 'Not an Archaic Sidebar export'],
    [{ version: 2 }, 'Nothing to import'],
    [{ version: 2, layout: { favorites: 'nope', pinned: [] } }, 'malformed'],
  ])('rejects %j', (data, message) => {
    expect(() => parseImport(data)).toThrow(message);
  });
});
