import { getSession, getSettings, setSession } from '../lib/storage';
import { archiveTabs, purgeArchive } from './actions';
import { serial } from './serial';

export const SWEEP_ALARM = 'archive-sweep';

export function sweep(): Promise<void> {
  return serial(async () => {
    const [tabs, meta, bindings, settings] = await Promise.all([
      chrome.tabs.query({}),
      getSession('tabMeta'),
      getSession('bindings'),
      getSettings(),
    ]);
    const now = Date.now();
    const bound = new Set(Object.values(bindings));
    const cutoff = now - settings.archiveAfterHours * 3_600_000;

    // A tab you're looking at right now is never idle, however long it has been active.
    for (const tab of tabs) {
      if (tab.active && tab.id !== undefined) {
        meta[tab.id] = { ...(meta[tab.id] ?? { createdAt: now }), lastActiveAt: now };
      }
    }
    await setSession('tabMeta', meta);

    const stale = tabs.filter(
      (t) =>
        t.id !== undefined &&
        !t.active &&
        !t.pinned &&
        !t.audible &&
        !bound.has(t.id) &&
        (meta[t.id]?.lastActiveAt ?? now) < cutoff,
    );
    await archiveTabs(stale);
    await purgeArchive();
  });
}

export async function ensureSweepAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(SWEEP_ALARM))) {
    await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 5 });
  }
}
