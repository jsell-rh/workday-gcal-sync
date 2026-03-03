import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleCalendarAdapter } from '../../../src/adapters/google-calendar/api-client';
import type { CalendarEvent } from '../../../src/domain/model/calendar-event';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockGetAuthToken = vi.fn(async () => 'mock-token-123');

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

describe('GoogleCalendarAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testEvent: CalendarEvent = {
    summary: 'PTO - Paid Time Off (PTO)',
    description: 'Auto-synced from Workday. 8 hours.',
    startDate: '2025-03-15',
    endDate: '2025-03-16',
    isAllDay: true,
  };

  describe('createEvent', () => {
    it('posts event to Google Calendar API with auth token', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'created-event-id' }));

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken);
      const id = await adapter.createEvent(testEvent);

      expect(id).toBe('created-event-id');
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/calendars/primary/events');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer mock-token-123');

      const body = JSON.parse(options.body);
      expect(body.summary).toBe(testEvent.summary);
      expect(body.start.date).toBe('2025-03-15');
      expect(body.end.date).toBe('2025-03-16');
      expect(body.transparency).toBe('opaque');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: 'forbidden' }, 403));

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken);
      await expect(adapter.createEvent(testEvent)).rejects.toThrow(
        'Google Calendar API error (403)',
      );
    });
  });

  describe('eventExists', () => {
    it('returns true when matching event found', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          items: [{ summary: 'PTO - Paid Time Off (PTO)' }],
        }),
      );

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken);
      const exists = await adapter.eventExists('2025-03-15', 'PTO - Paid Time Off (PTO)');

      expect(exists).toBe(true);
    });

    it('returns false when no matching event found', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ items: [] }));

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken);
      const exists = await adapter.eventExists('2025-03-15', 'PTO - Paid Time Off (PTO)');

      expect(exists).toBe(false);
    });
  });

  describe('deleteEvent', () => {
    it('sends DELETE request with event ID', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse(null, 204));

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken);
      await adapter.deleteEvent('event-to-delete');

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/events/event-to-delete');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('custom calendarId', () => {
    it('uses custom calendar ID in API URLs', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'created-event-id' }));

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken, {
        calendarId: 'my-custom-calendar@group.calendar.google.com',
      });
      await adapter.createEvent(testEvent);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(encodeURIComponent('my-custom-calendar@group.calendar.google.com'));
    });
  });
});
