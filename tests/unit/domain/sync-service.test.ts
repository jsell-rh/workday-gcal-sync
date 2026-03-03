import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSyncService } from '../../../src/domain/services/sync-service';
import type { TimeOffEntry } from '../../../src/domain/model/time-off-entry';
import type { TimeOffSource } from '../../../src/domain/ports/time-off-source';
import type { CalendarTarget } from '../../../src/domain/ports/calendar-target';
import type { SyncStateStore } from '../../../src/domain/ports/sync-state-store';
import type { Logger } from '../../../src/domain/ports/logger';
import type { EventBus } from '../../../src/domain/events/event-bus';
import type { DomainEvent } from '../../../src/domain/events/domain-events';
import type { SyncResult } from '../../../src/domain/model/sync-result';

// --- Mock factories ---

function createMockTimeOffSource(entries: TimeOffEntry[]): TimeOffSource {
  return { getEntries: vi.fn(async () => entries) };
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
  overrides: Partial<SyncStateStore> = {},
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
    ...overrides,
  };
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockEventBus(): EventBus & { events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  return {
    events,
    publish: vi.fn((event: DomainEvent) => events.push(event)),
    subscribe: vi.fn(() => () => {}),
  };
}

// --- Test helpers ---

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

// --- Tests ---

describe('SyncService', () => {
  let logger: Logger;
  let eventBus: EventBus & { events: DomainEvent[] };

  beforeEach(() => {
    logger = createMockLogger();
    eventBus = createMockEventBus();
  });

  it('syncs new entries to calendar', async () => {
    const entries = [makeEntry({ date: '2025-03-15' }), makeEntry({ date: '2025-03-16' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    expect(calendarTarget.createEvent).toHaveBeenCalledTimes(2);
    expect(syncStateStore.markSynced).toHaveBeenCalledTimes(2);
    expect(syncStateStore.saveLastSyncResult).toHaveBeenCalledOnce();

    const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SyncResult;
    expect(savedResult.entriesSynced).toBe(2);
    expect(savedResult.entriesSkipped).toBe(0);
    expect(savedResult.errors).toHaveLength(0);
  });

  it('skips already-synced dates that still exist on calendar', async () => {
    const entries = [makeEntry({ date: '2025-03-15' }), makeEntry({ date: '2025-03-16' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget({
      // First call: reconciliation check for 2025-03-15 (exists), second call: new entry check for 2025-03-16 (doesn't exist)
      eventExists: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
      '2025-03-15': 'event-id-123',
    });

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    // Should verify with calendar for the synced entry
    expect(calendarTarget.eventExists).toHaveBeenCalled();
    // Only the second entry should be created (first verified on calendar)
    expect(calendarTarget.createEvent).toHaveBeenCalledTimes(1);

    const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SyncResult;
    expect(savedResult.entriesSynced).toBe(1);
    expect(savedResult.entriesSkipped).toBe(1);
  });

  it('skips entries that exist in calendar but not in sync state', async () => {
    const entries = [makeEntry({ date: '2025-03-15' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget({
      eventExists: vi.fn(async () => true),
    });
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    expect(calendarTarget.createEvent).not.toHaveBeenCalled();
    // Should still mark as synced with 'existing'
    expect(syncStateStore.markSynced).toHaveBeenCalledWith('2025-03-15', 'existing');

    const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SyncResult;
    expect(savedResult.entriesSynced).toBe(0);
    expect(savedResult.entriesSkipped).toBe(1);
  });

  it('handles cancellations by filtering them out', async () => {
    const entries = [
      makeEntry({ date: '2025-03-15', requestedHours: 8 }),
      makeEntry({ date: '2025-03-15', requestedHours: -8 }), // cancellation
    ];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    // Only the positive entry is syncable
    expect(calendarTarget.createEvent).toHaveBeenCalledTimes(1);

    const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SyncResult;
    expect(savedResult.entriesFound).toBe(2);
    expect(savedResult.entriesSynced).toBe(1);
  });

  it('publishes domain events in correct order', async () => {
    const entries = [makeEntry({ date: '2025-03-15' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    const eventTypes = eventBus.events.map((e) => e.type);
    expect(eventTypes).toEqual([
      'SyncStarted',
      'EntriesParsed',
      'EntryProcessing',
      'CalendarEventCreated',
      'SyncCompleted',
    ]);

    // Verify event payloads using discriminated union narrowing
    const syncStarted = eventBus.events[0];
    expect(syncStarted.type).toBe('SyncStarted');
    if (syncStarted.type === 'SyncStarted') {
      expect(syncStarted.source).toBe('workday');
    }

    const entriesParsed = eventBus.events[1];
    if (entriesParsed.type === 'EntriesParsed') {
      expect(entriesParsed.count).toBe(1);
      expect(entriesParsed.syncableCount).toBe(1);
    }

    const processing = eventBus.events[2];
    if (processing.type === 'EntryProcessing') {
      expect(processing.date).toBe('2025-03-15');
      expect(processing.index).toBe(1);
      expect(processing.total).toBe(1);
    }

    const created = eventBus.events[3];
    if (created.type === 'CalendarEventCreated') {
      expect(created.date).toBe('2025-03-15');
    }

    const completed = eventBus.events[4];
    if (completed.type === 'SyncCompleted') {
      expect(completed.entriesSynced).toBe(1);
      expect(completed.entriesSkipped).toBe(0);
    }
  });

  it('stores sync result after completion', async () => {
    const entries = [makeEntry()];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    expect(syncStateStore.saveLastSyncResult).toHaveBeenCalledOnce();
    const result = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SyncResult;
    expect(result.syncedAt).toBeDefined();
    expect(result.entriesFound).toBe(1);
    expect(result.entriesSynced).toBe(1);
    expect(result.entriesSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles calendar API errors gracefully', async () => {
    const entries = [makeEntry({ date: '2025-03-15' }), makeEntry({ date: '2025-03-16' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget({
      createEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error('Calendar API rate limit'))
        .mockResolvedValueOnce('event-id-456'),
    });
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    // Should not throw despite the API error on first entry
    await service.sync();

    const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SyncResult;
    expect(savedResult.entriesSynced).toBe(1);
    expect(savedResult.errors).toHaveLength(1);
    expect(savedResult.errors[0].entryDate).toBe('2025-03-15');
    expect(savedResult.errors[0].message).toBe('Calendar API rate limit');

    // Logger should have logged the error
    expect(logger.error).toHaveBeenCalled();
  });

  it('filters out non-syncable entries (denied, cancelled)', async () => {
    const entries = [
      makeEntry({ date: '2025-03-15', status: 'Approved' }),
      makeEntry({ date: '2025-03-16', status: 'Denied' }),
      makeEntry({ date: '2025-03-17', status: 'Cancelled' }),
      makeEntry({ date: '2025-03-18', status: 'Submitted' }),
    ];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    // Only Approved and Submitted entries should be synced
    expect(calendarTarget.createEvent).toHaveBeenCalledTimes(2);

    const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SyncResult;
    expect(savedResult.entriesFound).toBe(4);
    expect(savedResult.entriesSynced).toBe(2);
  });

  it('publishes SyncFailed event when source throws', async () => {
    const timeOffSource: TimeOffSource = {
      getEntries: vi.fn(async () => {
        throw new Error('Network error');
      }),
    };
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await expect(service.sync()).rejects.toThrow('Network error');

    const eventTypes = eventBus.events.map((e) => e.type);
    expect(eventTypes).toContain('SyncStarted');
    expect(eventTypes).toContain('SyncFailed');

    const failedEvent = eventBus.events.find((e) => e.type === 'SyncFailed');
    expect(failedEvent).toBeDefined();
    if (failedEvent?.type === 'SyncFailed') {
      expect(failedEvent.error).toBe('Network error');
    }
  });

  it('publishes EntrySkipped for already-synced dates verified on calendar', async () => {
    const entries = [makeEntry({ date: '2025-03-15' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget({
      eventExists: vi.fn(async () => true),
    });
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
      '2025-03-15': 'event-id-123',
    });

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    const eventTypes = eventBus.events.map((e) => e.type);
    expect(eventTypes).toContain('EntryProcessing');
    expect(eventTypes).toContain('EntrySkipped');

    const skippedEvent = eventBus.events.find((e) => e.type === 'EntrySkipped');
    expect(skippedEvent).toBeDefined();
    if (skippedEvent?.type === 'EntrySkipped') {
      expect(skippedEvent.date).toBe('2025-03-15');
      expect(skippedEvent.reason).toContain('verified');
    }
  });

  it('publishes EntryProcessing with correct index and total', async () => {
    const entries = [
      makeEntry({ date: '2025-03-15' }),
      makeEntry({ date: '2025-03-16' }),
      makeEntry({ date: '2025-03-17' }),
    ];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    const processingEvents = eventBus.events.filter((e) => e.type === 'EntryProcessing');
    expect(processingEvents).toHaveLength(3);

    if (processingEvents[0].type === 'EntryProcessing') {
      expect(processingEvents[0].index).toBe(1);
      expect(processingEvents[0].total).toBe(3);
      expect(processingEvents[0].date).toBe('2025-03-15');
      expect(processingEvents[0].entryType).toBe('Paid Time Off (PTO)');
    }

    if (processingEvents[2].type === 'EntryProcessing') {
      expect(processingEvents[2].index).toBe(3);
      expect(processingEvents[2].total).toBe(3);
    }
  });

  it('publishes EntrySkipped when event exists in calendar', async () => {
    const entries = [makeEntry({ date: '2025-03-15' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget({
      eventExists: vi.fn(async () => true),
    });
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    const skippedEvents = eventBus.events.filter((e) => e.type === 'EntrySkipped');
    expect(skippedEvents).toHaveLength(1);

    if (skippedEvents[0].type === 'EntrySkipped') {
      expect(skippedEvents[0].date).toBe('2025-03-15');
      expect(skippedEvents[0].reason).toContain('already exists in calendar');
    }
  });

  it('publishes EntryFailed when entry processing throws', async () => {
    const entries = [makeEntry({ date: '2025-03-15' }), makeEntry({ date: '2025-03-16' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget({
      createEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error('API rate limit'))
        .mockResolvedValueOnce('event-id-456'),
    });
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    const failedEvents = eventBus.events.filter((e) => e.type === 'EntryFailed');
    expect(failedEvents).toHaveLength(1);

    if (failedEvents[0].type === 'EntryFailed') {
      expect(failedEvents[0].date).toBe('2025-03-15');
      expect(failedEvents[0].error).toBe('API rate limit');
    }

    // Second entry should still succeed
    const createdEvents = eventBus.events.filter((e) => e.type === 'CalendarEventCreated');
    expect(createdEvents).toHaveLength(1);
  });

  it('handles empty entries list', async () => {
    const timeOffSource = createMockTimeOffSource([]);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    expect(calendarTarget.createEvent).not.toHaveBeenCalled();

    const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SyncResult;
    expect(savedResult.entriesFound).toBe(0);
    expect(savedResult.entriesSynced).toBe(0);
    expect(savedResult.entriesSkipped).toBe(0);
  });

  it('handles cancellations by deleting previously-synced calendar events', async () => {
    const entries = [
      makeEntry({ date: '2025-03-15', requestedHours: -8 }), // cancellation
    ];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
      '2025-03-15': 'event-id-to-delete',
    });

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    // Should delete the event
    expect(calendarTarget.deleteEvent).toHaveBeenCalledWith('event-id-to-delete');
    // Should remove from synced state
    expect(syncStateStore.removeSynced).toHaveBeenCalledWith('2025-03-15');
    // Should publish EntrySkipped with cancellation reason
    const skippedEvents = eventBus.events.filter((e) => e.type === 'EntrySkipped');
    expect(skippedEvents).toHaveLength(1);
    if (skippedEvents[0].type === 'EntrySkipped') {
      expect(skippedEvents[0].reason).toContain('cancelled');
    }
  });

  it('does not delete events marked as "existing" during cancellation', async () => {
    const entries = [makeEntry({ date: '2025-03-15', requestedHours: -8 })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
      '2025-03-15': 'existing',
    });

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    // Should NOT delete — 'existing' events were pre-existing, not created by us
    expect(calendarTarget.deleteEvent).not.toHaveBeenCalled();
  });

  it('ignores cancellations for dates not previously synced', async () => {
    const entries = [makeEntry({ date: '2025-03-15', requestedHours: -8 })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    expect(calendarTarget.deleteEvent).not.toHaveBeenCalled();
    expect(syncStateStore.removeSynced).not.toHaveBeenCalled();
  });

  it('aborts early on auth errors', async () => {
    const entries = [
      makeEntry({ date: '2025-03-15' }),
      makeEntry({ date: '2025-03-16' }),
      makeEntry({ date: '2025-03-17' }),
    ];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget({
      createEvent: vi
        .fn()
        .mockRejectedValue(new Error('Google Calendar API error (401): Unauthorized')),
    });
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    // Should only try the first entry, then abort
    expect(calendarTarget.createEvent).toHaveBeenCalledTimes(1);
    const failedEvents = eventBus.events.filter((e) => e.type === 'EntryFailed');
    expect(failedEvents).toHaveLength(1);
  });

  it('continues on non-auth errors', async () => {
    const entries = [makeEntry({ date: '2025-03-15' }), makeEntry({ date: '2025-03-16' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget({
      createEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error('Calendar API rate limit'))
        .mockResolvedValueOnce('event-id-456'),
    });
    const syncStateStore = createMockSyncStateStore();

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    // Should try both entries (rate limit is not an auth error)
    expect(calendarTarget.createEvent).toHaveBeenCalledTimes(2);
  });

  // --- Reconciliation tests (always-on) ---

  describe('calendar reconciliation', () => {
    it('verifies events on calendar when entry is already synced and event still exists', async () => {
      const entries = [makeEntry({ date: '2025-03-15' })];
      const timeOffSource = createMockTimeOffSource(entries);
      const calendarTarget = createMockCalendarTarget({
        eventExists: vi.fn(async () => true),
      });
      const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
        '2025-03-15': 'event-id-123',
      });

      const service = createSyncService({
        timeOffSource,
        calendarTarget,
        syncStateStore,
        logger,
        eventBus,
      });

      await service.sync();

      // Should verify with calendar
      expect(calendarTarget.eventExists).toHaveBeenCalled();
      // Event still exists — should skip, not re-create
      expect(calendarTarget.createEvent).not.toHaveBeenCalled();
      expect(syncStateStore.removeSynced).not.toHaveBeenCalled();

      const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as SyncResult;
      expect(savedResult.entriesSkipped).toBe(1);
      expect(savedResult.entriesResynced).toBe(0);

      const skippedEvents = eventBus.events.filter((e) => e.type === 'EntrySkipped');
      expect(skippedEvents).toHaveLength(1);
      if (skippedEvents[0].type === 'EntrySkipped') {
        expect(skippedEvents[0].reason).toContain('verified');
      }
    });

    it('re-syncs when event was deleted from calendar', async () => {
      const entries = [makeEntry({ date: '2025-03-15' })];
      const timeOffSource = createMockTimeOffSource(entries);
      const calendarTarget = createMockCalendarTarget({
        eventExists: vi.fn(async () => false),
        createEvent: vi.fn(async () => 'new-event-id'),
      });
      const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
        '2025-03-15': 'old-event-id',
      });

      const service = createSyncService({
        timeOffSource,
        calendarTarget,
        syncStateStore,
        logger,
        eventBus,
      });

      await service.sync();

      // Should remove old synced state
      expect(syncStateStore.removeSynced).toHaveBeenCalledWith('2025-03-15');
      // Should re-create the event
      expect(calendarTarget.createEvent).toHaveBeenCalledTimes(1);
      // Should mark newly synced
      expect(syncStateStore.markSynced).toHaveBeenCalledWith('2025-03-15', 'new-event-id');

      const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as SyncResult;
      expect(savedResult.entriesSynced).toBe(1);
      expect(savedResult.entriesResynced).toBe(1);

      // Should publish EntryResynced event
      const resyncedEvents = eventBus.events.filter((e) => e.type === 'EntryResynced');
      expect(resyncedEvents).toHaveLength(1);
      if (resyncedEvents[0].type === 'EntryResynced') {
        expect(resyncedEvents[0].date).toBe('2025-03-15');
        expect(resyncedEvents[0].reason).toContain('deleted from calendar');
      }
    });

    it('skips calendar verification for entries marked as "existing" in local state', async () => {
      const entries = [makeEntry({ date: '2025-03-15' })];
      const timeOffSource = createMockTimeOffSource(entries);
      const calendarTarget = createMockCalendarTarget();
      const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']), {
        '2025-03-15': 'existing',
      });

      const service = createSyncService({
        timeOffSource,
        calendarTarget,
        syncStateStore,
        logger,
        eventBus,
      });

      await service.sync();

      // 'existing' events were pre-existing, not created by us — skip verification
      expect(calendarTarget.eventExists).not.toHaveBeenCalled();
      expect(calendarTarget.createEvent).not.toHaveBeenCalled();

      const savedResult = (syncStateStore.saveLastSyncResult as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as SyncResult;
      expect(savedResult.entriesSkipped).toBe(1);
    });
  });
});
