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

function compactDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const dow = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${month} ${day} (${dow})`;
}

function monthKey(isoDate: string): string {
  // Returns "YYYY-MM" for grouping
  return isoDate.substring(0, 7);
}

function monthLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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

/** Whether this action is something that will change state */
function isActionable(action: SyncPreviewEntry['action']): boolean {
  return action === 'create' || action === 'delete' || action === 'resync';
}

interface MonthGroup<T> {
  key: string;
  label: string;
  entries: T[];
}

/** Group entries by month, newest month first */
function groupByMonth<T extends { date: string }>(entries: T[]): MonthGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const entry of entries) {
    const key = monthKey(entry.date);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  // Sort groups newest first
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  return sortedKeys.map((key) => ({
    key,
    label: monthLabel(groups.get(key)![0].date),
    entries: groups.get(key)!,
  }));
}

/** Build a human-readable summary message for the preview */
function buildSummaryMessage(summary: {
  creates: number;
  skips: number;
  deletes: number;
  resyncs: number;
}): string {
  const parts: string[] = [];

  // Case: everything is up to date
  if (summary.creates === 0 && summary.deletes === 0 && summary.resyncs === 0) {
    const total = summary.skips;
    return `All ${total} PTO ${total === 1 ? 'entry is' : 'entries are'} already on your calendar. Nothing to do.`;
  }

  // Re-syncs (entries removed from calendar that will be re-added)
  if (summary.resyncs > 0) {
    parts.push(
      `${summary.resyncs} ${summary.resyncs === 1 ? 'entry was' : 'entries were'} removed from your calendar and will be re-added.`,
    );
  }

  // New entries to add
  if (summary.creates > 0) {
    if (summary.resyncs > 0) {
      parts.push(
        `${summary.creates} new ${summary.creates === 1 ? 'entry' : 'entries'} will also be added.`,
      );
    } else {
      parts.push(
        `${summary.creates} PTO ${summary.creates === 1 ? 'entry' : 'entries'} will be added to your calendar.`,
      );
    }
  }

  // Entries to remove (cancellations)
  if (summary.deletes > 0) {
    parts.push(
      `${summary.deletes} cancelled ${summary.deletes === 1 ? 'entry' : 'entries'} will be removed from your calendar.`,
    );
  }

  // Existing entries
  if (summary.skips > 0) {
    parts.push(`${summary.skips} ${summary.skips === 1 ? 'is' : 'are'} already there.`);
  }

  return parts.join(' ');
}

/** Build the smart sync button text */
function buildSyncButtonText(summary: {
  creates: number;
  deletes: number;
  resyncs: number;
}): string {
  const addCount = summary.creates + summary.resyncs;

  // Nothing to do
  if (addCount === 0 && summary.deletes === 0) {
    return 'Everything is up to date';
  }

  // Only re-adds (no new, no deletes)
  if (summary.creates === 0 && summary.resyncs > 0 && summary.deletes === 0) {
    return `Re-add ${summary.resyncs} ${summary.resyncs === 1 ? 'event' : 'events'} to calendar`;
  }

  // Adds and removals
  if (addCount > 0 && summary.deletes > 0) {
    return `Add ${addCount} ${addCount === 1 ? 'event' : 'events'} and remove ${summary.deletes}`;
  }

  // Only adds
  if (addCount > 0) {
    return `Add ${addCount} ${addCount === 1 ? 'event' : 'events'} to calendar`;
  }

  // Only removals
  return `Remove ${summary.deletes} ${summary.deletes === 1 ? 'event' : 'events'} from calendar`;
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
  let hasShownPreview = false;

  // Track collapsed state for month groups
  const collapsedMonths = new Map<string, boolean>();
  const collapsedSyncedMonths = new Map<string, boolean>();

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

  /** Create a collapsible month group DOM element */
  function createMonthGroupEl(
    group: MonthGroup<SyncPreviewEntry>,
    stateMap: Map<string, boolean>,
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = 'month-group';

    const hasActionableEntries = group.entries.some((e) => isActionable(e.action));

    // If no stored state, default: expand if has actionable, collapse otherwise
    if (!stateMap.has(group.key)) {
      stateMap.set(group.key, !hasActionableEntries);
    }
    const isCollapsed = stateMap.get(group.key)!;

    // Month header
    const header = document.createElement('button');
    header.className = 'month-header';
    header.type = 'button';
    header.setAttribute('aria-expanded', String(!isCollapsed));

    // Left side: arrow + month name
    const headerLeft = document.createElement('span');
    headerLeft.className = 'month-header-left';

    const arrow = document.createElement('span');
    arrow.className = `month-arrow${isCollapsed ? '' : ' open'}`;
    arrow.textContent = '\u25B6'; // ►

    const name = document.createElement('span');
    name.className = 'month-name';
    name.textContent = group.label;

    headerLeft.appendChild(arrow);
    headerLeft.appendChild(name);

    // Right side: badge
    const badge = document.createElement('span');
    badge.className = 'month-badge';
    badge.innerHTML = buildMonthBadge(group.entries);

    header.appendChild(headerLeft);
    header.appendChild(badge);

    // Entries container
    const entriesEl = document.createElement('div');
    entriesEl.className = `month-entries${isCollapsed ? ' collapsed' : ''}`;

    for (const entry of group.entries) {
      entriesEl.appendChild(createPreviewRowEl(entry));
    }

    // Toggle
    header.addEventListener('click', () => {
      const nowCollapsed = !entriesEl.classList.contains('collapsed');
      entriesEl.classList.toggle('collapsed', nowCollapsed);
      arrow.classList.toggle('open', !nowCollapsed);
      header.setAttribute('aria-expanded', String(!nowCollapsed));
      stateMap.set(group.key, nowCollapsed);
    });

    container.appendChild(header);
    container.appendChild(entriesEl);
    return container;
  }

  /** Build the badge text for a month header */
  function buildMonthBadge(entries: SyncPreviewEntry[]): string {
    const creates = entries.filter((e) => e.action === 'create').length;
    const deletes = entries.filter((e) => e.action === 'delete').length;
    const resyncs = entries.filter((e) => e.action === 'resync').length;
    const skips = entries.filter((e) => e.action === 'skip').length;

    const parts: string[] = [];
    if (creates > 0) parts.push(`<span class="month-badge-action">${creates} new</span>`);
    if (resyncs > 0) parts.push(`<span class="month-badge-resync">${resyncs} re-sync</span>`);
    if (deletes > 0) parts.push(`<span class="month-badge-delete">${deletes} remove</span>`);
    if (skips > 0 && parts.length === 0) {
      // Only show existing count if no actionable items
      parts.push(`${skips} existing`);
    } else if (skips > 0) {
      parts.push(`${skips} existing`);
    }

    return parts.join(', ');
  }

  /** Create a single compact preview row */
  function createPreviewRowEl(entry: SyncPreviewEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = `preview-row preview-row-${entry.action}`;

    // Date: "Mar 13 (Fri)"
    const dateEl = document.createElement('span');
    dateEl.className = 'preview-date-combined';
    dateEl.textContent = compactDate(entry.date);

    // Info: type + optional hours
    const infoEl = document.createElement('span');
    infoEl.className = 'preview-info';

    const typeEl = document.createElement('span');
    typeEl.className = 'preview-type';
    typeEl.textContent = shortType(entry.type);
    infoEl.appendChild(typeEl);

    // Only show hours when != 8 (non-full-day)
    const absHours = Math.abs(entry.hours);
    if (absHours !== 8) {
      const hoursEl = document.createElement('span');
      hoursEl.className = 'preview-hours-badge';
      hoursEl.textContent = `${absHours}h`;
      infoEl.appendChild(hoursEl);
    }

    // Action badge
    const actionEl = document.createElement('span');
    actionEl.className = 'preview-action';
    const badgeEl = document.createElement('span');
    badgeEl.className = `action-badge ${actionBadgeClass(entry.action)}`;
    badgeEl.textContent = actionLabel(entry.action);
    actionEl.appendChild(badgeEl);

    row.appendChild(dateEl);
    row.appendChild(infoEl);
    row.appendChild(actionEl);

    return row;
  }

  function renderPreview(preview: SyncPreview | null) {
    if (!preview || preview.entries.length === 0) {
      previewArea.classList.add('hidden');
      syncBtn.classList.add('hidden');
      return;
    }

    previewArea.classList.remove('hidden');
    hasShownPreview = true;

    // Render summary bar with human-readable message
    const summary = summarizePreview(preview);
    const summaryMessage = buildSummaryMessage(summary);
    previewSummary.innerHTML = `<div class="summary-message">${summaryMessage}</div>`;

    // Group entries by month, newest first
    const monthGroups = groupByMonth(preview.entries);

    // Render month-grouped table
    previewTable.innerHTML = '';
    for (const group of monthGroups) {
      previewTable.appendChild(createMonthGroupEl(group, collapsedMonths));
    }

    // Show sync button with smart text
    const hasActions = summary.creates > 0 || summary.deletes > 0 || summary.resyncs > 0;
    if (hasActions) {
      syncBtn.classList.remove('hidden');
      syncBtn.disabled = false;
      syncBtn.classList.remove('up-to-date');
      syncBtnText.textContent = buildSyncButtonText(summary);
    } else {
      // All entries are skips -- calendar is up to date
      syncBtn.classList.remove('hidden');
      syncBtn.disabled = true;
      syncBtn.classList.add('up-to-date');
      syncBtnText.textContent = 'Everything is up to date';
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
        checkBtnText.textContent = hasShownPreview ? 'Refresh preview' : 'Check Workday';
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
        checkBtnText.textContent = hasShownPreview ? 'Refresh preview' : 'Check Workday';
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
        progressArea.classList.add('hidden');

        if (data.preview) {
          checkBtnText.textContent = 'Refresh preview';
          hasShownPreview = true;
          renderPreview(data.preview);
        } else {
          checkBtnText.textContent = hasShownPreview ? 'Refresh preview' : 'Check Workday';
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

    // Group by month
    const monthGroups = groupByMonth(entries);

    for (const group of monthGroups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'month-group';

      // Default: all expanded for synced events
      if (!collapsedSyncedMonths.has(group.key)) {
        collapsedSyncedMonths.set(group.key, false);
      }
      const isCollapsed = collapsedSyncedMonths.get(group.key)!;

      // Header
      const header = document.createElement('button');
      header.className = 'month-header';
      header.type = 'button';
      header.setAttribute('aria-expanded', String(!isCollapsed));

      const headerLeft = document.createElement('span');
      headerLeft.className = 'month-header-left';

      const arrow = document.createElement('span');
      arrow.className = `month-arrow${isCollapsed ? '' : ' open'}`;
      arrow.textContent = '\u25B6';

      const name = document.createElement('span');
      name.className = 'month-name';
      name.textContent = group.label;

      headerLeft.appendChild(arrow);
      headerLeft.appendChild(name);

      const badge = document.createElement('span');
      badge.className = 'month-badge';
      badge.textContent = `${group.entries.length} event${group.entries.length === 1 ? '' : 's'}`;

      header.appendChild(headerLeft);
      header.appendChild(badge);

      // Entries
      const entriesEl = document.createElement('div');
      entriesEl.className = `month-entries${isCollapsed ? ' collapsed' : ''}`;

      for (const entry of group.entries) {
        const row = document.createElement('div');
        row.className = 'synced-row';

        const dateEl = document.createElement('span');
        dateEl.className = 'synced-date';
        dateEl.textContent = compactDate(entry.date);

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
        entriesEl.appendChild(row);
      }

      // Toggle
      header.addEventListener('click', () => {
        const nowCollapsed = !entriesEl.classList.contains('collapsed');
        entriesEl.classList.toggle('collapsed', nowCollapsed);
        arrow.classList.toggle('open', !nowCollapsed);
        header.setAttribute('aria-expanded', String(!nowCollapsed));
        collapsedSyncedMonths.set(group.key, nowCollapsed);
      });

      groupEl.appendChild(header);
      groupEl.appendChild(entriesEl);
      syncedEventsList.appendChild(groupEl);
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
        // Check if the parent month group is now empty
        const monthEntries = rowEl.closest('.month-entries');
        if (monthEntries && monthEntries.children.length === 0) {
          const monthGroup = monthEntries.closest('.month-group');
          if (monthGroup) monthGroup.remove();
        }
        // Check if list is now empty
        if (syncedEventsList.querySelectorAll('.synced-row').length === 0) {
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
      checkBtnText.textContent = hasShownPreview ? 'Refresh preview' : 'Check Workday';
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
