import { SECTIONS, buildExport, parseImport, type Section } from '../lib/backup';
import { send } from '../lib/messages';
import { getLocal, getSettings } from '../lib/storage';
import { h } from '../shared/dom';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function loadSettings(): Promise<void> {
  const settings = await getSettings();
  $<HTMLInputElement>('archiveAfterHours').value = String(settings.archiveAfterHours);
  $<HTMLInputElement>('archiveRetentionDays').value = String(settings.archiveRetentionDays);
}

$<HTMLFormElement>('settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  await send({
    type: 'updateSettings',
    settings: {
      archiveAfterHours: Number($<HTMLInputElement>('archiveAfterHours').value),
      archiveRetentionDays: Number($<HTMLInputElement>('archiveRetentionDays').value),
    },
  });
  $('saved').textContent = 'Saved';
  setTimeout(() => ($('saved').textContent = ''), 1500);
});

async function loadCommands(): Promise<void> {
  const commands = await chrome.commands.getAll();
  $('commands').replaceChildren(
    ...commands
      .filter((c) => c.name && c.name !== '_execute_action')
      .map((c) =>
        h(
          'tr',
          {},
          h('td', {}, c.description ?? c.name ?? ''),
          h('td', {}, c.shortcut ? h('kbd', {}, c.shortcut) : h('span', { class: 'unset' }, 'Not set')),
        ),
      ),
  );
}

$('editShortcuts').addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

const SECTION_PREF = 'exportSections';

function savedSections(): Section[] {
  try {
    const raw = localStorage.getItem(SECTION_PREF);
    if (raw) return JSON.parse(raw) as Section[];
  } catch {
    // Storage blocked; fall through to the default.
  }
  return ['appearance'];
}

const sectionBoxes = (Object.keys(SECTIONS) as Section[]).map((key) => {
  const box = h('input', { type: 'checkbox', value: key, checked: savedSections().includes(key) });
  box.addEventListener('change', () => {
    try {
      localStorage.setItem(SECTION_PREF, JSON.stringify(chosenSections()));
    } catch {
      // Only a convenience.
    }
  });
  return { key, box, label: h('label', {}, box, SECTIONS[key]) };
});
$('sections').replaceChildren(...sectionBoxes.map((s) => s.label));

function chosenSections(): Section[] {
  return sectionBoxes.filter((s) => s.box.checked).map((s) => s.key);
}

$('export').addEventListener('click', async () => {
  const sections = chosenSections();
  const status = $('backupStatus');
  if (sections.length === 0) {
    status.textContent = 'Pick at least one thing to export';
    return;
  }
  const data = buildExport(sections, {
    layout: await getLocal('layout'),
    archive: await getLocal('archive'),
    settings: await getSettings(),
  });
  const suffix = sections.length === 1 ? `-${sections[0]}` : '';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', {
    href: URL.createObjectURL(blob),
    download: `archaic-sidebar${suffix}-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  status.textContent = `Exported: ${sections.map((k) => SECTIONS[k]).join(', ')}`;
});

$<HTMLInputElement>('import').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const status = $('backupStatus');
  try {
    const data: unknown = JSON.parse(await file.text());
    const { sections } = parseImport(data);
    await send({ type: 'importData', data });
    status.textContent = `Imported: ${sections.map((k) => SECTIONS[k]).join(', ')}`;
    await loadSettings();
  } catch (err) {
    status.textContent = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void loadCommands();
});

void loadSettings();
void loadCommands();
