import type { TimeOffEntry } from '../model/time-off-entry';

/**
 * Port: Source of time-off entries.
 * Implemented by adapters like WorkdayDomScraper.
 */
export interface TimeOffSource {
  /**
   * Extracts time-off entries from the source.
   * @returns Array of parsed time-off entries.
   */
  getEntries(): Promise<TimeOffEntry[]>;
}
