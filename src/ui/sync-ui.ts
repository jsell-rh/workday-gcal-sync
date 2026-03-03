// Shared UI logic for both popup and sidepanel

import type { SyncPreview, SyncPreviewEntry } from '../domain/model/sync-preview';
import { summarizePreview } from '../domain/model/sync-preview';

interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'success';
}

interface SyncStatusResponse {
  status: 'idle' | 'previewing' | 'syncing' | 'awaiting-sso' | 'completed' | 'failed';
  log: LogEntry[];
  lastResult: {
    syncedAt: string;
    entriesFound: number;
    entriesSynced: number;
    entriesSkipped: number;
    errors: { entryDate: string; message: string }[];
  } | null;
  error: string | null;
  progress: {
    current: number;
    total: number;
  } | null;
  preview: SyncPreview | null;
}

interface SyncedEventEntry {
  date: string;
  eventId: string;
}

export interface SyncUIElements {
  checkBtn: HTMLButtonElement;
  checkBtnText: HTMLElement;
  syncBtn: HTMLButtonElement;
  syncBtnText: HTMLElement;
  lastSyncValue: HTMLElement;
  syncStats: HTMLElement;
  statFound: HTMLElement;
  statSynced: HTMLElement;
  statSkipped: HTMLElement;
  statErrorsContainer: HTMLElement;
  statErrors: HTMLElement;
  logArea: HTMLElement;
  logWrapper: HTMLElement;
  logToggle: HTMLButtonElement;
  logToggleArrow: HTMLElement;
  progressArea: HTMLElement;
  progressBar: HTMLElement;
  progressText: HTMLElement;
  errorBanner: HTMLElement;
  errorBannerMessage: HTMLElement;
  successBanner: HTMLElement;
  successMessage: HTMLElement;
  welcomeCard: HTMLElement;
  previewArea: HTMLElement;
  previewSummary: HTMLElement;
  previewTable: HTMLElement;
  syncedEventsToggle: HTMLButtonElement;
  syncedEventsPanel: HTMLElement;
  syncedEventsList: HTMLElement;
  unsyncAllBtn: HTMLButtonElement;
}

/** Clean up raw error messages for display */
function humanizeError(raw: string): string {
  // Strip JSON blobs from Google API errors
  const jsonMatch = raw.match(/\{[\s\S]*"message"\s*:\s*"([^"]+)"[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[1];
  }
  // Strip common technical prefixes
  return raw
    .replace(/^Error:\s*/i, '')
    .replace(/^Request failed with status code \d+:\s*/i, '')
    .trim();
}

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortType(type: string): string {
  if (type.toLowerCase().includes('paid time off') || type.toLowerCase().includes('pto'))
    return 'PTO';
  if (type.toLowerCase().includes('floating holiday')) return 'Floating Holiday';
  return type;
}

function actionBadgeClass(action: SyncPreviewEntry['action']): string {
  switch (action) {
    case 'create':
      return 'badge-create';
    case 'skip':
      return 'badge-skip';
    case 'delete':
      return 'badge-delete';
    case 'resync':
      return 'badge-resync';
  }
}

function actionLabel(action: SyncPreviewEntry['action']): string {
  switch (action) {
    case 'create':
      return 'New';
    case 'skip':
      return 'On calendar';
    case 'delete':
      return 'Remove';
    case 'resync':
      return 'Re-sync';
  }
}

export function initSyncUI(elements: SyncUIElements) {
  const {
    checkBtn,
    checkBtnText,
    syncBtn,
    syncBtnText,
    lastSyncValue,
    syncStats,
    statFound,
    statSynced,
    statSkipped,
    statErrorsContainer,
    statErrors,
    logArea,
    logWrapper,
    logToggle,
    logToggleArrow,
    progressArea,
    progressBar,
    progressText,
    errorBanner,
    errorBannerMessage,
    successBanner,
    successMessage,
    welcomeCard,
    previewArea,
    previewSummary,
    previewTable,
    syncedEventsToggle,
    syncedEventsPanel,
    syncedEventsList,
    unsyncAllBtn,
  } = elements;

  let logDetailsOpen = false;
  let syncedEventsOpen = false;

  // --- Log toggle ---
  logToggle.addEventListener('click', () => {
    logDetailsOpen = !logDetailsOpen;
    logArea.classList.toggle('hidden', !logDetailsOpen);
    logToggle.setAttribute('aria-expanded', String(logDetailsOpen));
    logToggleArrow.classList.toggle('open', logDetailsOpen);
  });

  // --- Synced events toggle ---
  syncedEventsToggle.addEventListener('click', () => {
    syncedEventsOpen = !syncedEventsOpen;
    syncedEventsPanel.classList.toggle('hidden', !syncedEventsOpen);
    syncedEventsToggle.setAttribute('aria-expanded', String(syncedEventsOpen));
    if (syncedEventsOpen) {
      loadSyncedEvents();
    }
  });

  // --- Polling ---
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(pollStatus, 500);
  }

  // --- Render helpers ---

  function showSpinner(btn: HTMLButtonElement, show: boolean) {
    const existingSpinner = btn.querySelector('.btn-spinner');
    const textEl = btn.querySelector('.btn-text');
    if (show && !existingSpinner) {
      const spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      if (textEl) {
        btn.insertBefore(spinner, textEl);
      } else {
        btn.appendChild(spinner);
      }
    } else if (!show && existingSpinner) {
      existingSpinner.remove();
    }
  }

  function renderLog(log: LogEntry[]) {
    logArea.innerHTML = '';
    if (log.length === 0) {
      logWrapper.classList.add('hidden');
      return;
    }
    logWrapper.classList.remove('hidden');
    for (const entry of log) {
      const el = document.createElement('div');
      el.className = `log-entry ${entry.level}`;
      el.textContent = `${entry.timestamp} ${entry.message}`;
      logArea.appendChild(el);
    }
    logArea.scrollTop = logArea.scrollHeight;
  }

  function renderProgress(progress: SyncStatusResponse['progress']) {
    if (!progress || progress.total === 0) {
      progressArea.classList.add('hidden');
      return;
    }
    progressArea.classList.remove('hidden');
    const pct = Math.round((progress.current / progress.total) * 100);
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `Processing ${progress.current} of ${progress.total} entries...`;
  }

  function renderResult(result: SyncStatusResponse['lastResult']) {
    if (!result) return;
    const date = new Date(result.syncedAt);
    lastSyncValue.textContent = date.toLocaleString();
    lastSyncValue.className = 'status-value success';
    syncStats.classList.remove('hidden');
    statFound.textContent = String(result.entriesFound);
    statSynced.textContent = String(result.entriesSynced);
    statSkipped.textContent = String(result.entriesSkipped);

    const errorCount = result.errors?.length ?? 0;
    if (errorCount > 0) {
      syncStats.classList.add('has-errors');
      statErrorsContainer.classList.remove('hidden');
      statErrors.textContent = String(errorCount);
    } else {
      syncStats.classList.remove('has-errors');
      statErrorsContainer.classList.add('hidden');
    }
  }

  function showSuccessBanner(result: SyncStatusResponse['lastResult']) {
    if (!result) return;
    const parts: string[] = [];
    if (result.entriesSynced > 0) {
      parts.push(`${result.entriesSynced} event${result.entriesSynced === 1 ? '' : 's'} synced`);
    }
    if (result.entriesSkipped > 0) {
      parts.push(`${result.entriesSkipped} already on calendar`);
    }
    if (parts.length === 0) {
      parts.push('All up to date');
    }
    successMessage.textContent = parts.join(', ');
    successBanner.classList.remove('hidden');
  }

  function showErrorBanner(result: SyncStatusResponse['lastResult'], topError: string | null) {
    if (topError) {
      errorBannerMessage.textContent = humanizeError(topError);
      errorBanner.classList.remove('hidden');
      return;
    }
    if (result && result.errors && result.errors.length > 0) {
      const count = result.errors.length;
      const first = humanizeError(result.errors[0].message);
      errorBannerMessage.textContent =
        count === 1 ? first : `${first} (+${count - 1} more - see details)`;
      errorBanner.classList.remove('hidden');
    }
  }

  function clearBanners() {
    successBanner.classList.add('hidden');
    errorBanner.classList.add('hidden');
  }

  function renderPreview(preview: SyncPreview | null) {
    if (!preview || preview.entries.length === 0) {
      previewArea.classList.add('hidden');
      syncBtn.classList.add('hidden');
      return;
    }

    previewArea.classList.remove('hidden');

    // Render summary
    const summary = summarizePreview(preview);
    const summaryParts: string[] = [];
    if (summary.creates > 0)
      summaryParts.push(
        `<span class="summary-create">${summary.creates} new event${summary.creates === 1 ? '' : 's'} will be created</span>`,
      );
    if (summary.skips > 0)
      summaryParts.push(
        `<span class="summary-skip">${summary.skips} already on your calendar</span>`,
      );
    if (summary.deletes > 0)
      summaryParts.push(
        `<span class="summary-delete">${summary.deletes} cancelled, will be removed</span>`,
      );
    if (summary.resyncs > 0)
      summaryParts.push(
        `<span class="summary-resync">${summary.resyncs} deleted, will be re-created</span>`,
      );
    previewSummary.innerHTML = summaryParts.join('<br>');

    // Render table
    previewTable.innerHTML = '';
    for (const entry of preview.entries) {
      const row = document.createElement('div');
      row.className = `preview-row preview-row-${entry.action}`;

      row.innerHTML = `
        <div class="preview-date">
          <span class="preview-date-text">${formatDate(entry.date)}</span>
          <span class="preview-dow">${entry.dayOfWeek}</span>
        </div>
        <div class="preview-details">
          <span class="preview-type">${shortType(entry.type)}</span>
          <span class="preview-hours">${Math.abs(entry.hours)}h</span>
          <span class="preview-status">${entry.status}</span>
        </div>
        <div class="preview-action">
          <span class="action-badge ${actionBadgeClass(entry.action)}">${actionLabel(entry.action)}</span>
        </div>
      `;

      previewTable.appendChild(row);
    }

    // Show sync button if there are actionable entries
    const hasActions = summary.creates > 0 || summary.deletes > 0 || summary.resyncs > 0;
    if (hasActions) {
      syncBtn.classList.remove('hidden');
      syncBtn.disabled = false;
      syncBtnText.textContent = 'Sync to Calendar';
    } else {
      // All entries are skips — calendar is up to date
      syncBtn.classList.add('hidden');
      // Show a subtle success state
      successMessage.textContent = 'Your calendar is up to date';
      successBanner.classList.remove('hidden');
    }
  }

  function renderStatus(data: SyncStatusResponse) {
    renderLog(data.log);

    switch (data.status) {
      case 'previewing':
        checkBtn.disabled = true;
        showSpinner(checkBtn, true);
        checkBtnText.textContent = 'Checking Workday...';
        syncBtn.classList.add('hidden');
        welcomeCard.classList.add('hidden');
        clearBanners();
        previewArea.classList.add('hidden');
        break;

      case 'syncing':
      case 'awaiting-sso':
        checkBtn.disabled = true;
        showSpinner(checkBtn, true);
        checkBtnText.textContent =
          data.status === 'awaiting-sso' ? 'Waiting for sign-in...' : 'Syncing...';
        syncBtn.classList.add('hidden');
        syncBtn.disabled = true;
        welcomeCard.classList.add('hidden');
        clearBanners();
        previewArea.classList.add('hidden');
        renderProgress(data.progress);
        break;

      case 'completed':
        checkBtn.disabled = false;
        showSpinner(checkBtn, false);
        checkBtnText.textContent = 'Check Workday';
        syncBtn.classList.add('hidden');
        syncBtn.disabled = false;
        progressArea.classList.add('hidden');
        previewArea.classList.add('hidden');
        renderResult(data.lastResult);
        showSuccessBanner(data.lastResult);
        if (data.lastResult?.errors && data.lastResult.errors.length > 0) {
          showErrorBanner(data.lastResult, null);
        }
        stopPolling();
        break;

      case 'failed':
        checkBtn.disabled = false;
        showSpinner(checkBtn, false);
        checkBtnText.textContent = 'Check Workday';
        syncBtn.classList.add('hidden');
        progressArea.classList.add('hidden');
        previewArea.classList.add('hidden');
        lastSyncValue.textContent = data.lastResult
          ? new Date(data.lastResult.syncedAt).toLocaleString()
          : 'Failed';
        lastSyncValue.className = data.lastResult ? 'status-value success' : 'status-value error';
        showErrorBanner(null, data.error);
        stopPolling();
        break;

      case 'idle':
        checkBtn.disabled = false;
        showSpinner(checkBtn, false);
        checkBtnText.textContent = 'Check Workday';
        progressArea.classList.add('hidden');

        if (data.preview) {
          renderPreview(data.preview);
        } else {
          previewArea.classList.add('hidden');
          syncBtn.classList.add('hidden');
        }

        renderResult(data.lastResult);
        // Show welcome if never synced and no preview
        if (!data.lastResult && !data.preview) {
          welcomeCard.classList.remove('hidden');
        } else {
          welcomeCard.classList.add('hidden');
        }
        stopPolling();
        break;
    }
  }

  // --- Synced events ---

  async function loadSyncedEvents() {
    syncedEventsList.innerHTML = '<span class="synced-loading">Loading synced events...</span>';
    try {
      const response: { success: boolean; entries?: SyncedEventEntry[]; error?: string } =
        await browser.runtime.sendMessage({ type: 'GET_SYNCED_EVENTS' });

      if (response.success && response.entries) {
        renderSyncedEvents(response.entries);
      } else {
        syncedEventsList.innerHTML =
          '<span class="synced-empty">Could not load synced events.</span>';
      }
    } catch {
      syncedEventsList.innerHTML =
        '<span class="synced-empty">Could not load synced events.</span>';
    }
  }

  function renderSyncedEvents(entries: SyncedEventEntry[]) {
    syncedEventsList.innerHTML = '';
    if (entries.length === 0) {
      syncedEventsList.innerHTML = '<span class="synced-empty">No synced events yet.</span>';
      unsyncAllBtn.classList.add('hidden');
      return;
    }

    unsyncAllBtn.classList.remove('hidden');

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'synced-row';

      const dateEl = document.createElement('span');
      dateEl.className = 'synced-date';
      dateEl.textContent = formatDate(entry.date);

      const idHint = document.createElement('span');
      idHint.className = 'synced-id';
      idHint.textContent = entry.eventId === 'existing' ? '(pre-existing)' : '';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'synced-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => unsyncEvent(entry.date, row));

      row.appendChild(dateEl);
      row.appendChild(idHint);
      row.appendChild(removeBtn);
      syncedEventsList.appendChild(row);
    }
  }

  async function unsyncEvent(date: string, rowEl: HTMLElement) {
    const removeBtn = rowEl.querySelector('.synced-remove') as HTMLButtonElement;
    if (removeBtn) {
      removeBtn.disabled = true;
      removeBtn.textContent = '...';
    }

    try {
      const response: { success: boolean; error?: string } = await browser.runtime.sendMessage({
        type: 'UNSYNC_EVENT',
        date,
      });

      if (response.success) {
        rowEl.remove();
        // Check if list is now empty
        if (syncedEventsList.children.length === 0) {
          syncedEventsList.innerHTML = '<span class="synced-empty">No synced events.</span>';
          unsyncAllBtn.classList.add('hidden');
        }
      } else {
        if (removeBtn) {
          removeBtn.disabled = false;
          removeBtn.textContent = 'Remove';
        }
      }
    } catch {
      if (removeBtn) {
        removeBtn.disabled = false;
        removeBtn.textContent = 'Remove';
      }
    }
  }

  unsyncAllBtn.addEventListener('click', async () => {
    unsyncAllBtn.disabled = true;
    unsyncAllBtn.textContent = 'Removing...';

    try {
      const response: { success: boolean; error?: string } = await browser.runtime.sendMessage({
        type: 'UNSYNC_ALL',
      });

      if (response.success) {
        syncedEventsList.innerHTML = '<span class="synced-empty">No synced events.</span>';
        unsyncAllBtn.classList.add('hidden');
      }
    } catch {
      // ignore
    } finally {
      unsyncAllBtn.disabled = false;
      unsyncAllBtn.textContent = 'Remove all synced events';
    }
  });

  // --- Communicate with background ---

  async function pollStatus() {
    try {
      const response: SyncStatusResponse = await browser.runtime.sendMessage({
        type: 'GET_SYNC_STATUS',
      });
      renderStatus(response);
    } catch {
      // Background may not be ready yet; ignore
    }
  }

  async function startPreview() {
    checkBtn.disabled = true;
    showSpinner(checkBtn, true);
    checkBtnText.textContent = 'Checking Workday...';
    logArea.innerHTML = '';
    welcomeCard.classList.add('hidden');
    clearBanners();
    previewArea.classList.add('hidden');
    syncBtn.classList.add('hidden');
    syncStats.classList.add('hidden');

    try {
      await browser.runtime.sendMessage({ type: 'PREVIEW_SYNC' });
      startPolling();
    } catch {
      checkBtn.disabled = false;
      showSpinner(checkBtn, false);
      checkBtnText.textContent = 'Check Workday';
    }
  }

  async function startSync() {
    syncBtn.disabled = true;
    showSpinner(syncBtn, true);
    syncBtnText.textContent = 'Syncing...';
    checkBtn.disabled = true;
    logArea.innerHTML = '';
    clearBanners();
    syncStats.classList.add('hidden');
    progressArea.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting sync...';

    try {
      await browser.runtime.sendMessage({ type: 'START_SYNC' });
      startPolling();
    } catch {
      syncBtn.disabled = false;
      showSpinner(syncBtn, false);
      syncBtnText.textContent = 'Sync to Calendar';
      checkBtn.disabled = false;
      progressArea.classList.add('hidden');
    }
  }

  // --- Event listeners ---
  checkBtn.addEventListener('click', startPreview);
  syncBtn.addEventListener('click', startSync);

  // --- Init: fetch current state on open ---
  async function initStatus() {
    try {
      const response: SyncStatusResponse = await browser.runtime.sendMessage({
        type: 'GET_SYNC_STATUS',
      });
      renderStatus(response);
      if (
        response.status === 'syncing' ||
        response.status === 'awaiting-sso' ||
        response.status === 'previewing'
      ) {
        startPolling();
      }
    } catch {
      // Background may not be ready yet — show welcome state
      welcomeCard.classList.remove('hidden');
    }
  }

  initStatus();
}
