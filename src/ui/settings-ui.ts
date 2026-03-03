import type { SyncSettings } from '../domain/model/settings';
import { DEFAULT_SETTINGS, renderTitle } from '../domain/model/settings';
import type { CalendarListEntry } from '../adapters/google-calendar/api-client';

export interface SettingsUIElements {
  settingsToggle: HTMLButtonElement;
  settingsPanel: HTMLElement;
  visibilitySelect: HTMLSelectElement;
  titleTemplateInput: HTMLInputElement;
  titlePreview: HTMLElement;
  calendarSelect: HTMLSelectElement;
  workdayUrlInput: HTMLInputElement;
  saveBtn: HTMLButtonElement;
  settingsStatus: HTMLElement;
}

export function initSettingsUI(elements: SettingsUIElements) {
  const {
    settingsToggle,
    settingsPanel,
    visibilitySelect,
    titleTemplateInput,
    titlePreview,
    calendarSelect,
    workdayUrlInput,
    saveBtn,
    settingsStatus,
  } = elements;

  let isOpen = false;
  let calendarsLoaded = false;

  // --- Toggle settings panel ---
  settingsToggle.addEventListener('click', () => {
    isOpen = !isOpen;
    settingsPanel.classList.toggle('hidden', !isOpen);
    settingsToggle.setAttribute('aria-expanded', String(isOpen));

    if (isOpen) {
      loadSettings();
      if (!calendarsLoaded) {
        loadCalendars();
      }
    }
  });

  // --- Title preview ---
  function updateTitlePreview() {
    const template = titleTemplateInput.value || DEFAULT_SETTINGS.titleTemplate;
    const preview = renderTitle(template, {
      type: 'Paid Time Off (PTO)',
      hours: 8,
      status: 'Approved',
    });
    titlePreview.textContent = preview;
  }

  titleTemplateInput.addEventListener('input', updateTitlePreview);

  // --- Load settings from background ---
  async function loadSettings() {
    try {
      const response: { success: boolean; settings?: SyncSettings; error?: string } =
        await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });

      if (response.success && response.settings) {
        const settings = response.settings;
        visibilitySelect.value = settings.eventVisibility;
        titleTemplateInput.value = settings.titleTemplate;
        workdayUrlInput.value = settings.workdayAbsenceUrl;

        // Set calendar select if calendars are loaded
        if (calendarsLoaded) {
          calendarSelect.value = settings.calendarId;
        }

        updateTitlePreview();
      }
    } catch {
      // Background may not be ready
    }
  }

  // --- Load calendars ---
  async function loadCalendars() {
    calendarSelect.innerHTML = '<option value="primary">Loading...</option>';

    try {
      const response: { success: boolean; calendars?: CalendarListEntry[]; error?: string } =
        await browser.runtime.sendMessage({ type: 'LIST_CALENDARS' });

      if (response.success && response.calendars) {
        calendarSelect.innerHTML = '';

        // Add "Primary" as default option
        const primaryOpt = document.createElement('option');
        primaryOpt.value = 'primary';
        primaryOpt.textContent = 'Primary';
        calendarSelect.appendChild(primaryOpt);

        for (const cal of response.calendars) {
          if (cal.primary) {
            // Update the "Primary" option text to show the actual name
            primaryOpt.textContent = `${cal.summary} (Primary)`;
            continue;
          }
          const opt = document.createElement('option');
          opt.value = cal.id;
          opt.textContent = cal.summary;
          calendarSelect.appendChild(opt);
        }

        calendarsLoaded = true;

        // Re-apply the stored calendar selection
        const settingsResponse: { success: boolean; settings?: SyncSettings } =
          await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (settingsResponse.success && settingsResponse.settings) {
          calendarSelect.value = settingsResponse.settings.calendarId;
        }
      } else {
        calendarSelect.innerHTML = '<option value="primary">Primary (default)</option>';
        calendarsLoaded = true;
      }
    } catch {
      calendarSelect.innerHTML = '<option value="primary">Primary (default)</option>';
      calendarsLoaded = true;
    }
  }

  // --- Save settings ---
  saveBtn.addEventListener('click', async () => {
    const settings: SyncSettings = {
      eventVisibility: visibilitySelect.value as SyncSettings['eventVisibility'],
      titleTemplate: titleTemplateInput.value || DEFAULT_SETTINGS.titleTemplate,
      calendarId: calendarSelect.value || 'primary',
      workdayAbsenceUrl: workdayUrlInput.value || DEFAULT_SETTINGS.workdayAbsenceUrl,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const response: { success: boolean; error?: string } = await browser.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        settings,
      });

      if (response.success) {
        settingsStatus.textContent = 'Settings saved!';
        settingsStatus.className = 'settings-status success';
      } else {
        settingsStatus.textContent = `Error: ${response.error}`;
        settingsStatus.className = 'settings-status error';
      }
    } catch {
      settingsStatus.textContent = 'Failed to save settings.';
      settingsStatus.className = 'settings-status error';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Settings';

      setTimeout(() => {
        settingsStatus.textContent = '';
        settingsStatus.className = 'settings-status';
      }, 3000);
    }
  });
}
