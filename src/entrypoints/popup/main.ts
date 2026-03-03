import { createGoogleCalendarAdapter } from '../../adapters/google-calendar/api-client';
import { createChromeStorageAdapter } from '../../adapters/storage/chrome-storage';
import { createConsoleLogger } from '../../adapters/logging/console-logger';
import { createEventBus } from '../../domain/events/event-bus';
import { createSyncService } from '../../domain/services/sync-service';
import type { TimeOffSource } from '../../domain/ports/time-off-source';
import type { TimeOffEntry } from '../../domain/model/time-off-entry';
import type { DomainEvent } from '../../domain/events/domain-events';

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

// --- Create a TimeOffSource that messages the content script ---
function createContentScriptSource(): TimeOffSource {
  return {
    async getEntries(): Promise<TimeOffEntry[]> {
      // Find the active Workday tab
      const tabs = await browser.tabs.query({
        url: 'https://*.myworkday.com/*',
        active: false,
      });

      // Also check active tab
      const activeTabs = await browser.tabs.query({
        url: 'https://*.myworkday.com/*',
        active: true,
      });

      const allTabs = [...activeTabs, ...tabs];

      if (allTabs.length === 0) {
        throw new Error('No Workday tab found. Please open your Workday "My Absence" page first.');
      }

      const tabId = allTabs[0].id;
      if (tabId === undefined) {
        throw new Error('Cannot access Workday tab.');
      }

      const response = await browser.tabs.sendMessage(tabId, {
        type: 'SCRAPE_PTO',
      });

      if (!response || !response.success) {
        throw new Error(response?.error ?? 'Failed to scrape PTO data from Workday page.');
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
      timeOffSource: createContentScriptSource(),
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
