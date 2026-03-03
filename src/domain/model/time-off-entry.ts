export type TimeOffStatus = 'Submitted' | 'Approved' | 'Denied' | 'Cancelled';

export type TimeOffType = 'Paid Time Off (PTO)' | 'Floating Holiday' | string;

export interface TimeOffEntry {
  readonly date: string; // ISO 8601 date string (YYYY-MM-DD)
  readonly dayOfWeek: string;
  readonly type: TimeOffType;
  readonly requestedHours: number;
  readonly unitOfTime: string;
  readonly status: TimeOffStatus;
}

/**
 * Creates a TimeOffEntry, normalizing the date from MM/DD/YYYY to ISO 8601.
 * Throws if the date is invalid.
 */
export function createTimeOffEntry(raw: {
  date: string;
  dayOfWeek: string;
  type: string;
  requestedHours: number;
  unitOfTime: string;
  status: string;
}): TimeOffEntry {
  const isoDate = parseWorkdayDate(raw.date);
  if (!isoDate) {
    throw new Error(`Invalid date format: ${raw.date}`);
  }
  return {
    date: isoDate,
    dayOfWeek: raw.dayOfWeek,
    type: raw.type as TimeOffType,
    requestedHours: raw.requestedHours,
    unitOfTime: raw.unitOfTime,
    status: raw.status as TimeOffStatus,
  };
}

/**
 * Parses MM/DD/YYYY to YYYY-MM-DD. Returns null if invalid.
 */
export function parseWorkdayDate(dateStr: string): string | null {
  const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const d = new Date(`${year}-${month}-${day}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Returns true if the entry represents a cancellation (negative hours).
 */
export function isCancellation(entry: TimeOffEntry): boolean {
  return entry.requestedHours < 0;
}

/**
 * Returns true if the entry is in a syncable state (approved or submitted, positive hours).
 */
export function isSyncable(entry: TimeOffEntry): boolean {
  return !isCancellation(entry) && (entry.status === 'Approved' || entry.status === 'Submitted');
}
