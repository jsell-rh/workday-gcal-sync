import { test } from './fixtures';
import fs from 'fs';
import path from 'path';

/**
 * Deep DOM Research Harness
 *
 * Captures detailed table/grid structures from Workday absence pages.
 * Run after navigating to the "My Time Off" or "My Absence" page.
 *
 * Run with: npx playwright test workday-deep-research --headed
 */
test('deep capture workday table structures', async ({ context }) => {
  const page = await context.newPage();

  // Navigate directly to the "My Absence" page
  await page.goto('https://wd5.myworkday.com/redhat/d/task/2997$276.htmld');

  // Pause - log in via SSO. After login, Workday should show the
  // "My Absence" page with the absence requests table.
  // Once the table is visible, resume the test.
  await page.pause();

  const snapshotsDir = path.resolve(__dirname, '../../tests/snapshots');
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }

  // Capture full page HTML
  const html = await page.content();
  fs.writeFileSync(path.join(snapshotsDir, 'workday-timeoff-full.html'), html, 'utf-8');

  // Extract table/grid structures
  const gridData = await page.evaluate(() => {
    const results: Record<string, unknown> = {};

    // Find all grid/table containers
    const grids = document.querySelectorAll(
      '[data-automation-id*="grid"], [data-automation-id*="table"], [data-automation-id*="Grid"], [data-automation-id*="Table"], table',
    );

    results.gridCount = grids.length;
    results.grids = Array.from(grids).map((grid, i) => {
      const headers = Array.from(grid.querySelectorAll('th, [role="columnheader"]')).map((th) => ({
        text: th.textContent?.trim() || '',
        automationId: th.getAttribute('data-automation-id') || '',
        role: th.getAttribute('role') || '',
      }));

      const rows = Array.from(grid.querySelectorAll('tr, [role="row"]'))
        .slice(0, 10)
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
          return cells.map((cell) => ({
            text: cell.textContent?.trim().substring(0, 200) || '',
            automationId: cell.getAttribute('data-automation-id') || '',
          }));
        });

      return {
        index: i,
        tag: grid.tagName.toLowerCase(),
        automationId: grid.getAttribute('data-automation-id') || '',
        classes: Array.from(grid.classList),
        role: grid.getAttribute('role') || '',
        headerCount: headers.length,
        headers,
        rowCount: rows.length,
        sampleRows: rows,
        outerHTMLLength: grid.outerHTML.length,
      };
    });

    // Also find any elements that might be calendar views
    const calendarElements = document.querySelectorAll(
      '[data-automation-id*="calendar"], [data-automation-id*="Calendar"], [data-automation-id*="absence"], [data-automation-id*="Absence"], [data-automation-id*="timeOff"], [data-automation-id*="TimeOff"]',
    );

    results.calendarElements = Array.from(calendarElements).map((el) => ({
      tag: el.tagName.toLowerCase(),
      automationId: el.getAttribute('data-automation-id') || '',
      classes: Array.from(el.classList),
      text: el.textContent?.trim().substring(0, 200) || '',
    }));

    // Find the page title
    const titleEl = document.querySelector('[data-automation-id="pageHeaderTitleText"]');
    results.pageTitle = titleEl?.textContent?.trim() || 'NOT FOUND';

    return results;
  });

  fs.writeFileSync(
    path.join(snapshotsDir, 'workday-grid-structures.json'),
    JSON.stringify(gridData, null, 2),
    'utf-8',
  );

  console.log('Page title:', gridData.pageTitle);
  console.log('Grids found:', gridData.gridCount);
  console.log('Deep research snapshots saved to tests/snapshots/');
});
