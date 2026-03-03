export default defineBackground(() => {
  console.log('[PTO Sync] Background service worker started');

  // Listen for messages from the popup
  browser.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
    if (message.type === 'GET_AUTH_TOKEN') {
      // Use chrome.identity for Google OAuth
      // Note: chrome.identity is Chrome-specific; for Firefox we'd need
      // a different approach. WXT handles the browser API differences.
      if (typeof chrome !== 'undefined' && chrome.identity) {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              success: false,
              error: chrome.runtime.lastError.message,
            });
          } else {
            sendResponse({ success: true, token });
          }
        });
        return true;
      } else {
        sendResponse({
          success: false,
          error: 'chrome.identity not available (Firefox not yet supported)',
        });
      }
    }
  });
});
