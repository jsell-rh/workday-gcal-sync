import type { TimeOffSource } from '../../domain/ports/time-off-source';
import type { TimeOffEntry } from '../../domain/model/time-off-entry';
import { createTimeOffEntry } from '../../domain/model/time-off-entry';

/**
 * Verified Workday DOM selectors (captured via Playwright 2026-03-03).
 *
 * Table structure:
 *   <table data-automation-id="table">
 *     <thead data-automation-id="tableHead">
 *       <tr data-automation-id="tableHeaderRow">
 *         <th data-automation-id="columnHeader61.N" role="columnheader">
 *     <tbody>
 *       <tr data-automation-id="row" data-row-id="NNN" role="row">
 *         <th role="rowheader" data-automation-id="cell">  ← Date (textView)
 *         <td data-automation-id="cell">                   ← Day of Week (textView)
 *         <td data-automation-id="cell">                   ← Type (promptOption)
 *         <td data-automation-id="cell">                   ← Requested (numericText)
 *         <td data-automation-id="cell">                   ← Unit of Time (promptOption)
 *         <td data-automation-id="cell">                   ← Status (textView)
 *         <td data-automation-id="cell">                   ← View More (promptOption)
 *
 * Three cell widget types:
 *   - textView:  [data-automation-id="textView"] → .textContent
 *   - numericText: [data-automation-id="numericText"] → .textContent
 *   - promptOption: [data-automation-id="promptOption"] → data-automation-label attr
 */
const SELECTORS = {
  table: 'table[data-automation-id="table"]',
  dataRow: 'tbody tr[data-automation-id="row"]',
  textView: '[data-automation-id="textView"]',
  numericText: '[data-automation-id="numericText"]',
  promptOption: '[data-automation-id="promptOption"]',
} as const;

/**
 * Column indices within each data row (0-based).
 * Column 0 is a <th>, columns 1-6 are <td>.
 */
const COLUMNS = {
  DATE: 0,
  DAY_OF_WEEK: 1,
  TYPE: 2,
  REQUESTED: 3,
  UNIT_OF_TIME: 4,
  STATUS: 5,
} as const;

/**
 * Extracts text content from a cell based on its widget type.
 *
 * Workday uses three widget types in cells:
 * - textView: plain text (Date, Day of Week, Status)
 * - numericText: numeric value (Requested hours)
 * - promptOption: dropdown/moniker with data-automation-label (Type, Unit of Time)
 */
function extractCellText(cell: Element): string {
  // Try promptOption first (has data-automation-label attribute)
  const promptOption = cell.querySelector(SELECTORS.promptOption);
  if (promptOption) {
    return promptOption.getAttribute('data-automation-label')?.trim() ?? '';
  }

  // Try numericText
  const numericText = cell.querySelector(SELECTORS.numericText);
  if (numericText) {
    return numericText.textContent?.trim() ?? '';
  }

  // Fall back to textView
  const textView = cell.querySelector(SELECTORS.textView);
  if (textView) {
    return textView.textContent?.trim() ?? '';
  }

  // Last resort: direct text content
  return cell.textContent?.trim() ?? '';
}

/**
 * Parses a single table row into a TimeOffEntry.
 * Returns null if the row cannot be parsed (missing cells, invalid data).
 */
function parseRow(row: Element): TimeOffEntry | null {
  // Get all cells: first is <th> (date), rest are <td>
  const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'));

  if (cells.length < 6) {
    return null;
  }

  try {
    const date = extractCellText(cells[COLUMNS.DATE]);
    const dayOfWeek = extractCellText(cells[COLUMNS.DAY_OF_WEEK]);
    const type = extractCellText(cells[COLUMNS.TYPE]);
    const requestedStr = extractCellText(cells[COLUMNS.REQUESTED]);
    const unitOfTime = extractCellText(cells[COLUMNS.UNIT_OF_TIME]);
    const status = extractCellText(cells[COLUMNS.STATUS]);

    const requestedHours = parseFloat(requestedStr);
    if (isNaN(requestedHours)) {
      return null;
    }

    return createTimeOffEntry({
      date,
      dayOfWeek,
      type,
      requestedHours,
      unitOfTime,
      status,
    });
  } catch {
    return null;
  }
}

/**
 * Adapter: Scrapes time-off entries from the Workday "My Absence" page DOM.
 *
 * Expects the user to be on their Workday "My Absence" page.
 *
 * @param doc - The Document to scrape (defaults to window.document in content script context)
 */
export function createWorkdayDomScraper(doc: Document): TimeOffSource {
  return {
    async getEntries(): Promise<TimeOffEntry[]> {
      const table = doc.querySelector(SELECTORS.table);
      if (!table) {
        throw new Error(
          'Workday absence table not found. ' + 'Ensure you are on your Workday "My Absence" page.',
        );
      }

      const rows = table.querySelectorAll(SELECTORS.dataRow);
      if (rows.length === 0) {
        return [];
      }

      const entries: TimeOffEntry[] = [];
      for (const row of rows) {
        const entry = parseRow(row);
        if (entry !== null) {
          entries.push(entry);
        }
      }

      return entries;
    },
  };
}

// Export internals for testing
export { extractCellText, parseRow, SELECTORS, COLUMNS };
