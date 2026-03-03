import { initSyncUI } from '../../ui/sync-ui';
import { initSettingsUI } from '../../ui/settings-ui';

initSyncUI({
  syncBtn: document.getElementById('sync-btn') as HTMLButtonElement,
  syncBtnText: document.getElementById('sync-btn-text')!,
  lastSyncValue: document.getElementById('last-sync-value')!,
  syncStats: document.getElementById('sync-stats')!,
  statFound: document.getElementById('stat-found')!,
  statSynced: document.getElementById('stat-synced')!,
  statSkipped: document.getElementById('stat-skipped')!,
  statErrorsContainer: document.getElementById('stat-errors-container')!,
  statErrors: document.getElementById('stat-errors')!,
  logArea: document.getElementById('log-area')!,
  logWrapper: document.getElementById('log-wrapper')!,
  logToggle: document.getElementById('log-toggle') as HTMLButtonElement,
  logToggleArrow: document.getElementById('log-toggle-arrow')!,
  progressArea: document.getElementById('progress-area')!,
  progressBar: document.getElementById('progress-bar')!,
  progressText: document.getElementById('progress-text')!,
  errorBanner: document.getElementById('error-banner')!,
  errorBannerMessage: document.getElementById('error-banner-message')!,
  successBanner: document.getElementById('success-banner')!,
  successMessage: document.getElementById('success-message')!,
  welcomeCard: document.getElementById('welcome-card')!,
});

initSettingsUI({
  settingsToggle: document.getElementById('settings-toggle') as HTMLButtonElement,
  settingsPanel: document.getElementById('settings-panel')!,
  visibilitySelect: document.getElementById('visibility-select') as HTMLSelectElement,
  titleTemplateInput: document.getElementById('title-template') as HTMLInputElement,
  titlePreview: document.getElementById('title-preview')!,
  calendarCheckboxes: document.getElementById('calendar-checkboxes')!,
  workdayUrlInput: document.getElementById('workday-url') as HTMLInputElement,
  saveBtn: document.getElementById('save-settings') as HTMLButtonElement,
  settingsStatus: document.getElementById('settings-status')!,
});
