import { test } from './fixtures';
import fs from 'fs';
import path from 'path';

/**
 * DOM Research Harness
 *
 * This test navigates to Workday and pauses for SSO login,
 * then captures the DOM structure of absence/time-off pages
 * for analysis.
 *
 * Run with: npx playwright test workday-research --headed
 */
test('capture workday absence page DOM', async ({ context }) => {
  const page = await context.newPage();

  // Navigate to Workday "My Absence" page directly
  await page.goto('https://wd5.myworkday.com/redhat/d/task/2997$276.htmld');

  // Pause for manual SSO login
  // The tester logs in manually. After login, Workday should redirect
  // to the "My Absence" page. Once you see the absence table, resume.
  await page.pause();

  // Capture the full page HTML
  const html = await page.content();
  const snapshotsDir = path.resolve(__dirname, '../../tests/snapshots');
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(snapshotsDir, 'workday-absence-page.html'), html, 'utf-8');

  // Dump all elements with data-automation-id attributes
  const automationIds = await page.evaluate(() => {
    const elements = document.querySelectorAll('[data-automation-id]');
    return Array.from(elements).map((el) => ({
      tag: el.tagName.toLowerCase(),
      automationId: el.getAttribute('data-automation-id'),
      text: el.textContent?.trim().substring(0, 100) || '',
      classList: Array.from(el.classList),
    }));
  });

  fs.writeFileSync(
    path.join(snapshotsDir, 'workday-automation-ids.json'),
    JSON.stringify(automationIds, null, 2),
    'utf-8',
  );

  console.log(`Captured ${automationIds.length} elements with data-automation-id`);
  console.log('Snapshots saved to tests/snapshots/');
});
