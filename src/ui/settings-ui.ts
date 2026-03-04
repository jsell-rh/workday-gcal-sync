import type { SyncSettings } from '../domain/model/settings';
import { DEFAULT_SETTINGS, renderTitle } from '../domain/model/settings';
import type { CalendarListEntry } from '../adapters/google-calendar/api-client';

export interface SettingsUIElements {
  settingsToggle: HTMLButtonElement;
  settingsOverlay: HTMLElement;
  settingsBack: HTMLButtonElement;
  visibilitySelect: HTMLSelectElement;
  titleTemplateInput: HTMLInputElement;
  titlePreview: HTMLElement;
  calendarCheckboxes: HTMLElement;
  workdayUrlInput: HTMLInputElement;
  autoSyncCheckbox: HTMLInputElement;
  autoSyncIntervalSelect: HTMLSelectElement;
  autoSyncIntervalGroup: HTMLElement;
  saveBtn: HTMLButtonElement;
  settingsStatus: HTMLElement;
  oooCalendarHint: HTMLElement;
}

export function initSettingsUI(elements: SettingsUIElements) {
  const {
    settingsToggle,
    settingsOverlay,
    settingsBack,
    visibilitySelect,
    titleTemplateInput,
    titlePreview,
    calendarCheckboxes,
    workdayUrlInput,
    autoSyncCheckbox,
    autoSyncIntervalSelect,
    autoSyncIntervalGroup,
    saveBtn,
    settingsStatus,
    oooCalendarHint,
  } = elements;

  let isOpen = false;
  let calendarsLoaded = false;

  function openSettings() {
    isOpen = true;
    settingsOverlay.classList.remove('hidden');
    settingsToggle.setAttribute('aria-expanded', 'true');
    settingsToggle.setAttribute('aria-label', 'Close settings');
    loadSettings();
    if (!calendarsLoaded) {
      loadCalendars();
    }
  }

  function closeSettings() {
    isOpen = false;
    settingsOverlay.classList.add('hidden');
    settingsToggle.setAttribute('aria-expanded', 'false');
    settingsToggle.setAttribute('aria-label', 'Open settings');
  }

  // --- Toggle settings overlay ---
  settingsToggle.addEventListener('click', () => {
    if (isOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  });

  // --- Back button ---
  settingsBack.addEventListener('click', () => {
    closeSettings();
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
      workdayUrlInput.classList.remove('invalid');
      return true;
    }
    const isValid = /^https:\/\/.*\.myworkday\.com\//.test(value);
    workdayUrlInput.classList.toggle('invalid', !isValid);
    return isValid;
  }

  titleTemplateInput.addEventListener('blur', validateTitleTemplate);
  workdayUrlInput.addEventListener('blur', validateWorkdayUrl);

  // --- Out of Office calendar hint ---
  function updateOooHint() {
    const isOoo = visibilitySelect.value === 'outOfOffice';
    const checkedCount = calendarCheckboxes.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]:checked',
    ).length;
    const shouldShow = isOoo && checkedCount > 1;
    oooCalendarHint.classList.toggle('hidden', !shouldShow);
  }

  visibilitySelect.addEventListener('change', () => {
    updateOooHint();
  });

  calendarCheckboxes.addEventListener('change', () => {
    updateOooHint();
  });

  // --- Auto-sync toggle ---
  autoSyncCheckbox.addEventListener('change', () => {
    autoSyncIntervalGroup.classList.toggle('hidden', !autoSyncCheckbox.checked);
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

  titleTemplateInput.addEventListener('input', () => {
    updateTitlePreview();
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
        autoSyncCheckbox.checked = settings.autoSyncEnabled;
        autoSyncIntervalSelect.value = String(settings.autoSyncIntervalMinutes);
        autoSyncIntervalGroup.classList.toggle('hidden', !settings.autoSyncEnabled);

        if (calendarsLoaded) {
          applyCalendarSelections(settings.calendarIds);
        }

        updateTitlePreview();
        updateOooHint();
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

        const settingsResponse: { success: boolean; settings?: SyncSettings } =
          await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (settingsResponse.success && settingsResponse.settings) {
          applyCalendarSelections(settingsResponse.settings.calendarIds);
        }
        updateOooHint();
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
    wrapper.className = 'calendar-checkbox-label';

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
      autoSyncEnabled: autoSyncCheckbox.checked,
      autoSyncIntervalMinutes:
        Number(autoSyncIntervalSelect.value) || DEFAULT_SETTINGS.autoSyncIntervalMinutes,
      setupComplete: true,
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
      saveBtn.textContent = 'Save';

      setTimeout(() => {
        settingsStatus.textContent = '';
        settingsStatus.className = 'settings-status';
      }, 3000);
    }
  });

  // --- Start over ---
  const startOverBtn = document.getElementById('start-over-btn') as HTMLButtonElement;
  if (startOverBtn) {
    startOverBtn.addEventListener('click', async () => {
      const confirmed = confirm(
        "Start over?\n\nThis will clear all synced events, settings, and activity history. You'll go through setup again.\n\nCalendar events that were already created will not be deleted.",
      );
      if (!confirmed) return;

      startOverBtn.disabled = true;
      startOverBtn.textContent = 'Resetting...';

      try {
        await browser.runtime.sendMessage({ type: 'RESET_ALL' });
        // Reload the page to trigger wizard
        window.location.reload();
      } catch {
        startOverBtn.disabled = false;
        startOverBtn.textContent = 'Start over';
      }
    });
  }
}
