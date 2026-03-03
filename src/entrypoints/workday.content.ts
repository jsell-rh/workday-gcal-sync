import { createWorkdayDomScraper } from '../adapters/workday/dom-scraper';

export default defineContentScript({
  matches: ['https://*.myworkday.com/*'],
  runAt: 'document_end',

  main() {
    console.log('[PTO Sync] Content script loaded on Workday page');

    // Listen for messages from the popup/background
    browser.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
      if (message.type === 'SCRAPE_PTO') {
        const scraper = createWorkdayDomScraper(document);
        scraper
          .getEntries()
          .then((entries) => {
            sendResponse({ success: true, entries });
          })
          .catch((error: Error) => {
            sendResponse({ success: false, error: error.message });
          });
        // Return true to indicate async response
        return true;
      }
    });
  },
});
