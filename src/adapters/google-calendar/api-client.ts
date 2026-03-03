import type { CalendarTarget } from '../../domain/ports/calendar-target';
import type { CalendarEvent } from '../../domain/model/calendar-event';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleCalendarConfig {
  calendarId?: string; // defaults to 'primary'
}

export function createGoogleCalendarAdapter(
  getAuthToken: () => Promise<string>,
  config: GoogleCalendarConfig = {},
): CalendarTarget {
  const calendarId = encodeURIComponent(config.calendarId ?? 'primary');

  async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = await getAuthToken();
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Calendar API error (${response.status}): ${body}`);
    }

    return response;
  }

  return {
    async createEvent(event: CalendarEvent): Promise<string> {
      const body = {
        summary: event.summary,
        description: event.description,
        start: { date: event.startDate },
        end: { date: event.endDate },
        transparency: 'opaque',
      };

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

    async eventExists(date: string, summary: string): Promise<boolean> {
      // Query events on the specific date
      const timeMin = `${date}T00:00:00Z`;
      const nextDay = new Date(`${date}T00:00:00Z`);
      nextDay.setDate(nextDay.getDate() + 1);
      const timeMax = nextDay.toISOString();

      const params = new URLSearchParams({
        timeMin,
        timeMax,
        q: summary,
        singleEvents: 'true',
        maxResults: '10',
      });

      const response = await authenticatedFetch(
        `${CALENDAR_API_BASE}/calendars/${calendarId}/events?${params}`,
      );

      const data = await response.json();
      return (data.items ?? []).some((item: { summary?: string }) => item.summary === summary);
    },

    async deleteEvent(eventId: string): Promise<void> {
      await authenticatedFetch(
        `${CALENDAR_API_BASE}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' },
      );
    },
  };
}
