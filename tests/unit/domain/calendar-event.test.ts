import { describe, it, expect } from 'vitest';
import { calendarEventFromTimeOff } from '../../../src/domain/model/calendar-event';

describe('calendarEventFromTimeOff', () => {
  it('creates clean summary for full day (8 hours)', () => {
    const event = calendarEventFromTimeOff({
      date: '2025-03-15',
      type: 'Paid Time Off (PTO)',
      requestedHours: 8,
    });

    expect(event.summary).toBe('OOO - Paid Time Off (PTO)');
    expect(event.description).toBe('Auto-synced from Workday. 8 hours.');
    // Default visibility is now outOfOffice, so isAllDay defaults to false
    expect(event.isAllDay).toBe(false);
    expect(event.visibility).toBe('outOfOffice');
  });

  it('includes hours in summary for partial day (less than 8 hours)', () => {
    const event = calendarEventFromTimeOff({
      date: '2025-03-15',
      type: 'Paid Time Off (PTO)',
      requestedHours: 4,
    });

    expect(event.summary).toBe('OOO (4h) - Paid Time Off (PTO)');
    expect(event.description).toBe('Auto-synced from Workday. 4 hours.');
  });

  it('sets end date to the next day (exclusive)', () => {
    const event = calendarEventFromTimeOff({
      date: '2025-03-15',
      type: 'Paid Time Off (PTO)',
      requestedHours: 8,
    });

    expect(event.startDate).toBe('2025-03-15');
    expect(event.endDate).toBe('2025-03-16');
  });

  it('handles end-of-month boundary for end date', () => {
    const event = calendarEventFromTimeOff({
      date: '2025-01-31',
      type: 'Paid Time Off (PTO)',
      requestedHours: 8,
    });

    expect(event.startDate).toBe('2025-01-31');
    expect(event.endDate).toBe('2025-02-01');
  });

  it('handles end-of-year boundary for end date', () => {
    const event = calendarEventFromTimeOff({
      date: '2025-12-31',
      type: 'Paid Time Off (PTO)',
      requestedHours: 8,
    });

    expect(event.startDate).toBe('2025-12-31');
    expect(event.endDate).toBe('2026-01-01');
  });

  it('handles Floating Holiday type', () => {
    const event = calendarEventFromTimeOff({
      date: '2025-07-04',
      type: 'Floating Holiday',
      requestedHours: 8,
    });

    expect(event.summary).toBe('OOO - Floating Holiday');
    expect(event.description).toBe('Auto-synced from Workday. 8 hours.');
  });

  it('handles partial Floating Holiday', () => {
    const event = calendarEventFromTimeOff({
      date: '2025-07-04',
      type: 'Floating Holiday',
      requestedHours: 4,
    });

    expect(event.summary).toBe('OOO (4h) - Floating Holiday');
  });

  it('treats more-than-8 hours as full day summary', () => {
    const event = calendarEventFromTimeOff({
      date: '2025-03-15',
      type: 'Paid Time Off (PTO)',
      requestedHours: 10,
    });

    expect(event.summary).toBe('OOO - Paid Time Off (PTO)');
  });

  it('sets isAllDay to false when eventVisibility is outOfOffice', () => {
    const event = calendarEventFromTimeOff(
      {
        date: '2025-03-15',
        type: 'Paid Time Off (PTO)',
        requestedHours: 8,
      },
      { eventVisibility: 'outOfOffice' },
    );

    expect(event.isAllDay).toBe(false);
    expect(event.visibility).toBe('outOfOffice');
  });
});
