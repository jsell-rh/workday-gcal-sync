import { createGoogleCalendarAdapter, listCalendars } from '../adapters/google-calendar/api-client';
import { createMultiCalendarTarget } from '../adapters/google-calendar/multi-calendar';
import {
  createChromeStorageAdapter,
  createSettingsStore,
} from '../adapters/storage/chrome-storage';
import { createConsoleLogger } from '../adapters/logging/console-logger';
import { createEventBus } from '../domain/events/event-bus';
import { createSyncService } from '../domain/services/sync-service';
import { DEFAULT_SETTINGS, type SyncSettings } from '../domain/model/settings';
import type { TimeOffSource } from '../domain/ports/time-off-source';
import type { TimeOffEntry } from '../domain/model/time-off-entry';
import type { DomainEvent } from '../domain/events/domain-events';
import type { SyncResult } from '../domain/model/sync-result';
import type { SyncPreview } from '../domain/model/sync-preview';

const settingsStore = createSettingsStore();

// --- Sync state ---

interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'success';
}

interface SyncProgress {
  current: number;
  total: number;
}

interface SyncState {
  status: 'idle' | 'previewing' | 'syncing' | 'awaiting-sso' | 'completed' | 'failed';
  log: LogEntry[];
  lastResult: SyncResult | null;
  error: string | null;
  progress: SyncProgress | null;
  preview: SyncPreview | null;
}

let syncState: SyncState = {
  status: 'idle',
  log: [],
  lastResult: null,
  error: null,
  progress: null,
  preview: null,
};

function appendLog(message: string, level: LogEntry['level'] = 'info') {
  syncState.log.push({
    timestamp: new Date().toLocaleTimeString(),
    message,
    level,
  });
}

function humanizeSkipReason(reason: string): string {
  if (/already synced.*local state/i.test(reason)) return 'already on calendar';
  if (/already exists in calendar/i.test(reason)) return 'already on calendar';
  return reason;
}

// --- Tab helpers ---

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

type PageWaitResult = 'ready' | 'needs-sso' | 'timeout';

async function waitForAbsencePage(
  tabId: number,
  options?: {
    timeoutMs?: number;
    redirectGraceMs?: number;
    pollIntervalMs?: number;
  },
): Promise<PageWaitResult> {
  const timeoutMs = options?.timeoutMs ?? 30000;
  const redirectGraceMs = options?.redirectGraceMs ?? 10000;
  const pollIntervalMs = options?.pollIntervalMs ?? 500;

  const startTime = Date.now();
  let offWorkdaySince: number | null = null;

  while (Date.now() - startTime < timeoutMs) {
    // Check the tab URL directly — no content script needed
    let tabUrl: string | undefined;
    try {
      const tab = await browser.tabs.get(tabId);
      tabUrl = tab.url;
    } catch {
      // Tab may have been closed
      return 'timeout';
    }

    const onWorkday = tabUrl != null && tabUrl.includes('.myworkday.com/');

    if (onWorkday) {
      // Back on Workday — reset the redirect timer
      offWorkdaySince = null;

      // Try asking the content script if we're on the absence page
      try {
        const response = await browser.tabs.sendMessage(tabId, {
          type: 'CHECK_PAGE_STATUS',
        });

        if (response?.onAbsencePage) {
          return 'ready';
        }
      } catch {
        // Content script not ready yet — page still loading/rendering
      }
    } else {
      // Off Workday — likely an SSO redirect
      if (offWorkdaySince === null) {
        offWorkdaySince = Date.now();
      } else if (Date.now() - offWorkdaySince >= redirectGraceMs) {
        // Been off Workday for the entire grace period — SSO login needed
        return 'needs-sso';
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return 'timeout';
}

// --- TimeOffSource that manages tabs from the background ---

function createAutoTimeOffSource(workdayAbsenceUrl: string): TimeOffSource {
  return {
    async getEntries(): Promise<TimeOffEntry[]> {
      const existingTabs = await browser.tabs.query({
        url: 'https://*.myworkday.com/*',
      });

      let tabId: number | undefined;
      let createdTab = false;

      if (existingTabs.length > 0) {
        tabId = existingTabs[0].id;
        appendLog('Found existing Workday tab');

        const tab = existingTabs[0];
        if (tab.url && !tab.url.includes('2997$276')) {
          appendLog('Navigating to My Absence page...');
          await browser.tabs.update(tabId!, { url: workdayAbsenceUrl });
          await waitForTabLoad(tabId!);
        }
      } else {
        appendLog('Opening Workday in background...');
        const tab = await browser.tabs.create({
          url: workdayAbsenceUrl,
          active: false,
        });
        tabId = tab.id;
        createdTab = true;
        await waitForTabLoad(tabId!);
      }

      if (tabId === undefined) {
        throw new Error('Failed to create Workday tab');
      }

      appendLog('Waiting for absence page to load...');
      const result = await waitForAbsencePage(tabId);

      if (result === 'ready') {
        // Good — proceed to scrape
      } else if (result === 'needs-sso') {
        syncState.status = 'awaiting-sso';
        appendLog('Sign-in required. Opening Workday for you to log in...', 'info');
        await browser.tabs.update(tabId, { active: true });

        // Now wait for the user to complete SSO (long timeout)
        const ssoResult = await waitForAbsencePage(tabId, {
          timeoutMs: 120000,
          redirectGraceMs: 120000, // Don't declare SSO needed again, we already know
        });

        if (ssoResult !== 'ready') {
          throw new Error('Timed out waiting for Workday sign-in. Please try again.');
        }

        appendLog('Sign-in complete!', 'success');
        syncState.status = 'syncing';

        if (createdTab) {
          await browser.tabs.update(tabId, { active: false });
        }
      } else {
        throw new Error('Workday took too long to load. Please try again.');
      }

      appendLog('Reading PTO entries from Workday...');
      const response = await browser.tabs.sendMessage(tabId, {
        type: 'SCRAPE_PTO',
      });

      if (createdTab) {
        await browser.tabs.remove(tabId);
      }

      if (!response || !response.success) {
        throw new Error(response?.error ?? 'Could not read PTO data from Workday.');
      }

      return response.entries;
    },
  };
}

// --- Google OAuth ---

function getAuthToken(): Promise<string> {
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

// --- Run preview ---

async function runPreview() {
  if (
    syncState.status === 'syncing' ||
    syncState.status === 'awaiting-sso' ||
    syncState.status === 'previewing'
  ) {
    return;
  }

  syncState = {
    status: 'previewing',
    log: [],
    lastResult: syncState.lastResult, // preserve last result
    error: null,
    progress: null,
    preview: null,
  };

  appendLog('Checking Workday for PTO entries...');

  try {
    const settings: SyncSettings = await settingsStore.getSettings();
    const storage = createChromeStorageAdapter();

    const calendarIds =
      settings.calendarIds && settings.calendarIds.length > 0
        ? settings.calendarIds
        : DEFAULT_SETTINGS.calendarIds;

    let calendarTarget;
    if (calendarIds.length === 1) {
      calendarTarget = createGoogleCalendarAdapter(getAuthToken, {
        calendarId: calendarIds[0],
      });
    } else {
      const targets = calendarIds.map((id) =>
        createGoogleCalendarAdapter(getAuthToken, { calendarId: id }),
      );
      calendarTarget = createMultiCalendarTarget(targets);
    }

    const service = createSyncService({
      timeOffSource: createAutoTimeOffSource(
        settings.workdayAbsenceUrl || DEFAULT_SETTINGS.workdayAbsenceUrl,
      ),
      calendarTarget,
      syncStateStore: storage,
      logger: createConsoleLogger(),
      eventBus: createEventBus(),
      settings,
    });

    appendLog('Scraping PTO entries and checking calendar...');
    const preview = await service.preview();
    syncState.preview = preview;
    syncState.status = 'idle';

    const creates = preview.entries.filter((e) => e.action === 'create').length;
    const skips = preview.entries.filter((e) => e.action === 'skip').length;
    const deletes = preview.entries.filter((e) => e.action === 'delete').length;
    const resyncs = preview.entries.filter((e) => e.action === 'resync').length;

    const parts: string[] = [];
    if (creates > 0) parts.push(`${creates} new`);
    if (skips > 0) parts.push(`${skips} already synced`);
    if (deletes > 0) parts.push(`${deletes} to remove`);
    if (resyncs > 0) parts.push(`${resyncs} to re-create`);

    appendLog(
      `Preview ready: ${preview.entries.length} entries found (${parts.join(', ')})`,
      'success',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    syncState.status = 'failed';
    syncState.error = message;
    appendLog(message, 'error');
  }
}

// --- Run sync ---

async function runSync() {
  if (syncState.status === 'syncing' || syncState.status === 'awaiting-sso') {
    return; // Already in progress
  }

  syncState = {
    status: 'syncing',
    log: [],
    lastResult: null,
    error: null,
    progress: null,
    preview: syncState.preview, // preserve preview
  };

  appendLog('Starting sync...');

  try {
    // Load settings before syncing
    const settings: SyncSettings = await settingsStore.getSettings();

    const eventBus = createEventBus();

    eventBus.subscribe((event: DomainEvent) => {
      switch (event.type) {
        case 'EntriesParsed':
          appendLog(`Found ${event.syncableCount} PTO entries to process`);
          syncState.progress = { current: 0, total: event.syncableCount };
          break;
        case 'EntryProcessing':
          syncState.progress = { current: event.index, total: event.total };
          appendLog(`Processing ${event.date} (${event.entryType})`);
          break;
        case 'EntrySkipped':
          appendLog(`Skipped: ${event.date} - ${humanizeSkipReason(event.reason)}`);
          break;
        case 'EntryFailed':
          appendLog(`Error: ${event.date} - ${event.error}`, 'error');
          break;
        case 'CalendarEventCreated':
          appendLog(`Created: ${event.summary} (${event.date})`, 'success');
          break;
        case 'EntryResynced':
          appendLog(`Re-synced: ${event.date} (${event.reason})`, 'info');
          break;
        case 'CalendarEventAlreadyExists':
          appendLog(`${event.date} - already on calendar`);
          break;
        case 'SyncCompleted':
          appendLog(
            `Done! ${event.entriesSynced} synced, ${event.entriesSkipped} already on calendar`,
            'success',
          );
          break;
        case 'SyncFailed':
          appendLog(`Sync failed: ${event.error}`, 'error');
          break;
      }
    });

    const storage = createChromeStorageAdapter();

    // Create calendar target(s) — supports multiple calendars
    const calendarIds =
      settings.calendarIds && settings.calendarIds.length > 0
        ? settings.calendarIds
        : DEFAULT_SETTINGS.calendarIds;

    let calendarTarget;
    if (calendarIds.length === 1) {
      calendarTarget = createGoogleCalendarAdapter(getAuthToken, {
        calendarId: calendarIds[0],
      });
    } else {
      const targets = calendarIds.map((id) =>
        createGoogleCalendarAdapter(getAuthToken, { calendarId: id }),
      );
      calendarTarget = createMultiCalendarTarget(targets);
    }

    const service = createSyncService({
      timeOffSource: createAutoTimeOffSource(
        settings.workdayAbsenceUrl || DEFAULT_SETTINGS.workdayAbsenceUrl,
      ),
      calendarTarget,
      syncStateStore: storage,
      logger: createConsoleLogger(),
      eventBus,
      settings,
    });

    await service.sync();

    const result = await storage.getLastSyncResult();
    syncState.status = 'completed';
    syncState.lastResult = result;
    syncState.preview = null; // clear preview after successful sync

    if (result && result.errors.length > 0) {
      appendLog(
        `${result.errors.length} ${result.errors.length === 1 ? 'entry' : 'entries'} could not be synced:`,
        'error',
      );
      for (const err of result.errors) {
        appendLog(`  ${err.entryDate}: ${err.message}`, 'error');
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    syncState.status = 'failed';
    syncState.error = message;
    appendLog(message, 'error');
  }
}

// --- Message handler ---

export default defineBackground(() => {
  console.log('[PTO Sync] Background service worker started');

  // Open side panel when clicking the extension icon
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  browser.runtime.onMessage.addListener(
    (message: { type: string; settings?: SyncSettings; date?: string }, _sender, sendResponse) => {
      if (message.type === 'START_SYNC') {
        runSync().then(() => {
          // Sync finished (state already updated)
        });
        sendResponse({ started: true });
        return false;
      }

      if (message.type === 'PREVIEW_SYNC') {
        runPreview().then(() => {
          // Preview finished (state already updated)
        });
        sendResponse({ started: true });
        return false;
      }

      if (message.type === 'GET_SYNC_STATUS') {
        sendResponse({
          status: syncState.status,
          log: syncState.log,
          lastResult: syncState.lastResult,
          error: syncState.error,
          progress: syncState.progress,
          preview: syncState.preview,
        });
        return false;
      }

      if (message.type === 'GET_SYNCED_EVENTS') {
        const storage = createChromeStorageAdapter();
        storage
          .getAllSyncedEntries()
          .then((entries) => sendResponse({ success: true, entries }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'UNSYNC_EVENT') {
        if (!message.date) {
          sendResponse({ success: false, error: 'No date provided' });
          return false;
        }
        const storage = createChromeStorageAdapter();
        const calendarIds = DEFAULT_SETTINGS.calendarIds;
        (async () => {
          try {
            const settings: SyncSettings = await settingsStore.getSettings();
            const ids =
              settings.calendarIds && settings.calendarIds.length > 0
                ? settings.calendarIds
                : calendarIds;

            const eventId = await storage.getEventId(message.date!);
            if (eventId && eventId !== 'existing') {
              // Delete from all target calendars
              for (const calId of ids) {
                try {
                  const target = createGoogleCalendarAdapter(getAuthToken, {
                    calendarId: calId,
                  });
                  await target.deleteEvent(eventId);
                } catch {
                  // Event may not exist on this calendar — that's ok
                }
              }
            }
            await storage.removeSynced(message.date!);
            sendResponse({ success: true });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendResponse({ success: false, error: errMsg });
          }
        })();
        return true;
      }

      if (message.type === 'UNSYNC_ALL') {
        const storage = createChromeStorageAdapter();
        (async () => {
          try {
            const settings: SyncSettings = await settingsStore.getSettings();
            const ids =
              settings.calendarIds && settings.calendarIds.length > 0
                ? settings.calendarIds
                : DEFAULT_SETTINGS.calendarIds;

            const entries = await storage.getAllSyncedEntries();
            for (const entry of entries) {
              if (entry.eventId && entry.eventId !== 'existing') {
                for (const calId of ids) {
                  try {
                    const target = createGoogleCalendarAdapter(getAuthToken, {
                      calendarId: calId,
                    });
                    await target.deleteEvent(entry.eventId);
                  } catch {
                    // Event may not exist on this calendar
                  }
                }
              }
              await storage.removeSynced(entry.date);
            }
            sendResponse({ success: true, removed: entries.length });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendResponse({ success: false, error: errMsg });
          }
        })();
        return true;
      }

      if (message.type === 'GET_SETTINGS') {
        settingsStore
          .getSettings()
          .then((settings) => sendResponse({ success: true, settings }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'SAVE_SETTINGS') {
        if (!message.settings) {
          sendResponse({ success: false, error: 'No settings provided' });
          return false;
        }
        settingsStore
          .saveSettings(message.settings)
          .then(() => sendResponse({ success: true }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'LIST_CALENDARS') {
        listCalendars(getAuthToken)
          .then((calendars) => sendResponse({ success: true, calendars }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      // Legacy: still support GET_AUTH_TOKEN for any other callers
      if (message.type === 'GET_AUTH_TOKEN') {
        getAuthToken()
          .then((token) => sendResponse({ success: true, token }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }
    },
  );
});
