import { createGoogleCalendarAdapter } from '../../adapters/google-calendar/api-client';
import { createChromeStorageAdapter } from '../../adapters/storage/chrome-storage';
import { createConsoleLogger } from '../../adapters/logging/console-logger';
import { createEventBus } from '../../domain/events/event-bus';
import { createSyncService } from '../../domain/services/sync-service';
import type { TimeOffSource } from '../../domain/ports/time-off-source';
import type { TimeOffEntry } from '../../domain/model/time-off-entry';
import type { DomainEvent } from '../../domain/events/domain-events';

const WORKDAY_ABSENCE_URL = 'https://wd5.myworkday.com/redhat/d/task/2997$276.htmld';

// --- DOM elements ---
const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
const lastSyncValue = document.getElementById('last-sync-value')!;
const syncStats = document.getElementById('sync-stats')!;
const statFound = document.getElementById('stat-found')!;
const statSynced = document.getElementById('stat-synced')!;
const statSkipped = document.getElementById('stat-skipped')!;
const logArea = document.getElementById('log-area')!;

// --- Logging to popup ---
function addLog(message: string, level: 'info' | 'error' | 'success' = 'info') {
  logArea.classList.remove('hidden');
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  logArea.appendChild(entry);
  logArea.scrollTop = logArea.scrollHeight;
}

// --- Load last sync state ---
async function loadLastSync() {
  const store = createChromeStorageAdapter();
  const result = await store.getLastSyncResult();
  if (result) {
    const date = new Date(result.syncedAt);
    lastSyncValue.textContent = date.toLocaleString();
    lastSyncValue.className = 'status-value success';
    syncStats.classList.remove('hidden');
    statFound.textContent = String(result.entriesFound);
    statSynced.textContent = String(result.entriesSynced);
    statSkipped.textContent = String(result.entriesSkipped);
  }
}

/**
 * Waits for a tab to finish loading (status === 'complete').
 */
function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    browser.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Waits for the content script to report that the absence page is ready.
 * Polls the content script periodically since Workday renders asynchronously.
 */
async function waitForAbsencePage(tabId: number, timeoutMs = 20000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await browser.tabs.sendMessage(tabId, {
        type: 'CHECK_PAGE_STATUS',
      });

      if (response?.onAbsencePage) {
        return true;
      }

      // If we're not on the Workday domain at all, SSO redirect happened
      if (response && !response.isWorkdayDomain) {
        return false;
      }
    } catch {
      // Content script not ready yet — tab may still be loading
    }

    // Wait before polling again
    await new Promise((r) => setTimeout(r, 1000));
  }

  return false;
}

/**
 * Creates a TimeOffSource that handles the full tab lifecycle:
 * 1. Opens Workday in a background tab
 * 2. If SSO is needed, brings the tab to the foreground for login
 * 3. After login, scrapes the absence data
 * 4. Closes the tab when done
 */
function createAutoTimeOffSource(
  onLog: (msg: string, level?: 'info' | 'error' | 'success') => void,
): TimeOffSource {
  return {
    async getEntries(): Promise<TimeOffEntry[]> {
      // First check if a Workday tab is already open on the absence page
      const existingTabs = await browser.tabs.query({
        url: 'https://*.myworkday.com/*',
      });

      let tabId: number | undefined;
      let createdTab = false;

      if (existingTabs.length > 0) {
        tabId = existingTabs[0].id;
        onLog('Found existing Workday tab');

        // Navigate it to the absence page if needed
        const tab = existingTabs[0];
        if (tab.url && !tab.url.includes('2997$276')) {
          onLog('Navigating to My Absence page...');
          await browser.tabs.update(tabId!, { url: WORKDAY_ABSENCE_URL });
          await waitForTabLoad(tabId!);
        }
      } else {
        // Open Workday in a background tab
        onLog('Opening Workday in background...');
        const tab = await browser.tabs.create({
          url: WORKDAY_ABSENCE_URL,
          active: false,
        });
        tabId = tab.id;
        createdTab = true;
        await waitForTabLoad(tabId!);
      }

      if (tabId === undefined) {
        throw new Error('Failed to create Workday tab');
      }

      // Wait for the absence page to be ready
      onLog('Waiting for absence page to load...');
      let pageReady = await waitForAbsencePage(tabId);

      if (!pageReady) {
        // SSO login needed — bring the tab to the foreground
        onLog('SSO login required. Opening tab for you to sign in...', 'info');
        await browser.tabs.update(tabId, { active: true });

        // Wait longer for the user to complete SSO login
        // After SSO, Workday should redirect back to the absence page
        pageReady = await waitForAbsencePage(tabId, 120000); // 2 minute timeout

        if (!pageReady) {
          throw new Error(
            'Timed out waiting for SSO login. Please sign into Workday and try again.',
          );
        }

        onLog('SSO login complete!', 'success');

        // Move tab back to background if we created it
        if (createdTab) {
          await browser.tabs.update(tabId, { active: false });
        }
      }

      // Scrape the absence data
      onLog('Scraping PTO entries...');
      const response = await browser.tabs.sendMessage(tabId, {
        type: 'SCRAPE_PTO',
      });

      // Close the tab if we created it
      if (createdTab) {
        await browser.tabs.remove(tabId);
      }

      if (!response || !response.success) {
        throw new Error(response?.error ?? 'Failed to scrape PTO data from Workday.');
      }

      return response.entries;
    },
  };
}

// --- Get Google auth token ---
async function getAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof chrome !== 'undefined' && chrome.identity) {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? 'Auth failed'));
        } else if (token) {
          resolve(token);
        } else {
          reject(new Error('No auth token received'));
        }
      });
    } else {
      reject(new Error('Google OAuth not available. Chrome required for now.'));
    }
  });
}

// --- Sync handler ---
syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';
  logArea.innerHTML = '';
  logArea.classList.remove('hidden');

  try {
    addLog('Starting sync...');

    const eventBus = createEventBus();

    // Subscribe to domain events for live logging
    eventBus.subscribe((event: DomainEvent) => {
      switch (event.type) {
        case 'EntriesParsed':
          addLog(`Found ${event.count} entries (${event.syncableCount} syncable)`);
          break;
        case 'CalendarEventCreated':
          addLog(`Created: ${event.summary} (${event.date})`, 'success');
          break;
        case 'CalendarEventAlreadyExists':
          addLog(`Skipped: ${event.date} (already exists)`);
          break;
        case 'SyncCompleted':
          addLog(`Done! ${event.entriesSynced} synced, ${event.entriesSkipped} skipped`, 'success');
          break;
        case 'SyncFailed':
          addLog(`Failed: ${event.error}`, 'error');
          break;
      }
    });

    const service = createSyncService({
      timeOffSource: createAutoTimeOffSource(addLog),
      calendarTarget: createGoogleCalendarAdapter(getAuthToken),
      syncStateStore: createChromeStorageAdapter(),
      logger: createConsoleLogger(),
      eventBus,
    });

    await service.sync();
    await loadLastSync();

    lastSyncValue.textContent = new Date().toLocaleString();
    lastSyncValue.className = 'status-value success';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addLog(message, 'error');
    lastSyncValue.textContent = 'Failed';
    lastSyncValue.className = 'status-value error';
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync PTO Now';
  }
});

// Load state on popup open
loadLastSync();
