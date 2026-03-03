import { describe, it, expect } from 'vitest';
import { createSyncResult } from '../../../src/domain/model/sync-result';

describe('createSyncResult', () => {
  it('sets syncedAt timestamp', () => {
    const before = new Date().toISOString();
    const result = createSyncResult({
      entriesFound: 5,
      entriesSynced: 3,
      entriesSkipped: 2,
      errors: [],
    });
    const after = new Date().toISOString();

    expect(result.syncedAt).toBeDefined();
    expect(result.syncedAt >= before).toBe(true);
    expect(result.syncedAt <= after).toBe(true);
  });

  it('preserves all provided fields', () => {
    const errors = [{ entryDate: '2025-03-15', message: 'API error' }];
    const result = createSyncResult({
      entriesFound: 10,
      entriesSynced: 7,
      entriesSkipped: 2,
      errors,
    });

    expect(result.entriesFound).toBe(10);
    expect(result.entriesSynced).toBe(7);
    expect(result.entriesSkipped).toBe(2);
    expect(result.errors).toEqual(errors);
  });

  it('produces a valid ISO 8601 datetime for syncedAt', () => {
    const result = createSyncResult({
      entriesFound: 0,
      entriesSynced: 0,
      entriesSkipped: 0,
      errors: [],
    });

    // Parsing a valid ISO string should not produce NaN
    expect(isNaN(new Date(result.syncedAt).getTime())).toBe(false);
  });
});
