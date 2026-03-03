import type { TimeOffSource } from '../ports/time-off-source';
import type { CalendarTarget } from '../ports/calendar-target';
import type { SyncStateStore } from '../ports/sync-state-store';
import type { Logger } from '../ports/logger';
import type { EventBus } from '../events/event-bus';
import { isSyncable } from '../model/time-off-entry';
import { calendarEventFromTimeOff } from '../model/calendar-event';
import { createSyncResult, type SyncError } from '../model/sync-result';
import { createDomainEvent } from '../events/domain-events';

export interface SyncServiceDeps {
  timeOffSource: TimeOffSource;
  calendarTarget: CalendarTarget;
  syncStateStore: SyncStateStore;
  logger: Logger;
  eventBus: EventBus;
}

export function createSyncService(deps: SyncServiceDeps) {
  const { timeOffSource, calendarTarget, syncStateStore, logger, eventBus } = deps;

  return {
    async sync(): Promise<void> {
      eventBus.publish(createDomainEvent('SyncStarted', { source: 'workday' }));
      logger.info('Sync started');

      try {
        // 1. Get entries from source
        const entries = await timeOffSource.getEntries();
        const syncable = entries.filter(isSyncable);

        eventBus.publish(
          createDomainEvent('EntriesParsed', {
            count: entries.length,
            syncableCount: syncable.length,
          }),
        );
        logger.info('Entries parsed', {
          total: entries.length,
          syncable: syncable.length,
        });

        // 2. Get already-synced dates
        const syncedDates = await syncStateStore.getSyncedDates();

        // 3. Sync each entry
        let synced = 0;
        let skipped = 0;
        const errors: SyncError[] = [];

        for (const entry of syncable) {
          if (syncedDates.has(entry.date)) {
            eventBus.publish(createDomainEvent('CalendarEventAlreadyExists', { date: entry.date }));
            logger.debug('Event already synced, skipping', { date: entry.date });
            skipped++;
            continue;
          }

          try {
            const calEvent = calendarEventFromTimeOff(entry);
            const exists = await calendarTarget.eventExists(calEvent.startDate, calEvent.summary);

            if (exists) {
              eventBus.publish(
                createDomainEvent('CalendarEventAlreadyExists', { date: entry.date }),
              );
              await syncStateStore.markSynced(entry.date, 'existing');
              skipped++;
              continue;
            }

            const eventId = await calendarTarget.createEvent(calEvent);
            await syncStateStore.markSynced(entry.date, eventId);

            eventBus.publish(
              createDomainEvent('CalendarEventCreated', {
                date: entry.date,
                summary: calEvent.summary,
              }),
            );
            logger.info('Calendar event created', {
              date: entry.date,
              summary: calEvent.summary,
            });
            synced++;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({ entryDate: entry.date, message });
            logger.error('Failed to sync entry', { date: entry.date, error: message });
          }
        }

        // 4. Store sync result
        const result = createSyncResult({
          entriesFound: entries.length,
          entriesSynced: synced,
          entriesSkipped: skipped,
          errors,
        });
        await syncStateStore.saveLastSyncResult(result);

        eventBus.publish(
          createDomainEvent('SyncCompleted', {
            entriesSynced: synced,
            entriesSkipped: skipped,
          }),
        );
        logger.info('Sync completed', {
          synced,
          skipped,
          errors: errors.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        eventBus.publish(createDomainEvent('SyncFailed', { error: message }));
        logger.error('Sync failed', { error: message });
        throw error;
      }
    },
  };
}
