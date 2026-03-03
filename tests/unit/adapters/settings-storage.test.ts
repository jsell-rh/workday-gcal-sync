// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createSettingsStore, STORAGE_KEYS } from '../../../src/adapters/storage/chrome-storage';
import { DEFAULT_SETTINGS } from '../../../src/domain/model/settings';
import type { SyncSettings } from '../../../src/domain/model/settings';

describe('SettingsStore', () => {
  beforeEach(async () => {
    await browser.storage.local.clear();
  });

  describe('getSettings', () => {
    it('returns default settings when none are stored', async () => {
      const store = createSettingsStore();
      const settings = await store.getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('returns stored settings', async () => {
      const custom: SyncSettings = {
        eventVisibility: 'free',
        titleTemplate: '{type}',
        calendarId: 'my-cal@group.calendar.google.com',
        workdayAbsenceUrl: 'https://wd5.myworkday.com/other/d/task/2997$276.htmld',
      };

      await browser.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: custom,
      });

      const store = createSettingsStore();
      const settings = await store.getSettings();
      expect(settings).toEqual(custom);
    });

    it('merges partial stored settings with defaults', async () => {
      await browser.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: { eventVisibility: 'outOfOffice' },
      });

      const store = createSettingsStore();
      const settings = await store.getSettings();
      expect(settings.eventVisibility).toBe('outOfOffice');
      expect(settings.titleTemplate).toBe(DEFAULT_SETTINGS.titleTemplate);
      expect(settings.calendarId).toBe(DEFAULT_SETTINGS.calendarId);
      expect(settings.workdayAbsenceUrl).toBe(DEFAULT_SETTINGS.workdayAbsenceUrl);
    });
  });

  describe('saveSettings', () => {
    it('persists settings to storage', async () => {
      const store = createSettingsStore();
      const custom: SyncSettings = {
        eventVisibility: 'outOfOffice',
        titleTemplate: 'OOO ({hours}h)',
        calendarId: 'work-cal',
        workdayAbsenceUrl: 'https://wd5.myworkday.com/other/d/task/2997$276.htmld',
      };

      await store.saveSettings(custom);

      const result = await browser.storage.local.get(STORAGE_KEYS.SETTINGS);
      expect(result[STORAGE_KEYS.SETTINGS]).toEqual(custom);
    });

    it('overwrites previous settings', async () => {
      const store = createSettingsStore();

      await store.saveSettings({
        ...DEFAULT_SETTINGS,
        eventVisibility: 'free',
      });

      await store.saveSettings({
        ...DEFAULT_SETTINGS,
        eventVisibility: 'outOfOffice',
      });

      const settings = await store.getSettings();
      expect(settings.eventVisibility).toBe('outOfOffice');
    });
  });
});
