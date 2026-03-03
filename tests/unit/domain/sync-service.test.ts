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
  overrides: Partial<SyncStateStore> = {},
): SyncStateStore {
  return {
    getSyncedDates: vi.fn(async () => syncedDates),
    markSynced: vi.fn(async () => {}),
    removeSynced: vi.fn(async () => {}),
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

  it('skips already-synced dates from sync state', async () => {
    const entries = [makeEntry({ date: '2025-03-15' }), makeEntry({ date: '2025-03-16' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']));

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    // Only the second entry should be created
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

    const created = eventBus.events[2];
    if (created.type === 'CalendarEventCreated') {
      expect(created.date).toBe('2025-03-15');
    }

    const completed = eventBus.events[3];
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

  it('publishes CalendarEventAlreadyExists for already-synced dates', async () => {
    const entries = [makeEntry({ date: '2025-03-15' })];
    const timeOffSource = createMockTimeOffSource(entries);
    const calendarTarget = createMockCalendarTarget();
    const syncStateStore = createMockSyncStateStore(new Set(['2025-03-15']));

    const service = createSyncService({
      timeOffSource,
      calendarTarget,
      syncStateStore,
      logger,
      eventBus,
    });

    await service.sync();

    const eventTypes = eventBus.events.map((e) => e.type);
    expect(eventTypes).toContain('CalendarEventAlreadyExists');
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
});
