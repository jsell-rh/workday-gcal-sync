import type { SyncStateStore, SyncedEntry } from '../../domain/ports/sync-state-store';
import type { SyncResult } from '../../domain/model/sync-result';
import { type SyncSettings, DEFAULT_SETTINGS } from '../../domain/model/settings';

const STORAGE_KEYS = {
  SYNCED_DATES: 'pto-sync:synced-dates',
  LAST_SYNC_RESULT: 'pto-sync:last-sync-result',
  SETTINGS: 'pto-sync:settings',
} as const;

/**
 * Internal storage shape for synced dates.
 * Maps ISO date string to calendar event ID.
 */
interface SyncedDatesRecord {
  [date: string]: string;
}

/**
 * Adapter: Chrome extension storage for sync state.
 *
 * Uses browser.storage.local (WXT polyfills this as `browser`)
 * to persist which dates have been synced and the last sync result.
 */
export function createChromeStorageAdapter(): SyncStateStore {
  return {
    async getSyncedDates(): Promise<Set<string>> {
      const result = await browser.storage.local.get(STORAGE_KEYS.SYNCED_DATES);
      const record: SyncedDatesRecord = result[STORAGE_KEYS.SYNCED_DATES] ?? {};
      return new Set(Object.keys(record));
    },

    async getEventId(date: string): Promise<string | null> {
      const result = await browser.storage.local.get(STORAGE_KEYS.SYNCED_DATES);
      const record: SyncedDatesRecord = result[STORAGE_KEYS.SYNCED_DATES] ?? {};
      return record[date] ?? null;
    },

    async markSynced(date: string, calendarEventId: string): Promise<void> {
      const result = await browser.storage.local.get(STORAGE_KEYS.SYNCED_DATES);
      const record: SyncedDatesRecord = result[STORAGE_KEYS.SYNCED_DATES] ?? {};
      record[date] = calendarEventId;
      await browser.storage.local.set({ [STORAGE_KEYS.SYNCED_DATES]: record });
    },

    async removeSynced(date: string): Promise<void> {
      const result = await browser.storage.local.get(STORAGE_KEYS.SYNCED_DATES);
      const record: SyncedDatesRecord = result[STORAGE_KEYS.SYNCED_DATES] ?? {};
      delete record[date];
      await browser.storage.local.set({ [STORAGE_KEYS.SYNCED_DATES]: record });
    },

    async getAllSyncedEntries(): Promise<SyncedEntry[]> {
      const result = await browser.storage.local.get(STORAGE_KEYS.SYNCED_DATES);
      const record: SyncedDatesRecord = result[STORAGE_KEYS.SYNCED_DATES] ?? {};
      return Object.entries(record)
        .map(([date, eventId]) => ({ date, eventId }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },

    async getLastSyncResult(): Promise<SyncResult | null> {
      const result = await browser.storage.local.get(STORAGE_KEYS.LAST_SYNC_RESULT);
      return result[STORAGE_KEYS.LAST_SYNC_RESULT] ?? null;
    },

    async saveLastSyncResult(syncResult: SyncResult): Promise<void> {
      await browser.storage.local.set({
        [STORAGE_KEYS.LAST_SYNC_RESULT]: syncResult,
      });
    },
  };
}

export interface SettingsStore {
  getSettings(): Promise<SyncSettings>;
  saveSettings(settings: SyncSettings): Promise<void>;
}

export function createSettingsStore(): SettingsStore {
  return {
    async getSettings(): Promise<SyncSettings> {
      const result = await browser.storage.local.get(STORAGE_KEYS.SETTINGS);
      const stored = result[STORAGE_KEYS.SETTINGS];
      if (!stored) return { ...DEFAULT_SETTINGS };

      // Migrate legacy calendarId -> calendarIds
      const merged = { ...DEFAULT_SETTINGS, ...stored };
      if (!stored.calendarIds && 'calendarId' in stored && typeof stored.calendarId === 'string') {
        merged.calendarIds = [stored.calendarId];
      }
      return merged;
    },

    async saveSettings(settings: SyncSettings): Promise<void> {
      await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
    },
  };
}

export { STORAGE_KEYS };
