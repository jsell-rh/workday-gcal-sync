import { describe, it, expect, vi } from 'vitest';
import { buildPreview } from '../../../src/domain/services/sync-service';
import { summarizePreview } from '../../../src/domain/model/sync-preview';
import type { TimeOffEntry } from '../../../src/domain/model/time-off-entry';
import type { CalendarTarget } from '../../../src/domain/ports/calendar-target';
import type { SyncStateStore } from '../../../src/domain/ports/sync-state-store';

function makeEntry(overrides: Partial<TimeOffEntry> = {}): TimeOffEntry {
  return {
    date: '2025-03-15',
    dayOfWeek: 'Saturday',
    type: 'Paid Time Off (PTO)',
    requestedHours: 8,
    unitOfTime: 'Hours',
    status: 'Approved',
    ...overrides,
  };
}

function createMockCalendarTarget(overrides: Partial<CalendarTarget> = {}): CalendarTarget {
  return {
    createEvent: vi.fn(async () => 'event-id-123'),
    eventExists: vi.fn(async () => false),
    deleteEvent: vi.fn(async () => {}),
    ...overrides,
  };
}

function createMockSyncStateStore(
  syncedDates: Set<string> = new Set(),
  eventIds: Record<string, string> = {},
): SyncStateStore {
  return {
    getSyncedDates: vi.fn(async () => syncedDates),
    getEventId: vi.fn(async (date: string) => eventIds[date] ?? null),
    markSynced: vi.fn(async () => {}),
    removeSynced: vi.fn(async () => {}),
    getAllSyncedEntries: vi.fn(async () =>
      Object.entries(eventIds).map(([date, eventId]) => ({ date, eventId })),
    ),
    getLastSyncResult: vi.fn(async () => null),
    saveLastSyncResult: vi.fn(async () => {}),
  };
}

describe('buildPreview', () => {
  it('marks new entries as "create"', async () => {
    const entries = [makeEntry({ date: '2025-03-15' }), makeEntry({ date: '2025-03-16' })];
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    expect(preview.entries).toHaveLength(2);
    expect(preview.entries[0].action).toBe('create');
    expect(preview.entries[0].actionReason).toBe('New entry');
    expect(preview.entries[1].action).toBe('create');
  });

  it('marks already-synced entries as "skip"', async () => {
    const entries = [makeEntry({ date: '2025-03-15' })];
    const calendarTarget = createMockCalendarTarget({
      eventExists: vi.fn(async () => true),
    });
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
      '2025-03-15': 'event-id-123',
    });

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].action).toBe('skip');
    expect(preview.entries[0].actionReason).toBe('Already on calendar');
  });

  it('marks deleted calendar events as "resync"', async () => {
    const entries = [makeEntry({ date: '2025-03-15' })];
    const calendarTarget = createMockCalendarTarget({
      eventExists: vi.fn(async () => false),
    });
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
      '2025-03-15': 'old-event-id',
    });

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].action).toBe('resync');
    expect(preview.entries[0].actionReason).toContain('Deleted from calendar');
  });

  it('marks cancellations with synced events as "delete"', async () => {
    const entries = [makeEntry({ date: '2025-03-15', requestedHours: -8 })];
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
      '2025-03-15': 'event-to-delete',
    });

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].action).toBe('delete');
    expect(preview.entries[0].actionReason).toContain('Cancelled');
  });

  it('marks cancellations without synced events as "skip"', async () => {
    const entries = [makeEntry({ date: '2025-03-15', requestedHours: -8 })];
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].action).toBe('skip');
    expect(preview.entries[0].actionReason).toContain('Cancelled');
  });

  it('does not modify any state', async () => {
    const entries = [
      makeEntry({ date: '2025-03-15' }),
      makeEntry({ date: '2025-03-16', requestedHours: -8 }),
    ];
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-16']), {
      '2025-03-16': 'event-123',
    });

    await buildPreview(entries, { calendarTarget, syncStateStore });

    // No writes should have been made
    expect(syncStateStore.markSynced).not.toHaveBeenCalled();
    expect(syncStateStore.removeSynced).not.toHaveBeenCalled();
    expect(syncStateStore.saveLastSyncResult).not.toHaveBeenCalled();
    expect(calendarTarget.createEvent).not.toHaveBeenCalled();
    expect(calendarTarget.deleteEvent).not.toHaveBeenCalled();
  });

  it('handles entries that exist on calendar but not in local state', async () => {
    const entries = [makeEntry({ date: '2025-03-15' })];
    const calendarTarget = createMockCalendarTarget({
      eventExists: vi.fn(async () => true),
    });
    const syncStateStore = createMockSyncStateStore();

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].action).toBe('skip');
    expect(preview.entries[0].actionReason).toBe('Already on calendar');
  });

  it('filters out non-syncable entries (Denied status)', async () => {
    const entries = [
      makeEntry({ date: '2025-03-15', status: 'Approved' }),
      makeEntry({ date: '2025-03-16', status: 'Denied' }),
      makeEntry({ date: '2025-03-17', status: 'Submitted' }),
    ];
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    // Only Approved and Submitted should appear
    expect(preview.entries).toHaveLength(2);
    expect(preview.entries.map((e) => e.date)).toEqual(['2025-03-15', '2025-03-17']);
  });

  it('sorts entries by date', async () => {
    const entries = [
      makeEntry({ date: '2025-03-20' }),
      makeEntry({ date: '2025-03-10' }),
      makeEntry({ date: '2025-03-15' }),
    ];
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    expect(preview.entries.map((e) => e.date)).toEqual(['2025-03-10', '2025-03-15', '2025-03-20']);
  });

  it('preserves entry details in preview', async () => {
    const entries = [
      makeEntry({
        date: '2025-03-15',
        dayOfWeek: 'Saturday',
        type: 'Floating Holiday',
        requestedHours: 4,
        status: 'Submitted',
      }),
    ];
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const preview = await buildPreview(entries, { calendarTarget, syncStateStore });

    expect(preview.entries[0]).toMatchObject({
      date: '2025-03-15',
      dayOfWeek: 'Saturday',
      type: 'Floating Holiday',
      hours: 4,
      status: 'Submitted',
    });
  });
});

describe('summarizePreview', () => {
  it('counts actions correctly', () => {
    const preview = {
      entries: [
        {
          date: '2025-03-10',
          dayOfWeek: 'Mon',
          type: 'PTO',
          hours: 8,
          status: 'Approved',
          action: 'create' as const,
          actionReason: 'New',
        },
        {
          date: '2025-03-11',
          dayOfWeek: 'Tue',
          type: 'PTO',
          hours: 8,
          status: 'Approved',
          action: 'create' as const,
          actionReason: 'New',
        },
        {
          date: '2025-03-12',
          dayOfWeek: 'Wed',
          type: 'PTO',
          hours: 8,
          status: 'Approved',
          action: 'skip' as const,
          actionReason: 'Already synced',
        },
        {
          date: '2025-03-13',
          dayOfWeek: 'Thu',
          type: 'PTO',
          hours: -8,
          status: 'Approved',
          action: 'delete' as const,
          actionReason: 'Cancelled',
        },
        {
          date: '2025-03-14',
          dayOfWeek: 'Fri',
          type: 'PTO',
          hours: 8,
          status: 'Approved',
          action: 'resync' as const,
          actionReason: 'Re-create',
        },
      ],
    };

    const summary = summarizePreview(preview);
    expect(summary.creates).toBe(2);
    expect(summary.skips).toBe(1);
    expect(summary.deletes).toBe(1);
    expect(summary.resyncs).toBe(1);
  });

  it('handles empty preview', () => {
    const summary = summarizePreview({ entries: [] });
    expect(summary.creates).toBe(0);
    expect(summary.skips).toBe(0);
    expect(summary.deletes).toBe(0);
    expect(summary.resyncs).toBe(0);
  });
});
