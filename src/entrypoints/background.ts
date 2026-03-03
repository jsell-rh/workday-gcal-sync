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

/** Human-readable phase for UI display during sync */
type SyncPhase =
  | 'connecting'
  | 'reading-pto'
  | 'awaiting-sso'
  | 'checking-calendar'
  | 'adding-events'
  | 'done'
  | 'error';

interface SyncState {
  status: 'idle' | 'previewing' | 'syncing' | 'awaiting-sso' | 'completed' | 'failed';
  log: LogEntry[];
  lastResult: SyncResult | null;
  error: string | null;
  progress: SyncProgress | null;
  preview: SyncPreview | null;
  phase: SyncPhase | null;
  phaseMessage: string | null;
}

let syncState: SyncState = {
  status: 'idle',
  log: [],
  lastResult: null,
  error: null,
  progress: null,
  preview: null,
  phase: null,
  phaseMessage: null,
};

function appendLog(message: string, level: LogEntry['level'] = 'info') {
  syncState.log.push({
    timestamp: new Date().toLocaleTimeString(),
    message,
    level,
  });
}

function setPhase(phase: SyncPhase, message: string) {
  syncState.phase = phase;
  syncState.phaseMessage = message;
}

function humanizeSkipReason(reason: string): string {
  if (/already synced.*local state/i.test(reason)) return 'already on calendar';
  if (/already exists in calendar/i.test(reason)) return 'already on calendar';
  return reason;
}

// --- Activity history ---

interface ActivityEntry {
  date: string; // ISO datetime
  summary: string;
  eventsAdded: number;
  eventsSkipped: number;
  errors: number;
}

const ACTIVITY_STORAGE_KEY = 'pto-sync:activity-history';
const MAX_ACTIVITY_ENTRIES = 10;

async function saveActivityEntry(result: SyncResult): Promise<void> {
  try {
    const stored = await browser.storage.local.get(ACTIVITY_STORAGE_KEY);
    const history: ActivityEntry[] = stored[ACTIVITY_STORAGE_KEY] ?? [];

    // Build summary
    const parts: string[] = [];
    if (result.entriesSynced > 0) {
      parts.push(`${result.entriesSynced} event${result.entriesSynced === 1 ? '' : 's'} added`);
    }
    if (result.entriesResynced > 0) {
      parts.push(
        `${result.entriesResynced} event${result.entriesResynced === 1 ? '' : 's'} re-added`,
      );
    }
    if (result.errors.length > 0) {
      parts.push(`${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`);
    }
    if (parts.length === 0) {
      parts.push('Everything up to date');
    }

    history.unshift({
      date: result.syncedAt,
      summary: parts.join(', '),
      eventsAdded: result.entriesSynced + (result.entriesResynced ?? 0),
      eventsSkipped: result.entriesSkipped,
      errors: result.errors.length,
    });

    // Keep only the last N entries
    const trimmed = history.slice(0, MAX_ACTIVITY_ENTRIES);
    await browser.storage.local.set({ [ACTIVITY_STORAGE_KEY]: trimmed });
  } catch {
    // Non-critical: don't let activity storage break sync
  }
}

async function getActivityHistory(): Promise<ActivityEntry[]> {
  try {
    const stored = await browser.storage.local.get(ACTIVITY_STORAGE_KEY);
    return stored[ACTIVITY_STORAGE_KEY] ?? [];
  } catch {
    return [];
  }
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
      let tabId: number | undefined;
      let createdTab = false;

      try {
        const existingTabs = await browser.tabs.query({
          url: 'https://*.myworkday.com/*',
        });

        if (existingTabs.length > 0) {
          tabId = existingTabs[0].id;
          appendLog('Found existing Workday tab');

          const tab = existingTabs[0];
          if (tab.url && tab.url !== workdayAbsenceUrl) {
            appendLog('Navigating to My Absence page...');
            setPhase('connecting', 'Connecting to Workday...');
            await browser.tabs.update(tabId!, { url: workdayAbsenceUrl });
            await waitForTabLoad(tabId!);
          }
        } else {
          appendLog('Opening Workday in background...');
          setPhase('connecting', 'Connecting to Workday...');
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
          setPhase('awaiting-sso', 'Please sign in to Workday to continue');
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

        setPhase('reading-pto', 'Reading your PTO entries...');
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
      } catch (error) {
        // Clean up tab on error
        if (createdTab && tabId !== undefined) {
          try {
            await browser.tabs.remove(tabId);
          } catch {
            /* ignore */
          }
        }
        throw error;
      }
    },
  };
}

// --- Google OAuth ---

/** Detect whether we're running in Chrome (has chrome.identity.getAuthToken) */
function isChromeIdentityAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.identity !== 'undefined' &&
    typeof chrome.identity.getAuthToken === 'function'
  );
}

/** Chrome path: use the built-in getAuthToken API */
function getAuthTokenChrome(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Auth failed'));
      } else if (token) {
        closeOAuthTabs();
        resolve(token);
      } else {
        reject(new Error('No auth token received'));
      }
    });
  });
}

/**
 * Firefox path: use browser.identity.launchWebAuthFlow.
 *
 * Firefox requires a separate "Web application" OAuth client in Google Cloud
 * Console (Chrome Extension type doesn't allow redirect URIs). The redirect
 * URL from `browser.identity.getRedirectURL()` must be added as an authorized
 * redirect URI in that Web application client.
 *
 * The access token comes back in the URL hash fragment (implicit grant).
 */

// Firefox uses a separate "Web application" OAuth client.
// TODO: Replace with your Web Application OAuth client ID from Google Cloud Console.
const FIREFOX_OAUTH_CLIENT_ID =
  '5968968327-us9dghstv519tdgr47cre3fj1k02l7rg.apps.googleusercontent.com';

async function getAuthTokenFirefox(interactive: boolean): Promise<string> {
  const redirectUrl = browser.identity.getRedirectURL();
  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ].join(' ');

  // Log the redirect URL for debugging
  console.info('[PTO Sync] Firefox OAuth redirect URL:', redirectUrl);

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(FIREFOX_OAUTH_CLIENT_ID)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
    `&scope=${encodeURIComponent(scopes)}`;

  try {
    const responseUrl = await browser.identity.launchWebAuthFlow({
      url: authUrl,
      interactive,
    });

    // Parse the access token from the redirect URL's hash fragment
    const url = new URL(responseUrl);
    const params = new URLSearchParams(url.hash.substring(1));
    const token = params.get('access_token');
    if (!token) {
      throw new Error('No access token found in OAuth response');
    }
    return token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/redirect_uri_mismatch|invalid/i.test(message)) {
      throw new Error(
        `Google OAuth redirect URI mismatch. Add this URL as an authorized redirect URI ` +
          `in your Web Application OAuth client: ${redirectUrl}`,
      );
    }
    throw error;
  }
}

function getAuthToken(): Promise<string> {
  if (isChromeIdentityAvailable()) {
    return getAuthTokenChrome(true);
  }
  return getAuthTokenFirefox(true);
}

/**
 * Chrome sometimes leaves Google sign-in/consent tabs open after
 * `getAuthToken` completes. Find and close them.
 */
function closeOAuthTabs() {
  browser.tabs
    .query({ url: ['https://accounts.google.com/*', 'https://accounts.google.com/o/oauth2/*'] })
    .then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          browser.tabs.remove(tab.id).catch(() => {
            // Tab may already be closed
          });
        }
      }
    })
    .catch(() => {
      // Non-critical — don't let cleanup break the auth flow
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
    phase: 'connecting',
    phaseMessage: 'Connecting to Workday...',
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

    setPhase('checking-calendar', 'Checking your calendar...');
    appendLog('Scraping PTO entries and checking calendar...');
    const preview = await service.preview();
    syncState.preview = preview;
    syncState.status = 'idle';
    syncState.phase = 'done';
    syncState.phaseMessage = null;

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
    syncState.phase = 'error';
    syncState.phaseMessage = null;
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
    phase: 'connecting',
    phaseMessage: 'Connecting to Workday...',
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
          setPhase('checking-calendar', 'Checking your calendar...');
          break;
        case 'EntryProcessing':
          syncState.progress = { current: event.index, total: event.total };
          setPhase(
            'adding-events',
            event.total > 1 ? `Syncing ${event.index} of ${event.total}...` : 'Syncing your PTO...',
          );
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
          setPhase('done', 'All done!');
          appendLog(
            `Done! ${event.entriesSynced} synced, ${event.entriesSkipped} already on calendar`,
            'success',
          );
          break;
        case 'SyncFailed':
          setPhase('error', 'Something went wrong');
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
    syncState.phase = 'done';
    syncState.phaseMessage = 'All done!';

    // Save to activity history
    if (result) {
      await saveActivityEntry(result);
    }

    // Show notification for manual sync if UI is not open
    if (result && (result.entriesSynced > 0 || (result.errors && result.errors.length > 0))) {
      showSyncNotification(result, false);
    }

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
    syncState.phase = 'error';
    syncState.phaseMessage = null;
    appendLog(message, 'error');
  }
}

// --- Auto-sync alarm management ---

const AUTO_SYNC_ALARM_NAME = 'auto-sync';

async function setupAutoSyncAlarm() {
  const settings: SyncSettings = await settingsStore.getSettings();
  if (settings.autoSyncEnabled) {
    await browser.alarms.create(AUTO_SYNC_ALARM_NAME, {
      periodInMinutes: settings.autoSyncIntervalMinutes,
    });
    console.log(
      `[PTO Sync] Auto-sync alarm set: every ${settings.autoSyncIntervalMinutes} minutes`,
    );
  } else {
    await browser.alarms.clear(AUTO_SYNC_ALARM_NAME);
    console.log('[PTO Sync] Auto-sync alarm cleared');
  }
}

async function runAutoSync() {
  if (syncState.status === 'syncing' || syncState.status === 'awaiting-sso') {
    console.log('[PTO Sync] Auto-sync skipped: sync already in progress');
    return;
  }

  console.log('[PTO Sync] Auto-sync starting...');

  syncState = {
    status: 'syncing',
    log: [],
    lastResult: null,
    error: null,
    progress: null,
    preview: null,
    phase: 'connecting',
    phaseMessage: 'Connecting to Workday...',
  };

  appendLog('Auto-sync starting...');

  try {
    const settings: SyncSettings = await settingsStore.getSettings();
    const eventBus = createEventBus();

    eventBus.subscribe((event: DomainEvent) => {
      switch (event.type) {
        case 'EntrySkipped':
          appendLog(`Skipped: ${event.date} - ${humanizeSkipReason(event.reason)}`);
          break;
        case 'CalendarEventCreated':
          appendLog(`Created: ${event.summary} (${event.date})`, 'success');
          break;
        case 'EntryResynced':
          appendLog(`Re-synced: ${event.date} (${event.reason})`, 'info');
          break;
        case 'SyncCompleted':
          setPhase('done', 'All done!');
          appendLog(
            `Done! ${event.entriesSynced} synced, ${event.entriesSkipped} already on calendar`,
            'success',
          );
          break;
        case 'SyncFailed':
          setPhase('error', 'Something went wrong');
          appendLog(`Auto-sync failed: ${event.error}`, 'error');
          break;
      }
    });

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
      eventBus,
      settings,
    });

    await service.sync();

    const result = await storage.getLastSyncResult();
    syncState.status = 'completed';
    syncState.lastResult = result;
    syncState.preview = null;
    syncState.phase = 'done';
    syncState.phaseMessage = 'All done!';

    // Save to activity history
    if (result) {
      await saveActivityEntry(result);
    }

    // Show notification if something changed
    if (result && (result.entriesSynced > 0 || (result.errors && result.errors.length > 0))) {
      showSyncNotification(result, true);
    }

    console.log('[PTO Sync] Auto-sync completed successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    syncState.status = 'failed';
    syncState.error = message;
    syncState.phase = 'error';
    syncState.phaseMessage = null;
    appendLog(message, 'error');
    console.error('[PTO Sync] Auto-sync failed:', message);
  }
}

// --- Notifications ---

function showSyncNotification(result: SyncResult, isAutoSync: boolean) {
  const synced = result.entriesSynced;
  const errorCount = result.errors?.length ?? 0;

  // Don't notify if nothing happened
  if (synced === 0 && errorCount === 0) return;

  // For manual sync, skip notification — user already sees the UI
  if (!isAutoSync) return;

  let message: string;
  if (synced > 0 && errorCount > 0) {
    message = `${synced} PTO ${synced === 1 ? 'event' : 'events'} added to your calendar. ${errorCount} ${errorCount === 1 ? 'error' : 'errors'} occurred.`;
  } else if (synced > 0) {
    message = `${synced} new PTO ${synced === 1 ? 'event' : 'events'} added to your calendar.`;
  } else {
    message = `Sync completed with ${errorCount} ${errorCount === 1 ? 'error' : 'errors'}.`;
  }

  browser.notifications.create('sync-complete', {
    type: 'basic',
    iconUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    title: 'PTO Sync',
    message,
  });
}

// --- Message handler ---

export default defineBackground(() => {
  console.log('[PTO Sync] Background service worker started');

  // Open side panel when clicking the extension icon (Chrome-only feature)
  if (typeof chrome !== 'undefined' && chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Set up auto-sync alarm on startup
  setupAutoSyncAlarm();

  // Listen for alarm events
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_SYNC_ALARM_NAME) {
      runAutoSync();
    }
  });

  browser.runtime.onMessage.addListener(
    (message: { type: string; settings?: SyncSettings; date?: string }, _sender, sendResponse) => {
      if (message.type === 'START_SYNC') {
        runSync()
          .then(() => {
            // Sync finished (state already updated)
          })
          .catch((err) => {
            console.error('[PTO Sync] Unhandled sync error:', err);
          });
        sendResponse({ started: true });
        return false;
      }

      if (message.type === 'PREVIEW_SYNC') {
        runPreview()
          .then(() => {
            // Preview finished (state already updated)
          })
          .catch((err) => {
            console.error('[PTO Sync] Unhandled preview error:', err);
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
          phase: syncState.phase,
          phaseMessage: syncState.phaseMessage,
        });
        return false;
      }

      if (message.type === 'GET_ACTIVITY_HISTORY') {
        getActivityHistory()
          .then((history) => sendResponse({ success: true, history }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
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
          .then(() => {
            // Update auto-sync alarm when settings change
            setupAutoSyncAlarm();
            sendResponse({ success: true });
          })
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'LIST_CALENDARS') {
        listCalendars(getAuthToken)
          .then((calendars) => sendResponse({ success: true, calendars }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'GET_NEXT_ALARM') {
        browser.alarms
          .get(AUTO_SYNC_ALARM_NAME)
          .then((alarm) => {
            sendResponse({
              success: true,
              scheduledTime: alarm ? alarm.scheduledTime : null,
            });
          })
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'DETECT_WORKDAY_TABS') {
        browser.tabs
          .query({ url: 'https://*.myworkday.com/*' })
          .then((tabs) => {
            const tabInfo = tabs.map((t) => ({ url: t.url, title: t.title }));
            sendResponse({ success: true, tabs: tabInfo });
          })
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'RESET_ALL') {
        (async () => {
          try {
            // Clear all extension storage
            await browser.storage.local.clear();
            // Clear any alarms
            await browser.alarms.clearAll();
            // Revoke the cached auth token (Chrome-only API)
            if (isChromeIdentityAvailable()) {
              try {
                const token = await getAuthTokenChrome(false);
                await new Promise<void>((resolve) => {
                  chrome.identity.removeCachedAuthToken({ token }, () => resolve());
                });
              } catch {
                // No token to revoke — that's fine
              }
            }
            // Reset in-memory state
            syncState = {
              status: 'idle',
              log: [],
              lastResult: null,
              error: null,
              progress: null,
              preview: null,
              phase: null,
              phaseMessage: null,
            };
            sendResponse({ success: true });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendResponse({ success: false, error: errMsg });
          }
        })();
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
