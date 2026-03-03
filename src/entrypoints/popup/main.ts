// --- DOM elements ---
const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
const lastSyncValue = document.getElementById('last-sync-value')!;
const syncStats = document.getElementById('sync-stats')!;
const statFound = document.getElementById('stat-found')!;
const statSynced = document.getElementById('stat-synced')!;
const statSkipped = document.getElementById('stat-skipped')!;
const logArea = document.getElementById('log-area')!;

// --- Types matching background worker's SyncState ---
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

// --- Init: fetch current state on popup open ---
pollStatus();
