import type { CalendarTarget } from '../../domain/ports/calendar-target';
import type { CalendarEvent } from '../../domain/model/calendar-event';

/**
 * Adapter: Google Calendar API client.
 *
 * Uses chrome.identity.getAuthToken() for OAuth and the
 * Google Calendar REST API to create events.
 */
export function createGoogleCalendarAdapter(_getAuthToken: () => Promise<string>): CalendarTarget {
  return {
    async createEvent(_event: CalendarEvent): Promise<string> {
      // TODO: Implement Google Calendar API calls
      throw new Error('Not implemented');
    },

    async eventExists(_date: string, _summary: string): Promise<boolean> {
      // TODO: Query existing events by date range and summary
      throw new Error('Not implemented');
    },

    async deleteEvent(_eventId: string): Promise<void> {
      // TODO: Delete event by ID
      throw new Error('Not implemented');
    },
  };
}
