import type { SyncSettings } from '../domain/model/settings';
import { DEFAULT_SETTINGS } from '../domain/model/settings';

const TOTAL_STEPS = 4;

export function initSetupWizard(
  container: HTMLElement,
  onComplete: (workdayUrl: string) => void,
): { checkIfNeeded: () => Promise<boolean> } {
  let currentStep = 0;
  let detectedUrl = '';
  let calendarConnected = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function render() {
    container.innerHTML = '';
    container.classList.remove('hidden');

    const wrapper = document.createElement('div');
    wrapper.className = 'wizard-wrapper';

    // Step indicator
    const stepIndicator = document.createElement('div');
    stepIndicator.className = 'wizard-step-indicator';
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const dot = document.createElement('span');
      dot.className = `wizard-dot${i === currentStep ? ' active' : ''}${i < currentStep ? ' completed' : ''}`;
      stepIndicator.appendChild(dot);
    }
    const stepLabel = document.createElement('span');
    stepLabel.className = 'wizard-step-label';
    stepLabel.textContent = `Step ${currentStep + 1} of ${TOTAL_STEPS}`;
    stepIndicator.appendChild(stepLabel);
    wrapper.appendChild(stepIndicator);

    if (currentStep === 0) {
      renderWelcome(wrapper);
    } else if (currentStep === 1) {
      renderFindWorkday(wrapper);
    } else if (currentStep === 2) {
      renderConnectCalendar(wrapper);
    } else if (currentStep === 3) {
      renderAllSet(wrapper);
    }

    container.appendChild(wrapper);
  }

  // --- Step 1: Welcome ---

  function renderWelcome(wrapper: HTMLElement) {
    const content = document.createElement('div');
    content.className = 'wizard-content';

    const title = document.createElement('h2');
    title.className = 'wizard-title';
    title.textContent = 'Welcome to PTO Sync!';

    const desc = document.createElement('p');
    desc.className = 'wizard-text';
    desc.textContent =
      'This extension reads your PTO entries from Workday and syncs them to Google Calendar.';

    const subtext = document.createElement('p');
    subtext.className = 'wizard-text wizard-subtext';
    subtext.textContent = "Let's get set up in under a minute.";

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn-primary wizard-btn';
    nextBtn.textContent = 'Get Started';
    nextBtn.addEventListener('click', () => {
      currentStep = 1;
      render();
    });

    content.appendChild(title);
    content.appendChild(desc);
    content.appendChild(subtext);
    content.appendChild(nextBtn);
    wrapper.appendChild(content);
  }

  // --- Step 2: Find Workday ---

  function renderFindWorkday(wrapper: HTMLElement) {
    const content = document.createElement('div');
    content.className = 'wizard-content';

    const title = document.createElement('h2');
    title.className = 'wizard-title';
    title.textContent = 'Find Your Workday Page';

    const desc = document.createElement('p');
    desc.className = 'wizard-text';
    desc.textContent =
      'Open your company\'s Workday and navigate to your "My Absence" page. We\'ll detect it automatically.';

    content.appendChild(title);
    content.appendChild(desc);

    // Detection status
    const statusArea = document.createElement('div');
    statusArea.className = 'wizard-detect-status';

    const statusIcon = document.createElement('span');
    statusIcon.className = 'wizard-detect-icon searching';
    statusIcon.textContent = '...';

    const statusText = document.createElement('span');
    statusText.className = 'wizard-detect-text';
    statusText.textContent = 'Looking for open Workday tabs...';

    statusArea.appendChild(statusIcon);
    statusArea.appendChild(statusText);
    content.appendChild(statusArea);

    const detectedArea = document.createElement('div');
    detectedArea.className = 'wizard-detected hidden';

    const detectedUrlEl = document.createElement('div');
    detectedUrlEl.className = 'wizard-detected-url';

    const useBtn = document.createElement('button');
    useBtn.className = 'btn-primary wizard-btn';
    useBtn.textContent = 'Use This URL';
    useBtn.addEventListener('click', () => {
      currentStep = 2;
      stopPolling();
      render();
    });

    detectedArea.appendChild(detectedUrlEl);
    detectedArea.appendChild(useBtn);
    content.appendChild(detectedArea);

    // Manual fallback
    const manualSection = document.createElement('div');
    manualSection.className = 'wizard-manual';

    const manualLabel = document.createElement('p');
    manualLabel.className = 'wizard-text wizard-subtext';
    manualLabel.textContent = 'Or enter the URL manually:';

    const manualInput = document.createElement('input');
    manualInput.type = 'url';
    manualInput.className = 'wizard-input';
    manualInput.placeholder = 'https://wd5.myworkday.com/yourcompany/...';

    const manualError = document.createElement('div');
    manualError.className = 'wizard-error hidden';
    manualError.textContent = 'Please enter a valid Workday URL (https://...myworkday.com/...).';

    const manualBtn = document.createElement('button');
    manualBtn.className = 'btn-secondary wizard-btn';
    manualBtn.textContent = 'Use This URL';
    manualBtn.addEventListener('click', () => {
      const url = manualInput.value.trim();
      if (!/^https:\/\/.*\.myworkday\.com\//.test(url)) {
        manualError.classList.remove('hidden');
        return;
      }
      manualError.classList.add('hidden');
      detectedUrl = url;
      currentStep = 2;
      stopPolling();
      render();
    });

    manualInput.addEventListener('input', () => {
      manualError.classList.add('hidden');
    });

    manualSection.appendChild(manualLabel);
    manualSection.appendChild(manualInput);
    manualSection.appendChild(manualError);
    manualSection.appendChild(manualBtn);
    content.appendChild(manualSection);

    wrapper.appendChild(content);

    // Keep polling for Workday tabs — update the URL as the user navigates
    async function pollForWorkday() {
      try {
        const response = await browser.runtime.sendMessage({ type: 'DETECT_WORKDAY_TABS' });
        if (response?.success && response.tabs && response.tabs.length > 0) {
          const absenceTab = response.tabs.find(
            (t: { url?: string }) => t.url && /myworkday\.com/.test(t.url),
          );
          if (absenceTab && absenceTab.url) {
            detectedUrl = absenceTab.url;
            statusIcon.className = 'wizard-detect-icon found';
            statusIcon.textContent = '\u2713';
            statusText.textContent = 'Workday tab found — navigate to your absence page if needed.';
            detectedUrlEl.textContent = absenceTab.url;
            detectedArea.classList.remove('hidden');
            // Don't stop polling — keep updating as the user navigates
          }
        } else {
          // No Workday tabs open (anymore) — reset to searching state
          statusIcon.className = 'wizard-detect-icon searching';
          statusIcon.textContent = '...';
          statusText.textContent = 'Looking for open Workday tabs...';
          detectedArea.classList.add('hidden');
          detectedUrl = '';
        }
      } catch {
        // Background not ready
      }
    }

    pollTimer = setInterval(pollForWorkday, 2000);
    pollForWorkday();
  }

  // --- Step 3: Connect Google Calendar ---

  function renderConnectCalendar(wrapper: HTMLElement) {
    const content = document.createElement('div');
    content.className = 'wizard-content';

    const title = document.createElement('h2');
    title.className = 'wizard-title';
    title.textContent = 'Connect Google Calendar';

    const desc = document.createElement('p');
    desc.className = 'wizard-text';
    desc.textContent =
      'Grant access to your Google Calendar so PTO Sync can create events for you.';

    const subtext = document.createElement('p');
    subtext.className = 'wizard-text wizard-subtext';
    subtext.textContent =
      'Events are created with "Out of Office" visibility by default. You can change this later in settings.';

    content.appendChild(title);
    content.appendChild(desc);
    content.appendChild(subtext);

    // Auth status area
    const authStatus = document.createElement('div');
    authStatus.className = 'wizard-auth-status';

    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn-primary wizard-btn';
    connectBtn.textContent = 'Connect Google Calendar';

    const authResult = document.createElement('div');
    authResult.className = 'wizard-auth-result hidden';

    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connecting...';
      try {
        const response = await browser.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' });
        if (response?.success) {
          calendarConnected = true;
          authResult.className = 'wizard-auth-result success';
          authResult.textContent = '\u2713 Connected to Google Calendar';
          authResult.classList.remove('hidden');
          connectBtn.classList.add('hidden');

          // Auto-advance to step 4 after a short pause
          setTimeout(() => {
            currentStep = 3;
            render();
          }, 800);
        } else {
          authResult.className = 'wizard-auth-result error';
          authResult.textContent = 'Could not connect. Please try again.';
          authResult.classList.remove('hidden');
          connectBtn.disabled = false;
          connectBtn.textContent = 'Connect Google Calendar';
        }
      } catch {
        authResult.className = 'wizard-auth-result error';
        authResult.textContent = 'Could not connect. Please try again.';
        authResult.classList.remove('hidden');
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect Google Calendar';
      }
    });

    authStatus.appendChild(connectBtn);
    authStatus.appendChild(authResult);
    content.appendChild(authStatus);

    wrapper.appendChild(content);
  }

  // --- Step 4: All Set ---

  function renderAllSet(wrapper: HTMLElement) {
    const content = document.createElement('div');
    content.className = 'wizard-content';

    const title = document.createElement('h2');
    title.className = 'wizard-title';
    title.textContent = "You're all set!";

    const desc = document.createElement('p');
    desc.className = 'wizard-text';
    desc.textContent =
      'PTO Sync is ready to go. Click below to sync your PTO entries to Google Calendar.';

    const checks = document.createElement('div');
    checks.className = 'wizard-checklist';

    const workdayCheck = document.createElement('div');
    workdayCheck.className = 'wizard-check-item';
    workdayCheck.textContent = '\u2713 Workday page configured';

    const calendarCheck = document.createElement('div');
    calendarCheck.className = 'wizard-check-item';
    calendarCheck.textContent = calendarConnected
      ? '\u2713 Google Calendar connected'
      : '\u2713 Google Calendar ready';

    checks.appendChild(workdayCheck);
    checks.appendChild(calendarCheck);

    content.appendChild(title);
    content.appendChild(desc);
    content.appendChild(checks);

    const startBtn = document.createElement('button');
    startBtn.className = 'btn-primary wizard-btn';
    startBtn.textContent = 'Start Syncing';
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = 'Saving...';

      try {
        const settingsResponse = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
        const currentSettings: SyncSettings = settingsResponse?.settings ?? {
          ...DEFAULT_SETTINGS,
        };

        const updatedSettings: SyncSettings = {
          ...currentSettings,
          workdayAbsenceUrl: detectedUrl || currentSettings.workdayAbsenceUrl,
          setupComplete: true,
        };

        await browser.runtime.sendMessage({
          type: 'SAVE_SETTINGS',
          settings: updatedSettings,
        });

        container.classList.add('hidden');
        onComplete(updatedSettings.workdayAbsenceUrl);
      } catch {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Syncing';
      }
    });

    content.appendChild(startBtn);
    wrapper.appendChild(content);
  }

  return {
    async checkIfNeeded(): Promise<boolean> {
      try {
        const response = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (response?.success && response.settings) {
          if (response.settings.setupComplete) {
            return false;
          }
        }
        // Setup is needed
        render();
        return true;
      } catch {
        // Background not ready — don't block
        return false;
      }
    },
  };
}
