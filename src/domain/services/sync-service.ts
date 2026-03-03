import type { TimeOffSource } from '../ports/time-off-source';
import type { CalendarTarget } from '../ports/calendar-target';
import type { SyncStateStore } from '../ports/sync-state-store';
import type { Logger } from '../ports/logger';
import type { EventBus } from '../events/event-bus';
import { isSyncable, isCancellation, type TimeOffEntry } from '../model/time-off-entry';
import { calendarEventFromTimeOff } from '../model/calendar-event';
import { createSyncResult, type SyncError } from '../model/sync-result';
import { createDomainEvent } from '../events/domain-events';
import type { SyncSettings } from '../model/settings';
import type { SyncPreview, SyncPreviewEntry } from '../model/sync-preview';

export interface SyncServiceDeps {
  timeOffSource: TimeOffSource;
  calendarTarget: CalendarTarget;
  syncStateStore: SyncStateStore;
  logger: Logger;
  eventBus: EventBus;
  settings?: SyncSettings;
}

/**
 * Builds a preview from already-fetched entries without modifying any state.
 * This is a pure read operation: it checks local sync state and the calendar
 * to determine what action each entry would trigger.
 */
export async function buildPreview(
  entries: TimeOffEntry[],
  deps: {
    calendarTarget: CalendarTarget;
    syncStateStore: SyncStateStore;
    settings?: SyncSettings;
  },
): Promise<SyncPreview> {
  const { calendarTarget, syncStateStore, settings } = deps;
  const syncedDates = await syncStateStore.getSyncedDates();
  const previewEntries: SyncPreviewEntry[] = [];

  const eventOptions = {
    titleTemplate: settings?.titleTemplate,
    eventVisibility: settings?.eventVisibility,
  };

  // Handle cancellations
  const cancellations = entries.filter(isCancellation);
  for (const cancellation of cancellations) {
    const eventId = await syncStateStore.getEventId(cancellation.date);
    if (eventId && eventId !== 'existing') {
      previewEntries.push({
        date: cancellation.date,
        dayOfWeek: cancellation.dayOfWeek,
        type: cancellation.type,
        hours: cancellation.requestedHours,
        status: cancellation.status,
        action: 'delete',
        actionReason: 'Cancelled in Workday, will remove from calendar',
      });
    } else {
      previewEntries.push({
        date: cancellation.date,
        dayOfWeek: cancellation.dayOfWeek,
        type: cancellation.type,
        hours: cancellation.requestedHours,
        status: cancellation.status,
        action: 'skip',
        actionReason: 'Cancelled (not on calendar)',
      });
    }
  }

  // Handle syncable entries
  const syncable = entries.filter(isSyncable);
  for (const entry of syncable) {
    if (syncedDates.has(entry.date)) {
      const storedEventId = await syncStateStore.getEventId(entry.date);
      if (storedEventId && storedEventId !== 'existing') {
        const calEvent = calendarEventFromTimeOff(entry, eventOptions);
        const stillExists = await calendarTarget.eventExists(calEvent.startDate, calEvent.summary);
        if (!stillExists) {
          previewEntries.push({
            date: entry.date,
            dayOfWeek: entry.dayOfWeek,
            type: entry.type,
            hours: entry.requestedHours,
            status: entry.status,
            action: 'resync',
            actionReason: 'Deleted from calendar, will re-create',
          });
        } else {
          previewEntries.push({
            date: entry.date,
            dayOfWeek: entry.dayOfWeek,
            type: entry.type,
            hours: entry.requestedHours,
            status: entry.status,
            action: 'skip',
            actionReason: 'Already on calendar',
          });
        }
      } else {
        previewEntries.push({
          date: entry.date,
          dayOfWeek: entry.dayOfWeek,
          type: entry.type,
          hours: entry.requestedHours,
          status: entry.status,
          action: 'skip',
          actionReason: 'Already on calendar',
        });
      }
    } else {
      // Check if it exists on calendar but not in local state
      const calEvent = calendarEventFromTimeOff(entry, eventOptions);
      const exists = await calendarTarget.eventExists(calEvent.startDate, calEvent.summary);
      if (exists) {
        previewEntries.push({
          date: entry.date,
          dayOfWeek: entry.dayOfWeek,
          type: entry.type,
          hours: entry.requestedHours,
          status: entry.status,
          action: 'skip',
          actionReason: 'Already on calendar',
        });
      } else {
        previewEntries.push({
          date: entry.date,
          dayOfWeek: entry.dayOfWeek,
          type: entry.type,
          hours: entry.requestedHours,
          status: entry.status,
          action: 'create',
          actionReason: 'New entry',
        });
      }
    }
  }

  // Sort by date
  previewEntries.sort((a, b) => a.date.localeCompare(b.date));

  return { entries: previewEntries };
}

export function createSyncService(deps: SyncServiceDeps) {
  const { timeOffSource, calendarTarget, syncStateStore, logger, eventBus, settings } = deps;

  return {
    async preview(): Promise<SyncPreview> {
      const entries = await timeOffSource.getEntries();
      return buildPreview(entries, { calendarTarget, syncStateStore, settings });
    },

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

        // Phase 1: Handle cancellations — delete calendar events for cancelled PTO
        const cancellations = entries.filter(isCancellation);
        for (const cancellation of cancellations) {
          const eventId = await syncStateStore.getEventId(cancellation.date);
          if (eventId && eventId !== 'existing') {
            try {
              await calendarTarget.deleteEvent(eventId);
              await syncStateStore.removeSynced(cancellation.date);
              eventBus.publish(
                createDomainEvent('EntrySkipped', {
                  date: cancellation.date,
                  reason: 'cancelled - calendar event removed',
                }),
              );
              logger.info('Cancelled PTO event removed', { date: cancellation.date });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error('Failed to remove cancelled event', {
                date: cancellation.date,
                error: message,
              });
            }
          }
        }

        // 2. Get already-synced dates
        const syncedDates = await syncStateStore.getSyncedDates();

        // 3. Sync each entry
        let synced = 0;
        let skipped = 0;
        let resynced = 0;
        const errors: SyncError[] = [];

        const eventOptions = {
          titleTemplate: settings?.titleTemplate,
          eventVisibility: settings?.eventVisibility,
        };

        for (let i = 0; i < syncable.length; i++) {
          const entry = syncable[i];

          eventBus.publish(
            createDomainEvent('EntryProcessing', {
              date: entry.date,
              entryType: entry.type,
              index: i + 1,
              total: syncable.length,
            }),
          );
          logger.debug('Processing entry', {
            date: entry.date,
            index: i + 1,
            total: syncable.length,
          });

          let isResync = false;

          if (syncedDates.has(entry.date)) {
            // Always verify the event still exists on the calendar
            const calEvent = calendarEventFromTimeOff(entry, eventOptions);
            const stillExists = await calendarTarget.eventExists(
              calEvent.startDate,
              calEvent.summary,
            );
            if (stillExists) {
              eventBus.publish(
                createDomainEvent('EntrySkipped', {
                  date: entry.date,
                  reason: 'already on calendar (verified)',
                }),
              );
              skipped++;
              continue;
            } else {
              // Event was deleted from calendar — remove from local state and re-sync
              await syncStateStore.removeSynced(entry.date);
              eventBus.publish(
                createDomainEvent('EntryResynced', {
                  date: entry.date,
                  reason: 'event was deleted from calendar',
                }),
              );
              logger.info('Event deleted from calendar, re-syncing', { date: entry.date });
              isResync = true;
              resynced++;
              // Fall through to create the event again
            }
          }

          try {
            const calEvent = calendarEventFromTimeOff(entry, eventOptions);

            // Skip the duplicate check if we just confirmed the event is gone (re-sync)
            if (!isResync) {
              const exists = await calendarTarget.eventExists(calEvent.startDate, calEvent.summary);

              if (exists) {
                eventBus.publish(
                  createDomainEvent('EntrySkipped', {
                    date: entry.date,
                    reason: 'already exists in calendar',
                  }),
                );
                await syncStateStore.markSynced(entry.date, 'existing');
                skipped++;
                continue;
              }
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
            if (!isResync) {
              synced++;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({ entryDate: entry.date, message });
            eventBus.publish(
              createDomainEvent('EntryFailed', {
                date: entry.date,
                error: message,
              }),
            );
            logger.error('Failed to sync entry', { date: entry.date, error: message });

            // Fail fast on auth errors — no point retrying remaining entries
            if (/oauth|401|auth|token/i.test(message)) {
              logger.error('Auth error detected, aborting remaining entries');
              break;
            }
          }
        }

        // 4. Store sync result
        const result = createSyncResult({
          entriesFound: entries.length,
          entriesSynced: synced,
          entriesSkipped: skipped,
          entriesResynced: resynced,
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
