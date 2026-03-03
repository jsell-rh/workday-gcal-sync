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
  } | null;
  error: string | null;
}

export interface SyncUIElements {
  syncBtn: HTMLButtonElement;
  lastSyncValue: HTMLElement;
  syncStats: HTMLElement;
  statFound: HTMLElement;
  statSynced: HTMLElement;
  statSkipped: HTMLElement;
  logArea: HTMLElement;
}

export function initSyncUI(elements: SyncUIElements) {
  const { syncBtn, lastSyncValue, syncStats, statFound, statSynced, statSkipped, logArea } =
    elements;

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

  // --- Render ---

  function renderLog(log: LogEntry[]) {
    logArea.innerHTML = '';
    if (log.length === 0) {
      logArea.classList.add('hidden');
      return;
    }
    logArea.classList.remove('hidden');
    for (const entry of log) {
      const el = document.createElement('div');
      el.className = `log-entry ${entry.level}`;
      el.textContent = `${entry.timestamp} ${entry.message}`;
      logArea.appendChild(el);
    }
    logArea.scrollTop = logArea.scrollHeight;
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
  }

  function renderStatus(data: SyncStatusResponse) {
    renderLog(data.log);

    switch (data.status) {
      case 'syncing':
      case 'awaiting-sso':
        syncBtn.disabled = true;
        syncBtn.textContent = data.status === 'awaiting-sso' ? 'Awaiting SSO...' : 'Syncing...';
        break;

      case 'completed':
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync PTO Now';
        renderResult(data.lastResult);
        stopPolling();
        break;

      case 'failed':
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync PTO Now';
        lastSyncValue.textContent = 'Failed';
        lastSyncValue.className = 'status-value error';
        stopPolling();
        break;

      case 'idle':
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync PTO Now';
        renderResult(data.lastResult);
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
    syncBtn.textContent = 'Syncing...';
    logArea.innerHTML = '';
    logArea.classList.remove('hidden');

    try {
      await browser.runtime.sendMessage({ type: 'START_SYNC' });
      startPolling();
    } catch {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync PTO Now';
    }
  }

  // --- Event listeners ---
  syncBtn.addEventListener('click', startSync);

  // --- Init: fetch current state on open ---
  // If sync is already in progress, start polling immediately
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
      // Background may not be ready yet
    }
  }

  initStatus();
}
