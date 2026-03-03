import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import {
  createWorkdayDomScraper,
  extractCellText,
  parseRow,
  SELECTORS,
} from '../../../src/adapters/workday/dom-scraper';

/**
 * Loads the HTML fixture that replicates real Workday DOM structure.
 * Fixture was hand-crafted from Playwright-captured DOM (2026-03-03).
 */
function loadFixture(): Document {
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../fixtures/workday-absence-table.html'),
    'utf-8',
  );
  const dom = new JSDOM(html);
  return dom.window.document;
}

describe('WorkdayDomScraper', () => {
  let doc: Document;

  beforeEach(() => {
    doc = loadFixture();
  });

  describe('createWorkdayDomScraper', () => {
    it('extracts all entries from the fixture', async () => {
      const scraper = createWorkdayDomScraper(doc);
      const entries = await scraper.getEntries();

      expect(entries).toHaveLength(5);
    });

    it('parses the first row correctly (Submitted PTO)', async () => {
      const scraper = createWorkdayDomScraper(doc);
      const entries = await scraper.getEntries();

      expect(entries[0]).toEqual({
        date: '2026-03-13',
        dayOfWeek: 'Friday',
        type: 'Paid Time Off (PTO)',
        requestedHours: 8,
        unitOfTime: 'Hours',
        status: 'Submitted',
      });
    });

    it('parses an approved PTO entry', async () => {
      const scraper = createWorkdayDomScraper(doc);
      const entries = await scraper.getEntries();

      expect(entries[1]).toEqual({
        date: '2026-02-24',
        dayOfWeek: 'Tuesday',
        type: 'Paid Time Off (PTO)',
        requestedHours: 8,
        unitOfTime: 'Hours',
        status: 'Approved',
      });
    });

    it('parses a Floating Holiday entry', async () => {
      const scraper = createWorkdayDomScraper(doc);
      const entries = await scraper.getEntries();

      expect(entries[2]).toEqual({
        date: '2026-01-23',
        dayOfWeek: 'Friday',
        type: 'Floating Holiday',
        requestedHours: 8,
        unitOfTime: 'Hours',
        status: 'Approved',
      });
    });

    it('parses a half-day (4 hours) entry', async () => {
      const scraper = createWorkdayDomScraper(doc);
      const entries = await scraper.getEntries();

      expect(entries[3]).toEqual({
        date: '2025-10-01',
        dayOfWeek: 'Wednesday',
        type: 'Paid Time Off (PTO)',
        requestedHours: 4,
        unitOfTime: 'Hours',
        status: 'Approved',
      });
    });

    it('parses a cancellation (negative hours) entry', async () => {
      const scraper = createWorkdayDomScraper(doc);
      const entries = await scraper.getEntries();

      expect(entries[4]).toEqual({
        date: '2025-08-19',
        dayOfWeek: 'Tuesday',
        type: 'Paid Time Off (PTO)',
        requestedHours: -8,
        unitOfTime: 'Hours',
        status: 'Approved',
      });
    });

    it('throws when table is not found', async () => {
      const emptyDoc = new JSDOM('<div>No table here</div>').window.document;
      const scraper = createWorkdayDomScraper(emptyDoc);

      await expect(scraper.getEntries()).rejects.toThrow('Workday absence table not found');
    });

    it('returns empty array when table has no data rows', async () => {
      const emptyTable = new JSDOM(
        '<table data-automation-id="table"><thead></thead><tbody></tbody></table>',
      ).window.document;
      const scraper = createWorkdayDomScraper(emptyTable);

      const entries = await scraper.getEntries();
      expect(entries).toEqual([]);
    });

    it('converts dates from MM/DD/YYYY to ISO 8601 (YYYY-MM-DD)', async () => {
      const scraper = createWorkdayDomScraper(doc);
      const entries = await scraper.getEntries();

      // All dates should be in ISO format
      for (const entry of entries) {
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe('extractCellText', () => {
    it('extracts text from textView widget', () => {
      const cell = doc.querySelector('tr[data-automation-id="row"] th[role="rowheader"]')!;
      expect(extractCellText(cell)).toBe('03/13/2026');
    });

    it('extracts text from numericText widget', () => {
      const rows = doc.querySelectorAll('tr[data-automation-id="row"]');
      const requestedCell = rows[0].querySelectorAll(':scope > th, :scope > td')[3];
      expect(extractCellText(requestedCell)).toBe('8');
    });

    it('extracts label from promptOption widget', () => {
      const rows = doc.querySelectorAll('tr[data-automation-id="row"]');
      const typeCell = rows[0].querySelectorAll(':scope > th, :scope > td')[2];
      expect(extractCellText(typeCell)).toBe('Paid Time Off (PTO)');
    });

    it('extracts negative numericText', () => {
      const rows = doc.querySelectorAll('tr[data-automation-id="row"]');
      // Row 5 (index 4) has -8
      const requestedCell = rows[4].querySelectorAll(':scope > th, :scope > td')[3];
      expect(extractCellText(requestedCell)).toBe('-8');
    });
  });

  describe('parseRow', () => {
    it('returns null for a row with too few cells', () => {
      const badRow = new JSDOM(
        '<table><tr data-automation-id="row"><td>only one</td></tr></table>',
      ).window.document.querySelector('tr')!;
      expect(parseRow(badRow)).toBeNull();
    });

    it('returns null for a row with non-numeric requested hours', () => {
      // Create a row where numericText contains non-numeric text
      const html = `<table><tr data-automation-id="row">
        <th data-automation-id="cell"><div data-automation-id="textView">03/13/2026</div></th>
        <td data-automation-id="cell"><div data-automation-id="textView">Friday</div></td>
        <td data-automation-id="cell"><div data-automation-id="promptOption" data-automation-label="PTO">PTO</div></td>
        <td data-automation-id="cell"><div data-automation-id="numericText">abc</div></td>
        <td data-automation-id="cell"><div data-automation-id="promptOption" data-automation-label="Hours">Hours</div></td>
        <td data-automation-id="cell"><div data-automation-id="textView">Approved</div></td>
      </tr></table>`;
      const row = new JSDOM(html).window.document.querySelector('tr')!;
      expect(parseRow(row)).toBeNull();
    });

    it('parses a valid row', () => {
      const rows = doc.querySelectorAll(SELECTORS.table + ' ' + SELECTORS.dataRow);
      const entry = parseRow(rows[0]);

      expect(entry).not.toBeNull();
      expect(entry!.date).toBe('2026-03-13');
      expect(entry!.type).toBe('Paid Time Off (PTO)');
      expect(entry!.requestedHours).toBe(8);
      expect(entry!.status).toBe('Submitted');
    });
  });
});
