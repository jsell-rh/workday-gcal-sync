import type { CalendarTarget } from '../../domain/ports/calendar-target';
import type { CalendarEvent } from '../../domain/model/calendar-event';

/**
 * Wraps multiple single-calendar CalendarTarget adapters into one.
 *
 * - createEvent: creates the event on ALL calendars, returns a composite ID (pipe-delimited)
 * - eventExists: checks the FIRST calendar only (for dedup purposes)
 * - deleteEvent: parses the composite ID and deletes from all calendars
 */
export function createMultiCalendarTarget(targets: CalendarTarget[]): CalendarTarget {
  if (targets.length === 0) {
    throw new Error('At least one calendar target is required');
  }

  return {
    async createEvent(event: CalendarEvent): Promise<string> {
      const ids: string[] = [];
      for (const target of targets) {
        const id = await target.createEvent(event);
        ids.push(id);
      }
      return ids.join('|');
    },

    async eventExists(date: string, summary: string): Promise<boolean> {
      // Check first calendar only for dedup
      return targets[0].eventExists(date, summary);
    },

    async deleteEvent(compositeId: string): Promise<void> {
      const ids = compositeId.split('|');
      for (let i = 0; i < targets.length && i < ids.length; i++) {
        await targets[i].deleteEvent(ids[i]);
      }
    },

    async findEventByDate(date: string): Promise<string | null> {
      // Check first calendar only
      if (targets[0].findEventByDate) {
        return targets[0].findEventByDate(date);
      }
      return null;
    },
  };
}
