export type EventVisibility = 'busy' | 'free' | 'outOfOffice';

export interface SyncSettings {
  readonly eventVisibility: EventVisibility;
  readonly titleTemplate: string;
  readonly calendarIds: string[]; // ['primary'] or specific calendar IDs
  readonly workdayAbsenceUrl: string;
}

export const DEFAULT_SETTINGS: SyncSettings = {
  eventVisibility: 'busy',
  titleTemplate: 'PTO - {type}',
  calendarIds: ['primary'],
  workdayAbsenceUrl: 'https://wd5.myworkday.com/redhat/d/task/2997$276.htmld',
};

/**
 * Renders an event title from a template string.
 * Available variables: {type}, {hours}, {status}
 */
export function renderTitle(
  template: string,
  vars: { type: string; hours: number; status: string },
): string {
  return template
    .replace(/\{type\}/g, vars.type)
    .replace(/\{hours\}/g, String(vars.hours))
    .replace(/\{status\}/g, vars.status);
}
