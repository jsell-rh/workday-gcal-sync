import type { CalendarEvent } from '../model/calendar-event';

/**
 * Port: Target calendar for syncing events.
 * Implemented by adapters like GoogleCalendarAdapter.
 */
export interface CalendarTarget {
  /**
   * Creates an event in the calendar.
   * @returns The created event's ID.
   */
  createEvent(event: CalendarEvent): Promise<string>;

  /**
   * Checks if an event already exists for the given date and summary.
   */
  eventExists(date: string, summary: string): Promise<boolean>;

  /**
   * Deletes an event by its ID.
   */
  deleteEvent(eventId: string): Promise<void>;

  /**
   * Finds a managed event by date. Returns the event ID or null.
   */
  findEventByDate?(date: string): Promise<string | null>;
}
