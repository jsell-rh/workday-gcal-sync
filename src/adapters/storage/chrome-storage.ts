import type { SyncStateStore } from '../../domain/ports/sync-state-store';
import type { SyncResult } from '../../domain/model/sync-result';

/**
 * Adapter: Chrome extension storage for sync state.
 *
 * Uses chrome.storage.local (via WXT storage utils) to persist
 * which dates have been synced and the last sync result.
 */
export function createChromeStorageAdapter(): SyncStateStore {
  return {
    async getSyncedDates(): Promise<Set<string>> {
      // TODO: Read from chrome.storage.local
      throw new Error('Not implemented');
    },

    async markSynced(_date: string, _calendarEventId: string): Promise<void> {
      // TODO: Write to chrome.storage.local
      throw new Error('Not implemented');
    },

    async removeSynced(_date: string): Promise<void> {
      // TODO: Remove from chrome.storage.local
      throw new Error('Not implemented');
    },

    async getLastSyncResult(): Promise<SyncResult | null> {
      // TODO: Read from chrome.storage.local
      throw new Error('Not implemented');
    },

    async saveLastSyncResult(_result: SyncResult): Promise<void> {
      // TODO: Write to chrome.storage.local
      throw new Error('Not implemented');
    },
  };
}
