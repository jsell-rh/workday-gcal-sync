import { initSyncUI } from '../../ui/sync-ui';
import { initSettingsUI } from '../../ui/settings-ui';

initSyncUI({
  checkBtn: document.getElementById('check-btn') as HTMLButtonElement,
  checkBtnText: document.getElementById('check-btn-text')!,
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
  previewArea: document.getElementById('preview-area')!,
  previewSummary: document.getElementById('preview-summary')!,
  previewTable: document.getElementById('preview-table')!,
  syncedEventsToggle: document.getElementById('synced-events-toggle') as HTMLButtonElement,
  syncedEventsPanel: document.getElementById('synced-events-panel')!,
  syncedEventsList: document.getElementById('synced-events-list')!,
  unsyncAllBtn: document.getElementById('unsync-all-btn') as HTMLButtonElement,
});

initSettingsUI({
  settingsToggle: document.getElementById('settings-toggle') as HTMLButtonElement,
  settingsPanel: document.getElementById('settings-panel')!,
  visibilitySelect: document.getElementById('visibility-select') as HTMLSelectElement,
  titleTemplateInput: document.getElementById('title-template') as HTMLInputElement,
  titlePreview: document.getElementById('title-preview')!,
  calendarCheckboxes: document.getElementById('calendar-checkboxes')!,
  workdayUrlInput: document.getElementById('workday-url') as HTMLInputElement,
  autoSyncCheckbox: document.getElementById('auto-sync-checkbox') as HTMLInputElement,
  autoSyncIntervalSelect: document.getElementById('auto-sync-interval') as HTMLSelectElement,
  autoSyncIntervalGroup: document.getElementById('auto-sync-interval-group')!,
  saveBtn: document.getElementById('save-settings') as HTMLButtonElement,
  settingsStatus: document.getElementById('settings-status')!,
});

// Wire up sidebar hint button
const openSidepanelBtn = document.getElementById('open-sidepanel-btn');
if (openSidepanelBtn) {
  openSidepanelBtn.addEventListener('click', async () => {
    try {
      // chrome.sidePanel.open requires a windowId
      const currentWindow = await chrome.windows.getCurrent();
      if (chrome.sidePanel && currentWindow.id != null) {
        await chrome.sidePanel.open({ windowId: currentWindow.id });
        window.close(); // close the popup
      }
    } catch {
      // sidePanel API might not be available — fallback message
      const hint = document.getElementById('sidebar-hint');
      if (hint) {
        const textEl = hint.querySelector('.sidebar-hint-text');
        if (textEl) {
          textEl.textContent =
            'Right-click the extension icon in your toolbar and select "Open in side panel".';
        }
        openSidepanelBtn.remove();
      }
    }
  });
}
