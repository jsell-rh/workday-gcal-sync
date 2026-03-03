import type { TimeOffSource } from '../../domain/ports/time-off-source';
import type { TimeOffEntry } from '../../domain/model/time-off-entry';

/**
 * Adapter: Scrapes time-off entries from the Workday DOM.
 *
 * This adapter runs in a content script context and extracts
 * data from the "My Absence" page table.
 *
 * DOM selectors will be verified via Playwright research harness
 * before implementation.
 */
export function createWorkdayDomScraper(_document: Document): TimeOffSource {
  return {
    async getEntries(): Promise<TimeOffEntry[]> {
      // TODO: Implement after DOM research confirms selectors
      // Known columns from screenshot analysis:
      //   Date | Day of the Week | Type | Requested | Unit of Time | Status | View More
      // Page URL: https://wd5.myworkday.com/redhat/d/task/2997$276.htmld
      // Page title: "My Absence"
      throw new Error('Not implemented: awaiting DOM research');
    },
  };
}
