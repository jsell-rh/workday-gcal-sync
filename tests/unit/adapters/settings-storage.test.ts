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
        calendarIds: ['my-cal@group.calendar.google.com'],
        workdayAbsenceUrl: 'https://wd5.myworkday.com/acme/d/task/1234$567.htmld',
        autoSyncEnabled: true,
        autoSyncIntervalMinutes: 30,
        setupComplete: true,
      };

      await browser.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: custom,
      });

      const store = createSettingsStore();
      const settings = await store.getSettings();
      expect(settings).toEqual(custom);
    });

    it('migrates legacy calendarId to calendarIds', async () => {
      await browser.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: {
          eventVisibility: 'free',
          titleTemplate: '{type}',
          calendarId: 'legacy-cal@group.calendar.google.com',
          workdayAbsenceUrl: 'https://wd5.myworkday.com/acme/d/task/1234$567.htmld',
        },
      });

      const store = createSettingsStore();
      const settings = await store.getSettings();
      expect(settings.calendarIds).toEqual(['legacy-cal@group.calendar.google.com']);
    });

    it('merges partial stored settings with defaults', async () => {
      await browser.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: { eventVisibility: 'outOfOffice' },
      });

      const store = createSettingsStore();
      const settings = await store.getSettings();
      expect(settings.eventVisibility).toBe('outOfOffice');
      expect(settings.titleTemplate).toBe(DEFAULT_SETTINGS.titleTemplate);
      expect(settings.calendarIds).toEqual(DEFAULT_SETTINGS.calendarIds);
      expect(settings.workdayAbsenceUrl).toBe(DEFAULT_SETTINGS.workdayAbsenceUrl);
      expect(settings.autoSyncEnabled).toBe(false);
      expect(settings.autoSyncIntervalMinutes).toBe(60);
    });
  });

  describe('saveSettings', () => {
    it('persists settings to storage', async () => {
      const store = createSettingsStore();
      const custom: SyncSettings = {
        eventVisibility: 'outOfOffice',
        titleTemplate: 'OOO ({hours}h)',
        calendarIds: ['work-cal'],
        workdayAbsenceUrl: 'https://wd5.myworkday.com/acme/d/task/1234$567.htmld',
        autoSyncEnabled: true,
        autoSyncIntervalMinutes: 120,
        setupComplete: true,
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
