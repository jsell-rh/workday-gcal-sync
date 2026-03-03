import type { CalendarTarget } from '../../domain/ports/calendar-target';
import type { CalendarEvent } from '../../domain/model/calendar-event';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleCalendarConfig {
  calendarId?: string; // defaults to 'primary'
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
}

/**
 * Builds the Google Calendar API request body from a CalendarEvent.
 * Handles visibility mapping including Out of Office event type.
 *
 * Out of Office events cannot be all-day events (using `date` fields) in
 * Google Calendar.  They must use `dateTime` with explicit midnight-to-midnight
 * times and a timeZone so Google knows which day is intended.
 */
function buildEventBody(event: CalendarEvent): Record<string, unknown> {
  const isOutOfOffice = event.visibility === 'outOfOffice';

  const body: Record<string, unknown> = {
    summary: event.summary,
    // Out of Office events must not have a description field — Google Calendar
    // rejects the request with "An out of office event must not have a description."
    ...(isOutOfOffice ? {} : { description: event.description }),
  };

  if (isOutOfOffice) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    body.start = { dateTime: `${event.startDate}T00:00:00`, timeZone };
    body.end = { dateTime: `${event.endDate}T00:00:00`, timeZone };
    body.eventType = 'outOfOffice';
    body.outOfOfficeProperties = {
      autoDeclineMode: 'declineAllConflictingInvitations',
    };
  } else {
    body.start = { date: event.startDate };
    body.end = { date: event.endDate };

    switch (event.visibility) {
      case 'free':
        body.transparency = 'transparent';
        break;
      case 'busy':
      default:
        body.transparency = 'opaque';
        break;
    }
  }

  body.extendedProperties = {
    private: {
      ptoSyncManaged: 'true',
      ptoSyncDate: event.startDate,
    },
  };

  return body;
}

export function createGoogleCalendarAdapter(
  getAuthToken: () => Promise<string>,
  config: GoogleCalendarConfig = {},
): CalendarTarget {
  const calendarId = encodeURIComponent(config.calendarId ?? 'primary');

  async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    let token = await getAuthToken();
    let response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Token expired — clear cache and retry once
    if (response.status === 401) {
      if (
        typeof chrome !== 'undefined' &&
        chrome.identity &&
        typeof chrome.identity.removeCachedAuthToken === 'function'
      ) {
        await new Promise<void>((resolve) => {
          chrome.identity.removeCachedAuthToken({ token }, () => resolve());
        });
      }
      token = await getAuthToken();
      response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Calendar API error (${response.status}): ${body}`);
    }

    return response;
  }

  return {
    async createEvent(event: CalendarEvent): Promise<string> {
      const body = buildEventBody(event);

      const response = await authenticatedFetch(
        `${CALENDAR_API_BASE}/calendars/${calendarId}/events`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );

      const data = await response.json();
      return data.id;
    },

    async eventExists(date: string, _summary: string): Promise<boolean> {
      // Use a wide window (previous day to next day in UTC) to account for
      // timezone differences.  OOO events store local midnight (e.g.
      // 2025-03-15T00:00:00-05:00) which is 2025-03-15T05:00:00Z in UTC.
      // A strict UTC-midnight window would miss events in western timezones.
      const dayBefore = new Date(`${date}T00:00:00Z`);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(`${date}T00:00:00Z`);
      dayAfter.setDate(dayAfter.getDate() + 2);

      const params = new URLSearchParams({
        timeMin: dayBefore.toISOString(),
        timeMax: dayAfter.toISOString(),
        privateExtendedProperty: `ptoSyncDate=${date}`,
        singleEvents: 'true',
        maxResults: '10',
      });

      const response = await authenticatedFetch(
        `${CALENDAR_API_BASE}/calendars/${calendarId}/events?${params}`,
      );

      const data = await response.json();
      return (data.items ?? []).length > 0;
    },

    async deleteEvent(eventId: string): Promise<void> {
      await authenticatedFetch(
        `${CALENDAR_API_BASE}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' },
      );
    },

    async findEventByDate(date: string): Promise<string | null> {
      const dayBefore = new Date(`${date}T00:00:00Z`);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(`${date}T00:00:00Z`);
      dayAfter.setDate(dayAfter.getDate() + 2);

      const params = new URLSearchParams({
        timeMin: dayBefore.toISOString(),
        timeMax: dayAfter.toISOString(),
        privateExtendedProperty: `ptoSyncDate=${date}`,
        singleEvents: 'true',
        maxResults: '1',
      });

      const response = await authenticatedFetch(
        `${CALENDAR_API_BASE}/calendars/${calendarId}/events?${params}`,
      );

      const data = await response.json();
      const items = data.items ?? [];
      return items.length > 0 ? items[0].id : null;
    },
  };
}

/**
 * Fetches the user's calendar list from Google Calendar API.
 * Requires an auth token with calendar access.
 */
export async function listCalendars(
  getAuthToken: () => Promise<string>,
): Promise<CalendarListEntry[]> {
  const token = await getAuthToken();
  const response = await fetch(`${CALENDAR_API_BASE}/users/me/calendarList`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Calendar API error (${response.status}): ${body}`);
  }

  const data = await response.json();
  return (data.items ?? []).map((item: { id: string; summary: string; primary?: boolean }) => ({
    id: item.id,
    summary: item.summary,
    primary: item.primary === true,
  }));
}
