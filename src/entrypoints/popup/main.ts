import { initSyncUI } from '../../ui/sync-ui';
import { initSettingsUI } from '../../ui/settings-ui';
import { initSetupWizard } from '../../ui/setup-wizard';

const mainContent = document.getElementById('main-content')!;
const wizardContainer = document.getElementById('setup-wizard')!;

function startApp() {
  initSyncUI({
    syncNowBtn: document.getElementById('sync-now-btn') as HTMLButtonElement,
    syncNowBtnText: document.getElementById('sync-now-btn-text')!,
    previewLink: document.getElementById('preview-link') as HTMLButtonElement,
    statusSummary: document.getElementById('status-summary')!,
    statusIcon: document.getElementById('status-icon')!,
    statusHeadline: document.getElementById('status-headline')!,
    statusDetail: document.getElementById('status-detail')!,
    progressArea: document.getElementById('progress-area')!,
    progressBar: document.getElementById('progress-bar')!,
    progressPhase: document.getElementById('progress-phase')!,
    errorBanner: document.getElementById('error-banner')!,
    errorBannerMessage: document.getElementById('error-banner-message')!,
    welcomeCard: document.getElementById('welcome-card')!,
    completionCard: document.getElementById('completion-card')!,
    completionMessage: document.getElementById('completion-message')!,
    completionDetailsToggle: document.getElementById(
      'completion-details-toggle',
    ) as HTMLButtonElement,
    completionDetails: document.getElementById('completion-details')!,
    completionDetailsContent: document.getElementById('completion-details-content')!,
    previewArea: document.getElementById('preview-area')!,
    previewBack: document.getElementById('preview-back') as HTMLButtonElement,
    previewSummary: document.getElementById('preview-summary')!,
    previewTable: document.getElementById('preview-table')!,
    previewApplyBtn: document.getElementById('preview-apply-btn') as HTMLButtonElement,
    previewApplyBtnText: document.getElementById('preview-apply-btn-text')!,
    activitySection: document.getElementById('activity-section')!,
    activityList: document.getElementById('activity-list')!,
    syncedSection: document.getElementById('synced-section')!,
    syncedEventsToggle: document.getElementById('synced-events-toggle') as HTMLButtonElement,
    syncedEventsLabel: document.getElementById('synced-events-label')!,
    syncedEventsPanel: document.getElementById('synced-events-panel')!,
    syncedEventsList: document.getElementById('synced-events-list')!,
    unsyncAllBtn: document.getElementById('unsync-all-btn') as HTMLButtonElement,
    autoSyncFooter: document.getElementById('auto-sync-footer')!,
    autoSyncStatusText: document.getElementById('auto-sync-status-text')!,
    mainContent,
  });

  initSettingsUI({
    settingsToggle: document.getElementById('settings-toggle') as HTMLButtonElement,
    settingsOverlay: document.getElementById('settings-overlay')!,
    settingsBack: document.getElementById('settings-back') as HTMLButtonElement,
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
    oooCalendarHint: document.getElementById('ooo-calendar-hint')!,
  });
}

const wizard = initSetupWizard(wizardContainer, (_workdayUrl: string) => {
  mainContent.classList.remove('hidden');
  startApp();
});

wizard.checkIfNeeded().then((needed) => {
  if (needed) {
    mainContent.classList.add('hidden');
  } else {
    startApp();
  }
});

// Wire up sidebar hint button (Chrome-only: Firefox doesn't have side panels)
const openSidepanelBtn = document.getElementById('open-sidepanel-btn');
const sidebarHint = document.getElementById('sidebar-hint');

if (typeof chrome === 'undefined' || !chrome.sidePanel) {
  // Firefox or browser without side panel support — hide the hint entirely
  if (sidebarHint) {
    sidebarHint.classList.add('hidden');
  }
} else if (openSidepanelBtn) {
  openSidepanelBtn.addEventListener('click', async () => {
    try {
      const currentWindow = await browser.windows.getCurrent();
      if (chrome.sidePanel && currentWindow.id != null) {
        await chrome.sidePanel.open({ windowId: currentWindow.id });
        window.close(); // close the popup
      }
    } catch {
      // sidePanel API might not be available — fallback message
      if (sidebarHint) {
        const textEl = sidebarHint.querySelector('.sidebar-hint-text');
        if (textEl) {
          textEl.textContent =
            'Right-click the extension icon in your toolbar and select "Open in side panel".';
        }
        openSidepanelBtn.remove();
      }
    }
  });
}
