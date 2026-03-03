import { initSyncUI } from '../../ui/sync-ui';
import { initSettingsUI } from '../../ui/settings-ui';

initSyncUI({
  syncBtn: document.getElementById('sync-btn') as HTMLButtonElement,
  lastSyncValue: document.getElementById('last-sync-value')!,
  syncStats: document.getElementById('sync-stats')!,
  statFound: document.getElementById('stat-found')!,
  statSynced: document.getElementById('stat-synced')!,
  statSkipped: document.getElementById('stat-skipped')!,
  logArea: document.getElementById('log-area')!,
});

initSettingsUI({
  settingsToggle: document.getElementById('settings-toggle') as HTMLButtonElement,
  settingsPanel: document.getElementById('settings-panel')!,
  visibilitySelect: document.getElementById('visibility-select') as HTMLSelectElement,
  titleTemplateInput: document.getElementById('title-template') as HTMLInputElement,
  titlePreview: document.getElementById('title-preview')!,
  calendarSelect: document.getElementById('calendar-select') as HTMLSelectElement,
  workdayUrlInput: document.getElementById('workday-url') as HTMLInputElement,
  saveBtn: document.getElementById('save-settings') as HTMLButtonElement,
  settingsStatus: document.getElementById('settings-status')!,
});
