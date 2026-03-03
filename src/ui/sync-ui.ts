// Shared UI logic for both popup and sidepanel

interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'success';
}

interface SyncStatusResponse {
  status: 'idle' | 'syncing' | 'awaiting-sso' | 'completed' | 'failed';
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
}

export interface SyncUIElements {
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

export function initSyncUI(elements: SyncUIElements) {
  const {
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
  } = elements;

  let logDetailsOpen = false;

  // --- Log toggle ---
  logToggle.addEventListener('click', () => {
    logDetailsOpen = !logDetailsOpen;
    logArea.classList.toggle('hidden', !logDetailsOpen);
    logToggle.setAttribute('aria-expanded', String(logDetailsOpen));
    logToggleArrow.classList.toggle('open', logDetailsOpen);
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

  function showSpinner(show: boolean) {
    const existingSpinner = syncBtn.querySelector('.btn-spinner');
    if (show && !existingSpinner) {
      const spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      syncBtn.insertBefore(spinner, syncBtnText);
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

  function renderStatus(data: SyncStatusResponse) {
    renderLog(data.log);

    switch (data.status) {
      case 'syncing':
      case 'awaiting-sso':
        syncBtn.disabled = true;
        showSpinner(true);
        syncBtnText.textContent =
          data.status === 'awaiting-sso' ? 'Waiting for sign-in...' : 'Syncing...';
        welcomeCard.classList.add('hidden');
        clearBanners();
        renderProgress(data.progress);
        break;

      case 'completed':
        syncBtn.disabled = false;
        showSpinner(false);
        syncBtnText.textContent = 'Sync PTO Now';
        progressArea.classList.add('hidden');
        renderResult(data.lastResult);
        showSuccessBanner(data.lastResult);
        if (data.lastResult?.errors && data.lastResult.errors.length > 0) {
          showErrorBanner(data.lastResult, null);
        }
        stopPolling();
        break;

      case 'failed':
        syncBtn.disabled = false;
        showSpinner(false);
        syncBtnText.textContent = 'Sync PTO Now';
        progressArea.classList.add('hidden');
        lastSyncValue.textContent = 'Failed';
        lastSyncValue.className = 'status-value error';
        showErrorBanner(null, data.error);
        stopPolling();
        break;

      case 'idle':
        syncBtn.disabled = false;
        showSpinner(false);
        syncBtnText.textContent = 'Sync PTO Now';
        progressArea.classList.add('hidden');
        renderResult(data.lastResult);
        // Show welcome if never synced
        if (!data.lastResult) {
          welcomeCard.classList.remove('hidden');
        }
        stopPolling();
        break;
    }
  }

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

  async function startSync() {
    syncBtn.disabled = true;
    showSpinner(true);
    syncBtnText.textContent = 'Syncing...';
    logArea.innerHTML = '';
    welcomeCard.classList.add('hidden');
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
      showSpinner(false);
      syncBtnText.textContent = 'Sync PTO Now';
      progressArea.classList.add('hidden');
    }
  }

  // --- Event listeners ---
  syncBtn.addEventListener('click', startSync);

  // --- Init: fetch current state on open ---
  async function initStatus() {
    try {
      const response: SyncStatusResponse = await browser.runtime.sendMessage({
        type: 'GET_SYNC_STATUS',
      });
      renderStatus(response);
      if (response.status === 'syncing' || response.status === 'awaiting-sso') {
        startPolling();
      }
    } catch {
      // Background may not be ready yet — show welcome state
      welcomeCard.classList.remove('hidden');
    }
  }

  initStatus();
}
