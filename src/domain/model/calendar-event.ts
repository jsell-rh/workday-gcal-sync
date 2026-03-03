export interface CalendarEvent {
  readonly summary: string;
  readonly description: string;
  readonly startDate: string; // ISO 8601 date (YYYY-MM-DD)
  readonly endDate: string; // ISO 8601 date, exclusive (YYYY-MM-DD, day after)
  readonly isAllDay: true;
}

/**
 * Creates a CalendarEvent from a TimeOffEntry.
 * The end date is exclusive (next day) per Google Calendar API convention.
 */
export function calendarEventFromTimeOff(entry: {
  date: string;
  type: string;
  requestedHours: number;
}): CalendarEvent {
  const startDate = entry.date;
  const endDate = nextDay(startDate);

  const summary =
    entry.requestedHours < 8
      ? `PTO (${entry.requestedHours}h) - ${entry.type}`
      : `PTO - ${entry.type}`;

  return {
    summary,
    description: `Auto-synced from Workday. ${entry.requestedHours} hours.`,
    startDate,
    endDate,
    isAllDay: true,
  };
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
