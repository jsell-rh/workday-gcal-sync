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
    visibility: 'busy',
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

    it('uses dateTime for outOfOffice events instead of all-day date fields', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'ooo-event-id' }));

      const oooEvent: CalendarEvent = {
        summary: 'PTO - Paid Time Off (PTO)',
        description: 'Auto-synced from Workday. 8 hours.',
        startDate: '2025-03-15',
        endDate: '2025-03-16',
        isAllDay: false,
        visibility: 'outOfOffice',
      };

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken);
      const id = await adapter.createEvent(oooEvent);

      expect(id).toBe('ooo-event-id');

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Must use dateTime, not date
      expect(body.start.dateTime).toBe('2025-03-15T00:00:00');
      expect(body.start.timeZone).toBeDefined();
      expect(body.start.date).toBeUndefined();
      expect(body.end.dateTime).toBe('2025-03-16T00:00:00');
      expect(body.end.timeZone).toBeDefined();
      expect(body.end.date).toBeUndefined();

      // Must set eventType and outOfOfficeProperties
      expect(body.eventType).toBe('outOfOffice');
      expect(body.outOfOfficeProperties).toEqual({
        autoDeclineMode: 'declineAllConflictingInvitations',
      });

      // Must NOT include transparency or description
      expect(body.transparency).toBeUndefined();
      expect(body.description).toBeUndefined();
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

  describe('OOO fallback on secondary calendars', () => {
    const oooEvent: CalendarEvent = {
      summary: 'OOO - Vacation',
      description: 'Auto-synced from Workday. 8 hours.',
      startDate: '2025-03-15',
      endDate: '2025-03-16',
      isAllDay: false,
      visibility: 'outOfOffice',
    };

    it('retries with a fallback busy event when OOO is not supported', async () => {
      // First call fails with OOO-related error
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ error: { message: 'Invalid eventType: outOfOffice' } }, 400),
      );
      // Retry succeeds
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'fallback-event-id' }));

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken, {
        calendarId: 'secondary@group.calendar.google.com',
      });
      const id = await adapter.createEvent(oooEvent);

      expect(id).toBe('fallback-event-id');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify the fallback body
      const [, retryOptions] = mockFetch.mock.calls[1];
      const fallbackBody = JSON.parse(retryOptions.body);
      expect(fallbackBody.summary).toBe('OOO - Vacation');
      expect(fallbackBody.start.date).toBe('2025-03-15');
      expect(fallbackBody.start.dateTime).toBeUndefined();
      expect(fallbackBody.end.date).toBe('2025-03-16');
      expect(fallbackBody.end.dateTime).toBeUndefined();
      expect(fallbackBody.transparency).toBe('opaque');
      expect(fallbackBody.eventType).toBeUndefined();
      expect(fallbackBody.outOfOfficeProperties).toBeUndefined();
      expect(fallbackBody.extendedProperties).toEqual({
        private: {
          ptoSyncManaged: 'true',
          ptoSyncDate: '2025-03-15',
        },
      });
    });

    it('throws normally when error is not OOO-related', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ error: { message: 'Quota exceeded' } }, 429),
      );

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken, {
        calendarId: 'secondary@group.calendar.google.com',
      });

      await expect(adapter.createEvent(oooEvent)).rejects.toThrow(
        'Google Calendar API error (429)',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry when event is not OOO', async () => {
      const busyEvent: CalendarEvent = {
        summary: 'PTO - Vacation',
        description: 'Auto-synced from Workday. 8 hours.',
        startDate: '2025-03-15',
        endDate: '2025-03-16',
        isAllDay: true,
        visibility: 'busy',
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: { message: 'Some error' } }, 400));

      const adapter = createGoogleCalendarAdapter(mockGetAuthToken);

      await expect(adapter.createEvent(busyEvent)).rejects.toThrow(
        'Google Calendar API error (400)',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
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

  describe('401 token refresh', () => {
    beforeEach(() => {
      // Mock chrome.identity for token refresh tests
      vi.stubGlobal('chrome', {
        identity: {
          removeCachedAuthToken: vi.fn((_opts: unknown, cb: () => void) => cb()),
        },
      });
    });

    it('retries once on 401 with a fresh token', async () => {
      const tokens = ['expired-token', 'fresh-token'];
      let tokenIndex = 0;
      const getToken = vi.fn(async () => tokens[tokenIndex++]);

      // First call returns 401, second succeeds
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse({ error: 'Unauthorized' }, 401))
        .mockResolvedValueOnce(mockJsonResponse({ id: 'created-event-id' }));

      const adapter = createGoogleCalendarAdapter(getToken);
      const id = await adapter.createEvent(testEvent);

      expect(id).toBe('created-event-id');
      expect(getToken).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call used expired token
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer expired-token');
      // Retry used fresh token
      expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
    });

    it('throws if retry also fails', async () => {
      const getToken = vi.fn(async () => 'some-token');

      mockFetch
        .mockResolvedValueOnce(mockJsonResponse({ error: 'Unauthorized' }, 401))
        .mockResolvedValueOnce(mockJsonResponse({ error: 'Still unauthorized' }, 401));

      const adapter = createGoogleCalendarAdapter(getToken);
      await expect(adapter.createEvent(testEvent)).rejects.toThrow(
        'Google Calendar API error (401)',
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
