import { type EventVisibility, renderTitle } from './settings';

export interface CalendarEvent {
  readonly summary: string;
  readonly description: string;
  readonly startDate: string; // ISO 8601 date (YYYY-MM-DD)
  readonly endDate: string; // ISO 8601 date, exclusive (YYYY-MM-DD, day after)
  readonly isAllDay: boolean;
  readonly visibility: EventVisibility;
}

export interface CalendarEventOptions {
  titleTemplate?: string;
  eventVisibility?: EventVisibility;
}

/**
 * Creates a CalendarEvent from a TimeOffEntry.
 * The end date is exclusive (next day) per Google Calendar API convention.
 *
 * When a titleTemplate is provided, it uses the template system.
 * Otherwise falls back to the legacy format for backward compatibility.
 */
export function calendarEventFromTimeOff(
  entry: {
    date: string;
    type: string;
    requestedHours: number;
    status?: string;
  },
  options: CalendarEventOptions = {},
): CalendarEvent {
  const startDate = entry.date;
  const endDate = nextDay(startDate);
  const { titleTemplate, eventVisibility = 'busy' } = options;

  let summary: string;
  if (titleTemplate) {
    summary = renderTitle(titleTemplate, {
      type: entry.type,
      hours: entry.requestedHours,
      status: entry.status ?? '',
    });
  } else {
    // Legacy format
    summary =
      entry.requestedHours < 8
        ? `PTO (${entry.requestedHours}h) - ${entry.type}`
        : `PTO - ${entry.type}`;
  }

  return {
    summary,
    description: `Auto-synced from Workday. ${entry.requestedHours} hours.`,
    startDate,
    endDate,
    isAllDay: eventVisibility !== 'outOfOffice',
    visibility: eventVisibility,
  };
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
