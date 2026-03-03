import { createWorkdayDomScraper } from '../adapters/workday/dom-scraper';

const ABSENCE_PAGE_TITLE = 'My Absence';

/**
 * Checks whether the current page is the Workday "My Absence" page
 * by looking for the page header title.
 */
function isAbsencePage(): boolean {
  const titleEl = document.querySelector('[data-automation-id="pageHeaderTitleText"]');
  return titleEl?.textContent?.trim()?.startsWith(ABSENCE_PAGE_TITLE) ?? false;
}

/**
 * Waits for the absence table to appear in the DOM.
 * Workday is a SPA and renders asynchronously after navigation.
 */
function waitForAbsenceTable(timeoutMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    // Check immediately
    if (isAbsencePage()) {
      resolve(true);
      return;
    }

    const startTime = Date.now();
    const observer = new MutationObserver(() => {
      if (isAbsencePage()) {
        observer.disconnect();
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        observer.disconnect();
        resolve(false);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Fallback timeout
    setTimeout(() => {
      observer.disconnect();
      resolve(isAbsencePage());
    }, timeoutMs);
  });
}

export default defineContentScript({
  matches: ['https://*.myworkday.com/*'],
  runAt: 'document_end',

  main() {
    console.log('[PTO Sync] Content script loaded on Workday page');

    browser.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
      if (message.type === 'SCRAPE_PTO') {
        handleScrape(sendResponse);
        return true; // async response
      }

      if (message.type === 'CHECK_PAGE_STATUS') {
        handlePageStatus(sendResponse);
        return true; // async response
      }
    });
  },
});

/**
 * Handles the SCRAPE_PTO message: waits for the table, then scrapes.
 */
async function handleScrape(sendResponse: (response: Record<string, unknown>) => void) {
  try {
    // Wait for the absence table to render
    const ready = await waitForAbsenceTable();
    if (!ready) {
      sendResponse({
        success: false,
        needsAuth: !isAbsencePage(),
        error: 'Absence table not found. The page may still be loading or requires SSO login.',
      });
      return;
    }

    const scraper = createWorkdayDomScraper(document);
    const entries = await scraper.getEntries();
    sendResponse({ success: true, entries });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse({ success: false, error: message });
  }
}

/**
 * Handles the CHECK_PAGE_STATUS message: reports whether we're on
 * the absence page or on an SSO/login page.
 */
async function handlePageStatus(sendResponse: (response: Record<string, unknown>) => void) {
  const onAbsencePage = isAbsencePage();
  const url = window.location.href;
  const isWorkdayDomain = url.includes('.myworkday.com/');

  sendResponse({
    onAbsencePage,
    isWorkdayDomain,
    url,
    // If we're not on the absence page and not on the Workday domain,
    // we've been redirected to SSO
    needsAuth: !onAbsencePage && !isWorkdayDomain,
  });
}
