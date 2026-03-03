export interface SyncResult {
  readonly syncedAt: string; // ISO 8601 datetime
  readonly entriesFound: number;
  readonly entriesSynced: number;
  readonly entriesSkipped: number;
  readonly errors: SyncError[];
}

export interface SyncError {
  readonly entryDate: string;
  readonly message: string;
}

export function createSyncResult(partial: Omit<SyncResult, 'syncedAt'>): SyncResult {
  return {
    ...partial,
    syncedAt: new Date().toISOString(),
  };
}
