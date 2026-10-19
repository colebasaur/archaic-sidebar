import type { ArchivedTab, Entry, Layout, PinnedNode, Settings } from './types';

export const SECTIONS = {
  pins: 'Pinned & favorites',
  appearance: 'Sidebar color & grain',
  archiveSettings: 'Archive settings',
  archive: 'Archive',
} as const;

export type Section = keyof typeof SECTIONS;

export interface ExportData {
  version: 2;
  layout?: Layout;
  archive?: ArchivedTab[];
  settings?: Partial<Settings>;
}

export function buildExport(
  sections: Section[],
  source: { layout: Layout; archive: ArchivedTab[]; settings: Settings },
): ExportData {
  const pick = new Set(sections);
  const settings: Partial<Settings> = {};
  if (pick.has('appearance')) {
    if (source.settings.sidebarColor) settings.sidebarColor = source.settings.sidebarColor;
    if (source.settings.sidebarGrain) settings.sidebarGrain = source.settings.sidebarGrain;
  }
  if (pick.has('archiveSettings')) {
    settings.archiveAfterHours = source.settings.archiveAfterHours;
    settings.archiveRetentionDays = source.settings.archiveRetentionDays;
  }
  return {
    version: 2,
    ...(pick.has('pins') ? { layout: source.layout } : {}),
    ...(pick.has('archive') ? { archive: source.archive } : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
  };
}

function isEntry(value: unknown): value is Entry {
  const v = value as Entry;
  return (
    v?.kind === 'entry' &&
    typeof v.id === 'string' &&
    typeof v.url === 'string' &&
    typeof v.title === 'string'
  );
}

function isNode(value: unknown): value is PinnedNode {
  const v = value as PinnedNode;
  if (isEntry(v)) return true;
  return (
    v?.kind === 'folder' &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    Array.isArray(v.children) &&
    v.children.every(isNode)
  );
}

export interface ParsedImport {
  layout?: Layout;
  archive?: ArchivedTab[];
  settings: Partial<Settings>;
  sections: Section[];
}

/**
 * Validates an export (v1 full backups or v2 partial ones) and returns only the parts it
 * actually contains, so importing never touches what the file doesn't mention.
 */
export function parseImport(data: unknown): ParsedImport {
  const d = data as Partial<Omit<ExportData, 'version'>> & { version?: number };
  if (d?.version !== 1 && d?.version !== 2) throw new Error('Not an Archaic Sidebar export');

  const result: ParsedImport = { settings: {}, sections: [] };
  const layout = d.layout;
  if (layout !== undefined) {
    if (
      !Array.isArray(layout?.favorites) ||
      !layout.favorites.every(isEntry) ||
      !Array.isArray(layout.pinned) ||
      !layout.pinned.every(isNode)
    ) {
      throw new Error('Pinned tabs in this file are malformed');
    }
    result.layout = layout;
    result.sections.push('pins');
  }

  const s = d.settings;
  const hasColor = typeof s?.sidebarColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.sidebarColor);
  const grain = Number(s?.sidebarGrain);
  const hasGrain = grain > 0 && grain <= 100;
  if (hasColor) result.settings.sidebarColor = s?.sidebarColor;
  if (hasGrain) result.settings.sidebarGrain = grain;
  if (hasColor || hasGrain) result.sections.push('appearance');
  if (Number(s?.archiveAfterHours) > 0 && Number(s?.archiveRetentionDays) > 0) {
    result.settings.archiveAfterHours = Number(s?.archiveAfterHours);
    result.settings.archiveRetentionDays = Number(s?.archiveRetentionDays);
    result.sections.push('archiveSettings');
  }

  if (Array.isArray(d.archive)) {
    result.archive = d.archive.filter(
      (a) =>
        typeof a?.id === 'string' &&
        typeof a.url === 'string' &&
        typeof a.title === 'string' &&
        typeof a.archivedAt === 'number',
    );
    result.sections.push('archive');
  }

  if (result.sections.length === 0) throw new Error('Nothing to import in this file');
  return result;
}
