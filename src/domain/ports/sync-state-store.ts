import type { SyncResult } from '../model/sync-result';

/**
 * Port: Persistent storage for sync state.
 * Implemented by adapters like ChromeStorageAdapter.
 */
export interface SyncStateStore {
  /**
   * Returns the set of dates (ISO 8601) that have already been synced.
   */
  getSyncedDates(): Promise<Set<string>>;

  /**
   * Returns the calendar event ID for a synced date, or null if not found.
   */
  getEventId(date: string): Promise<string | null>;

  /**
   * Marks a date as synced, with its calendar event ID.
   */
  markSynced(date: string, calendarEventId: string): Promise<void>;

  /**
   * Removes a date from the synced set.
   */
  removeSynced(date: string): Promise<void>;

  /**
   * Returns the last sync result.
   */
  getLastSyncResult(): Promise<SyncResult | null>;

  /**
   * Stores the result of the latest sync.
   */
  saveLastSyncResult(result: SyncResult): Promise<void>;
}
