export interface SyncResult {
  readonly syncedAt: string; // ISO 8601 datetime
  readonly entriesFound: number;
  readonly entriesSynced: number;
  readonly entriesSkipped: number;
  readonly entriesResynced: number;
  readonly errors: SyncError[];
}

export interface SyncError {
  readonly entryDate: string;
  readonly message: string;
}

export function createSyncResult(
  partial: Omit<SyncResult, 'syncedAt' | 'entriesResynced'> & { entriesResynced?: number },
): SyncResult {
  return {
    ...partial,
    entriesResynced: partial.entriesResynced ?? 0,
    syncedAt: new Date().toISOString(),
  };
}
