import { setSession } from '../lib/storage';
import type { Message } from '../lib/types';
import * as actions from './actions';
import { SWEEP_ALARM, ensureSweepAlarm, sweep } from './archive';
import { registerCommands } from './commands';
import { watchForRebuilds } from './devReload';
import { backfillIcons, registerIconCapture } from './icons';
import { launch } from './launcher';
import { serial } from './serial';
import { registerSidepanelTracking } from './sidepanel';
import { reconcile, registerTabListeners } from './tabs';

function dispatch(msg: Message): Promise<void> {
  switch (msg.type) {
    case 'openEntry':
      return actions.openEntry(msg.id, msg.windowId);
    case 'closeEntryTab':
      return actions.closeEntryTab(msg.id);
    case 'resetEntry':
      return actions.resetEntry(msg.id);
    case 'renameNode':
      return actions.renameNode(msg.id, msg.title);
    case 'renameTab':
      return actions.renameTab(msg.tabId, msg.title);
    case 'pinTab':
      return actions.pinTab(msg.tabId, msg.target);
    case 'unpinNode':
      return actions.unpinNode(msg.id);
    case 'deleteFolder':
      return actions.deleteFolder(msg.id);
    case 'setFolderIcon':
      return actions.setFolderIcon(msg.id, msg.icon);
    case 'moveNode':
      return actions.moveNode(msg.id, msg.target);
    case 'createFolder':
      return actions.createFolder(msg.title, msg.id);
    case 'toggleFolder':
      return actions.toggleFolder(msg.id);
    case 'restoreArchived':
      return actions.restoreArchived(msg.id, msg.windowId);
    case 'undoArchive':
      return actions.undoArchive(msg.windowId);
    case 'deleteArchived':
      return actions.deleteArchived(msg.id);
    case 'clearPendingRename':
      return setSession('pendingRenameTabId', undefined);
    case 'launch':
      return launch(msg.target, msg.hostTabId);
    case 'importData':
      return actions.importData(msg.data);
    case 'updateSettings':
      return actions.updateSettings(msg.settings);
    case 'bulk':
      return actions.bulk(msg.op, msg.items, msg.folderId);
    case 'setEntryUrl':
      return actions.setEntryUrl(msg.id);
  }
}

if (import.meta.env.MODE === 'development') {
  void watchForRebuilds();
}

registerTabListeners();
registerIconCapture();
registerSidepanelTracking();
registerCommands();

chrome.runtime.onMessage.addListener((msg: Message | { offscreen: string }, _sender, respond) => {
  if ('offscreen' in msg) return false;
  serial(() => dispatch(msg))
    .then(() => {
      respond({ ok: true });
      if (msg.type === 'importData') void reconcile({ rebindByUrl: true });
      if (['pinTab', 'importData', 'bulk', 'setEntryUrl'].includes(msg.type)) void backfillIcons();
    })
    .catch((err: unknown) => {
      console.error(`Message ${msg.type} failed`, err);
      respond({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SWEEP_ALARM) return;
  void reconcile();
  void sweep().catch(console.error);
  void backfillIcons();
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureSweepAlarm();
  void reconcile({ rebindByUrl: true });
  void backfillIcons();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSweepAlarm();
  void reconcile({ rebindByUrl: true });
  void backfillIcons();
});
