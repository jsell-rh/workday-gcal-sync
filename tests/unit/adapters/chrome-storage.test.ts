// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createChromeStorageAdapter,
  STORAGE_KEYS,
} from '../../../src/adapters/storage/chrome-storage';

describe('ChromeStorageAdapter', () => {
  beforeEach(async () => {
    // Clear storage between tests using the global browser stub from WxtVitest
    await browser.storage.local.clear();
  });

  describe('getSyncedDates', () => {
    it('returns empty set when no dates are stored', async () => {
      const adapter = createChromeStorageAdapter();
      const dates = await adapter.getSyncedDates();
      expect(dates.size).toBe(0);
    });

    it('returns stored dates', async () => {
      await browser.storage.local.set({
        [STORAGE_KEYS.SYNCED_DATES]: {
          '2025-03-15': 'event-1',
          '2025-03-16': 'event-2',
        },
      });

      const adapter = createChromeStorageAdapter();
      const dates = await adapter.getSyncedDates();
      expect(dates.size).toBe(2);
      expect(dates.has('2025-03-15')).toBe(true);
      expect(dates.has('2025-03-16')).toBe(true);
    });
  });

  describe('getEventId', () => {
    it('returns null when date is not stored', async () => {
      const adapter = createChromeStorageAdapter();
      const id = await adapter.getEventId('2025-03-15');
      expect(id).toBeNull();
    });

    it('returns the event ID for a stored date', async () => {
      await browser.storage.local.set({
        [STORAGE_KEYS.SYNCED_DATES]: {
          '2025-03-15': 'event-abc',
          '2025-03-16': 'event-def',
        },
      });

      const adapter = createChromeStorageAdapter();
      expect(await adapter.getEventId('2025-03-15')).toBe('event-abc');
      expect(await adapter.getEventId('2025-03-16')).toBe('event-def');
      expect(await adapter.getEventId('2025-03-17')).toBeNull();
    });
  });

  describe('markSynced', () => {
    it('adds a date to the synced set', async () => {
      const adapter = createChromeStorageAdapter();
      await adapter.markSynced('2025-03-15', 'event-abc');

      const dates = await adapter.getSyncedDates();
      expect(dates.has('2025-03-15')).toBe(true);
    });

    it('preserves existing dates when adding new ones', async () => {
      const adapter = createChromeStorageAdapter();
      await adapter.markSynced('2025-03-15', 'event-1');
      await adapter.markSynced('2025-03-16', 'event-2');

      const dates = await adapter.getSyncedDates();
      expect(dates.size).toBe(2);
    });
  });

  describe('removeSynced', () => {
    it('removes a date from the synced set', async () => {
      const adapter = createChromeStorageAdapter();
      await adapter.markSynced('2025-03-15', 'event-1');
      await adapter.markSynced('2025-03-16', 'event-2');

      await adapter.removeSynced('2025-03-15');

      const dates = await adapter.getSyncedDates();
      expect(dates.size).toBe(1);
      expect(dates.has('2025-03-15')).toBe(false);
      expect(dates.has('2025-03-16')).toBe(true);
    });
  });

  describe('getLastSyncResult / saveLastSyncResult', () => {
    it('returns null when no result is stored', async () => {
      const adapter = createChromeStorageAdapter();
      const result = await adapter.getLastSyncResult();
      expect(result).toBeNull();
    });

    it('stores and retrieves sync result', async () => {
      const adapter = createChromeStorageAdapter();
      const syncResult = {
        syncedAt: '2025-03-15T10:00:00.000Z',
        entriesFound: 5,
        entriesSynced: 3,
        entriesSkipped: 2,
        errors: [],
      };

      await adapter.saveLastSyncResult(syncResult);
      const retrieved = await adapter.getLastSyncResult();

      expect(retrieved).toEqual(syncResult);
    });
  });
});
