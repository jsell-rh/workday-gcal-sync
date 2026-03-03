import type { SyncSettings } from '../domain/model/settings';
import { DEFAULT_SETTINGS, renderTitle } from '../domain/model/settings';
import type { CalendarListEntry } from '../adapters/google-calendar/api-client';

export interface SettingsUIElements {
  settingsToggle: HTMLButtonElement;
  settingsPanel: HTMLElement;
  visibilitySelect: HTMLSelectElement;
  titleTemplateInput: HTMLInputElement;
  titlePreview: HTMLElement;
  calendarCheckboxes: HTMLElement;
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
    calendarCheckboxes,
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
    settingsToggle.setAttribute('aria-label', isOpen ? 'Close settings' : 'Open settings');

    if (isOpen) {
      loadSettings();
      if (!calendarsLoaded) {
        loadCalendars();
      }
    }
  });

  // --- Validation ---
  function validateTitleTemplate(): boolean {
    const value = titleTemplateInput.value.trim();
    const isValid = value.length > 0;
    titleTemplateInput.classList.toggle('invalid', !isValid);
    return isValid;
  }

  function validateWorkdayUrl(): boolean {
    const value = workdayUrlInput.value.trim();
    if (value.length === 0) {
      // Empty is okay — we fall back to default
      workdayUrlInput.classList.remove('invalid');
      return true;
    }
    const isValid = /^https:\/\/.*\.myworkday\.com\//.test(value);
    workdayUrlInput.classList.toggle('invalid', !isValid);
    return isValid;
  }

  titleTemplateInput.addEventListener('blur', validateTitleTemplate);
  workdayUrlInput.addEventListener('blur', validateWorkdayUrl);

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

  titleTemplateInput.addEventListener('input', () => {
    updateTitlePreview();
    // Clear validation error while typing
    if (titleTemplateInput.value.trim().length > 0) {
      titleTemplateInput.classList.remove('invalid');
    }
  });

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

        // Check the stored calendar selections if calendars are loaded
        if (calendarsLoaded) {
          applyCalendarSelections(settings.calendarIds);
        }

        updateTitlePreview();
      }
    } catch {
      // Background may not be ready
    }
  }

  function applyCalendarSelections(calendarIds: string[]) {
    const checkboxes =
      calendarCheckboxes.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    for (const cb of checkboxes) {
      cb.checked = calendarIds.includes(cb.value);
    }
  }

  function getSelectedCalendarIds(): string[] {
    const checkboxes = calendarCheckboxes.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]:checked',
    );
    const ids = Array.from(checkboxes).map((cb) => cb.value);
    return ids.length > 0 ? ids : ['primary'];
  }

  // --- Load calendars ---
  async function loadCalendars() {
    calendarCheckboxes.innerHTML = '';
    const loading = document.createElement('span');
    loading.className = 'calendar-loading';
    loading.textContent = 'Loading calendars...';
    calendarCheckboxes.appendChild(loading);

    try {
      const response: { success: boolean; calendars?: CalendarListEntry[]; error?: string } =
        await browser.runtime.sendMessage({ type: 'LIST_CALENDARS' });

      if (response.success && response.calendars) {
        calendarCheckboxes.innerHTML = '';

        // Add "Primary" checkbox first
        let primaryLabel = 'Primary';
        const primaryCal = response.calendars.find((c) => c.primary);
        if (primaryCal) {
          primaryLabel = `${primaryCal.summary} (Primary)`;
        }
        appendCalendarCheckbox('primary', primaryLabel, true);

        for (const cal of response.calendars) {
          if (cal.primary) continue;
          appendCalendarCheckbox(cal.id, cal.summary, false);
        }

        calendarsLoaded = true;

        // Re-apply the stored calendar selections
        const settingsResponse: { success: boolean; settings?: SyncSettings } =
          await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (settingsResponse.success && settingsResponse.settings) {
          applyCalendarSelections(settingsResponse.settings.calendarIds);
        }
      } else {
        showCalendarFallback(response.error);
      }
    } catch {
      showCalendarFallback();
    }
  }

  function showCalendarFallback(error?: string) {
    calendarCheckboxes.innerHTML = '';

    if (error && /auth|oauth|token|sign.in/i.test(error)) {
      const msg = document.createElement('div');
      msg.className = 'calendar-empty';
      msg.textContent = 'Could not load calendars. Google sign-in will be requested when you sync.';
      calendarCheckboxes.appendChild(msg);
    }

    appendCalendarCheckbox('primary', 'Primary calendar (default)', true);
    calendarsLoaded = true;
  }

  function appendCalendarCheckbox(value: string, label: string, checked: boolean) {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '6px';
    wrapper.style.marginBottom = '4px';
    wrapper.style.fontSize = '13px';
    wrapper.style.cursor = 'pointer';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = value;
    cb.checked = checked;

    const text = document.createElement('span');
    text.textContent = label;

    wrapper.appendChild(cb);
    wrapper.appendChild(text);
    calendarCheckboxes.appendChild(wrapper);
  }

  // --- Save settings ---
  saveBtn.addEventListener('click', async () => {
    // Validate before saving
    const titleValid = validateTitleTemplate();
    const urlValid = validateWorkdayUrl();
    if (!titleValid || !urlValid) {
      settingsStatus.textContent = 'Please fix the errors above.';
      settingsStatus.className = 'settings-status error';
      return;
    }

    const settings: SyncSettings = {
      eventVisibility: visibilitySelect.value as SyncSettings['eventVisibility'],
      titleTemplate: titleTemplateInput.value || DEFAULT_SETTINGS.titleTemplate,
      calendarIds: getSelectedCalendarIds(),
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
