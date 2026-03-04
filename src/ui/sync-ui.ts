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
    entriesResynced?: number;
    errors: { entryDate: string; message: string }[];
  } | null;
  error: string | null;
  progress: {
    current: number;
    total: number;
  } | null;
  preview: SyncPreview | null;
  phase: string | null;
  phaseMessage: string | null;
}

interface SyncedEventEntry {
  date: string;
  eventId: string;
}

interface ActivityEntry {
  date: string;
  summary: string;
  eventsAdded: number;
  eventsSkipped: number;
  errors: number;
}

export interface SyncUIElements {
  syncNowBtn: HTMLButtonElement;
  syncNowBtnText: HTMLElement;
  previewLink: HTMLButtonElement;
  statusSummary: HTMLElement;
  statusIcon: HTMLElement;
  statusHeadline: HTMLElement;
  statusDetail: HTMLElement;
  progressArea: HTMLElement;
  progressBar: HTMLElement;
  progressPhase: HTMLElement;
  errorBanner: HTMLElement;
  errorBannerMessage: HTMLElement;
  welcomeCard: HTMLElement;
  completionCard: HTMLElement;
  completionMessage: HTMLElement;
  completionDetailsToggle: HTMLButtonElement;
  completionDetails: HTMLElement;
  completionDetailsContent: HTMLElement;
  previewArea: HTMLElement;
  previewBack: HTMLButtonElement;
  previewSummary: HTMLElement;
  previewTable: HTMLElement;
  previewApplyBtn: HTMLButtonElement;
  previewApplyBtnText: HTMLElement;
  activitySection: HTMLElement;
  activityList: HTMLElement;
  syncedSection: HTMLElement;
  syncedEventsToggle: HTMLButtonElement;
  syncedEventsLabel: HTMLElement;
  syncedEventsPanel: HTMLElement;
  syncedEventsList: HTMLElement;
  unsyncAllBtn: HTMLButtonElement;
  autoSyncFooter: HTMLElement;
  autoSyncStatusText: HTMLElement;
  mainContent: HTMLElement;
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

function actionLabel(action: SyncPreviewEntry['action'], past = false): string {
  if (past) {
    switch (action) {
      case 'create':
        return 'Added';
      case 'skip':
        return 'Already there';
      case 'delete':
        return 'Removed';
      case 'resync':
        return 'Re-added';
    }
  }
  switch (action) {
    case 'create':
      return 'New';
    case 'skip':
      return 'On calendar';
    case 'delete':
      return 'Remove';
    case 'resync':
      return 'Re-add';
  }
}

function isActionable(action: SyncPreviewEntry['action']): boolean {
  return action === 'create' || action === 'delete' || action === 'resync';
}

interface MonthGroup<T> {
  key: string;
  label: string;
  entries: T[];
}

function groupByMonth<T extends { date: string }>(entries: T[]): MonthGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const entry of entries) {
    const key = monthKey(entry.date);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  return sortedKeys.map((key) => ({
    key,
    label: monthLabel(groups.get(key)![0].date),
    entries: groups.get(key)!,
  }));
}

function buildSummaryMessage(summary: {
  creates: number;
  skips: number;
  deletes: number;
  resyncs: number;
}): string {
  const parts: string[] = [];

  if (summary.creates === 0 && summary.deletes === 0 && summary.resyncs === 0) {
    const total = summary.skips;
    return `All ${total} PTO ${total === 1 ? 'entry is' : 'entries are'} already on your calendar. Nothing to do.`;
  }

  if (summary.resyncs > 0) {
    parts.push(
      `${summary.resyncs} ${summary.resyncs === 1 ? 'entry was' : 'entries were'} removed from your calendar and will be re-added.`,
    );
  }

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

  if (summary.deletes > 0) {
    parts.push(
      `${summary.deletes} cancelled ${summary.deletes === 1 ? 'entry' : 'entries'} will be removed from your calendar.`,
    );
  }

  if (summary.skips > 0) {
    parts.push(`${summary.skips} ${summary.skips === 1 ? 'is' : 'are'} already there.`);
  }

  return parts.join(' ');
}

function buildApplyButtonText(summary: {
  creates: number;
  deletes: number;
  resyncs: number;
}): string {
  const addCount = summary.creates + summary.resyncs;

  if (addCount === 0 && summary.deletes === 0) {
    return 'Everything is up to date';
  }

  if (summary.creates === 0 && summary.resyncs > 0 && summary.deletes === 0) {
    return `Re-add ${summary.resyncs} ${summary.resyncs === 1 ? 'event' : 'events'} to calendar`;
  }

  if (addCount > 0 && summary.deletes > 0) {
    return `Add ${addCount} ${addCount === 1 ? 'event' : 'events'} and remove ${summary.deletes}`;
  }

  if (addCount > 0) {
    return `Add ${addCount} ${addCount === 1 ? 'event' : 'events'} to calendar`;
  }

  return `Remove ${summary.deletes} ${summary.deletes === 1 ? 'event' : 'events'} from calendar`;
}

function relativeTime(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins === 1) return '1 minute ago';
  if (diffMins < 60) return `${diffMins} minutes ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatActivityDate(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (isToday) return time;
  if (isYesterday) return `Yesterday, ${time}`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + `, ${time}`;
}

export function initSyncUI(elements: SyncUIElements) {
  const {
    syncNowBtn,
    syncNowBtnText,
    previewLink,
    statusSummary,
    statusIcon,
    statusHeadline,
    statusDetail,
    progressArea,
    progressBar,
    progressPhase,
    errorBanner,
    errorBannerMessage,
    welcomeCard,
    completionCard,
    completionMessage,
    completionDetailsToggle,
    completionDetails,
    completionDetailsContent,
    previewArea,
    previewBack,
    previewSummary,
    previewTable,
    previewApplyBtn,
    previewApplyBtnText,
    activitySection,
    activityList,
    syncedSection,
    syncedEventsToggle,
    syncedEventsLabel,
    syncedEventsPanel,
    syncedEventsList,
    unsyncAllBtn,
    autoSyncFooter,
    autoSyncStatusText,
  } = elements;

  // mainContent is passed for future use but not currently needed
  void elements.mainContent;

  let syncedEventsOpen = false;
  let completionDetailsOpen = false;
  let inPreviewMode = false;
  let targetCalendarCount = 1;

  function calendarLabel(): string {
    if (targetCalendarCount > 1) {
      return `across ${targetCalendarCount} calendars`;
    }
    return 'on your calendar';
  }

  async function loadCalendarCount() {
    try {
      const response = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.success && response.settings?.calendarIds) {
        targetCalendarCount = response.settings.calendarIds.length;
      }
    } catch {
      // Default to 1
    }
  }

  // Track collapsed state for month groups
  const collapsedMonths = new Map<string, boolean>();
  const collapsedSyncedMonths = new Map<string, boolean>();
  const collapsedCompletionMonths = new Map<string, boolean>();

  // --- Synced events toggle ---
  syncedEventsToggle.addEventListener('click', () => {
    syncedEventsOpen = !syncedEventsOpen;
    syncedEventsPanel.classList.toggle('hidden', !syncedEventsOpen);
    syncedEventsToggle.setAttribute('aria-expanded', String(syncedEventsOpen));
    const arrow = syncedEventsToggle.querySelector('.collapsible-arrow');
    if (arrow) arrow.classList.toggle('open', syncedEventsOpen);
    if (syncedEventsOpen) {
      loadSyncedEvents();
    }
  });

  // --- Completion details toggle ---
  completionDetailsToggle.addEventListener('click', () => {
    completionDetailsOpen = !completionDetailsOpen;
    completionDetails.classList.toggle('hidden', !completionDetailsOpen);
    completionDetailsToggle.textContent = completionDetailsOpen ? 'Hide details' : 'View details';
    completionDetailsToggle.setAttribute('aria-expanded', String(completionDetailsOpen));
  });

  // --- Preview mode ---
  previewBack.addEventListener('click', () => {
    inPreviewMode = false;
    previewArea.classList.add('hidden');
    showMainView();
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

  function showMainView() {
    // Make main sections visible (non-preview mode)
    syncNowBtn.classList.remove('hidden');
    previewLink.parentElement?.classList.remove('hidden');
    statusSummary.classList.remove('hidden');
    activitySection.classList.remove('hidden');
    syncedSection.classList.remove('hidden');
  }

  function hideMainForPreview() {
    syncNowBtn.classList.add('hidden');
    previewLink.parentElement?.classList.add('hidden');
    completionCard.classList.add('hidden');
    statusSummary.classList.add('hidden');
    activitySection.classList.add('hidden');
    syncedSection.classList.add('hidden');
    progressArea.classList.add('hidden');
  }

  function hideMainForSync() {
    welcomeCard.classList.add('hidden');
    completionCard.classList.add('hidden');
    previewArea.classList.add('hidden');
    errorBanner.classList.add('hidden');
  }

  function renderProgress(progress: SyncStatusResponse['progress'], phaseMessage: string | null) {
    if (phaseMessage) {
      progressPhase.textContent = phaseMessage;
    }

    if (!progress || progress.total === 0) {
      // Show indeterminate progress
      progressBar.classList.add('indeterminate');
      progressBar.style.width = '30%';
      return;
    }

    progressBar.classList.remove('indeterminate');
    const pct = Math.round((progress.current / progress.total) * 100);
    progressBar.style.width = `${pct}%`;
  }

  function renderStatusSummary(result: SyncStatusResponse['lastResult']) {
    if (!result) return;

    statusSummary.classList.remove('hidden');

    const syncedAt = relativeTime(result.syncedAt);
    const totalEvents = result.entriesFound;
    const hasErrors = result.errors && result.errors.length > 0;

    statusHeadline.textContent = `Last synced ${syncedAt}`;

    // Build detail line with event count
    const eventCountText = `${totalEvents} event${totalEvents === 1 ? '' : 's'} ${calendarLabel()}`;
    statusDetail.textContent = eventCountText;

    if (hasErrors) {
      statusIcon.className = 'status-icon status-icon-warning';
      statusIcon.textContent = '!';
    } else {
      statusIcon.className = 'status-icon status-icon-success';
      statusIcon.textContent = '\u2713';
    }
  }

  function renderCompletionCard(result: SyncStatusResponse['lastResult']) {
    if (!result) return;

    completionCard.classList.remove('hidden');

    const parts: string[] = [];
    const newlyAdded = result.entriesSynced;
    const reAdded = result.entriesResynced ?? 0;
    if (newlyAdded > 0) {
      parts.push(`Added ${newlyAdded} new event${newlyAdded === 1 ? '' : 's'} ${calendarLabel()}.`);
    }
    if (reAdded > 0) {
      parts.push(`Re-added ${reAdded} event${reAdded === 1 ? '' : 's'}.`);
    }
    const added = newlyAdded + reAdded;
    if (result.entriesSkipped > 0) {
      parts.push(
        `${result.entriesSkipped} ${result.entriesSkipped === 1 ? 'was' : 'were'} already there.`,
      );
    }
    if (added === 0 && result.entriesSkipped > 0) {
      completionMessage.textContent = 'Everything is already up to date.';
    } else if (parts.length === 0) {
      completionMessage.textContent = 'No PTO entries found.';
    } else {
      completionMessage.textContent = parts.join(' ');
    }

    // Reset details
    completionDetailsOpen = false;
    completionDetails.classList.add('hidden');
    completionDetailsToggle.textContent = 'View details';
  }

  function showErrorBanner(errorMsg: string | null, result: SyncStatusResponse['lastResult']) {
    if (errorMsg) {
      errorBannerMessage.textContent = humanizeError(errorMsg);
      errorBanner.classList.remove('hidden');
      return;
    }
    if (result && result.errors && result.errors.length > 0) {
      const count = result.errors.length;
      const first = humanizeError(result.errors[0].message);
      errorBannerMessage.textContent = count === 1 ? first : `${first} (+${count - 1} more)`;
      errorBanner.classList.remove('hidden');
    }
  }

  // --- Preview rendering ---

  function createMonthGroupEl(
    group: MonthGroup<SyncPreviewEntry>,
    stateMap: Map<string, boolean>,
    pastTense = false,
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = 'month-group';

    const hasActionableEntries = group.entries.some((e) => isActionable(e.action));

    if (!stateMap.has(group.key)) {
      stateMap.set(group.key, !hasActionableEntries);
    }
    const isCollapsed = stateMap.get(group.key)!;

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
    badge.innerHTML = buildMonthBadge(group.entries);

    header.appendChild(headerLeft);
    header.appendChild(badge);

    const entriesEl = document.createElement('div');
    entriesEl.className = `month-entries${isCollapsed ? ' collapsed' : ''}`;

    for (const entry of group.entries) {
      entriesEl.appendChild(createPreviewRowEl(entry, pastTense));
    }

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
      parts.push(`${skips} existing`);
    } else if (skips > 0) {
      parts.push(`${skips} existing`);
    }

    return parts.join(', ');
  }

  function createPreviewRowEl(entry: SyncPreviewEntry, pastTense = false): HTMLElement {
    const row = document.createElement('div');
    row.className = `preview-row preview-row-${entry.action}`;

    const dateEl = document.createElement('span');
    dateEl.className = 'preview-date-combined';
    dateEl.textContent = compactDate(entry.date);

    const infoEl = document.createElement('span');
    infoEl.className = 'preview-info';

    const typeEl = document.createElement('span');
    typeEl.className = 'preview-type';
    typeEl.textContent = shortType(entry.type);
    infoEl.appendChild(typeEl);

    const absHours = Math.abs(entry.hours);
    if (absHours !== 8) {
      const hoursEl = document.createElement('span');
      hoursEl.className = 'preview-hours-badge';
      hoursEl.textContent = `${absHours}h`;
      infoEl.appendChild(hoursEl);
    }

    const actionEl = document.createElement('span');
    actionEl.className = 'preview-action';
    const badgeEl = document.createElement('span');
    badgeEl.className = `action-badge ${actionBadgeClass(entry.action)}`;
    badgeEl.textContent = actionLabel(entry.action, pastTense);
    actionEl.appendChild(badgeEl);

    row.appendChild(dateEl);
    row.appendChild(infoEl);
    row.appendChild(actionEl);

    return row;
  }

  function renderPreviewInArea(preview: SyncPreview) {
    const summary = summarizePreview(preview);
    const summaryMessage = buildSummaryMessage(summary);
    previewSummary.innerHTML = `<div class="summary-message">${summaryMessage}</div>`;

    const monthGroups = groupByMonth(preview.entries);
    previewTable.innerHTML = '';
    for (const group of monthGroups) {
      previewTable.appendChild(createMonthGroupEl(group, collapsedMonths));
    }

    // Apply button
    const hasActions = summary.creates > 0 || summary.deletes > 0 || summary.resyncs > 0;
    if (hasActions) {
      previewApplyBtn.classList.remove('hidden');
      previewApplyBtn.disabled = false;
      previewApplyBtnText.textContent = buildApplyButtonText(summary);
    } else {
      previewApplyBtn.classList.remove('hidden');
      previewApplyBtn.disabled = true;
      previewApplyBtnText.textContent = 'Everything is up to date';
    }
  }

  function renderCompletionDetails(preview: SyncPreview) {
    completionDetailsContent.innerHTML = '';
    const monthGroups = groupByMonth(preview.entries);

    const table = document.createElement('div');
    table.className = 'preview-table';
    for (const group of monthGroups) {
      table.appendChild(createMonthGroupEl(group, collapsedCompletionMonths, true));
    }
    completionDetailsContent.appendChild(table);
  }

  // --- Activity history ---

  async function loadActivityHistory() {
    try {
      const response: { success: boolean; history?: ActivityEntry[] } =
        await browser.runtime.sendMessage({ type: 'GET_ACTIVITY_HISTORY' });

      if (response.success && response.history && response.history.length > 0) {
        activitySection.classList.remove('hidden');
        activityList.innerHTML = '';

        const entries = response.history.slice(0, 5);
        for (const entry of entries) {
          const item = document.createElement('div');
          item.className = 'activity-item';

          const dateEl = document.createElement('span');
          dateEl.className = 'activity-date';
          dateEl.textContent = formatActivityDate(entry.date);

          const summaryEl = document.createElement('span');
          summaryEl.className = 'activity-summary';
          summaryEl.textContent = entry.summary;

          item.appendChild(dateEl);
          item.appendChild(summaryEl);
          activityList.appendChild(item);
        }
      } else {
        activitySection.classList.add('hidden');
      }
    } catch {
      activitySection.classList.add('hidden');
    }
  }

  // --- Auto-sync footer ---

  async function loadAutoSyncStatus() {
    try {
      const response: {
        success: boolean;
        settings?: { autoSyncEnabled: boolean; autoSyncIntervalMinutes: number };
      } = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });

      if (response.success && response.settings) {
        // Update calendar count from the same settings response
        if (response.settings.calendarIds) {
          targetCalendarCount = response.settings.calendarIds.length;
        }
        if (response.settings.autoSyncEnabled) {
          const mins = response.settings.autoSyncIntervalMinutes;
          let interval: string;
          if (mins < 60) {
            interval = `${mins} min`;
          } else {
            const hours = mins / 60;
            interval = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
          }

          // Try to get the next alarm time
          let nextSyncText = '';
          try {
            const alarmResponse: { success: boolean; scheduledTime?: number | null } =
              await browser.runtime.sendMessage({ type: 'GET_NEXT_ALARM' });
            if (alarmResponse.success && alarmResponse.scheduledTime) {
              const nextTime = new Date(alarmResponse.scheduledTime);
              const now = new Date();
              const diffMs = nextTime.getTime() - now.getTime();
              const diffMins = Math.max(0, Math.round(diffMs / 60000));

              if (diffMins < 1) {
                nextSyncText = ' \u00B7 Next: any moment';
              } else if (diffMins === 1) {
                nextSyncText = ' \u00B7 Next: in 1 min';
              } else if (diffMins < 60) {
                nextSyncText = ` \u00B7 Next: in ${diffMins} min`;
              } else {
                const timeStr = nextTime.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                });
                nextSyncText = ` \u00B7 Next: ${timeStr}`;
              }
            }
          } catch {
            // Alarm info not available — just show interval
          }

          autoSyncStatusText.textContent = `Auto-sync: Every ${interval}${nextSyncText}`;
        } else {
          autoSyncStatusText.textContent = 'Auto-sync: Off';
        }
      }
    } catch {
      // ignore
    }
  }

  // Open settings when clicking auto-sync footer
  autoSyncFooter.setAttribute('role', 'button');
  autoSyncFooter.setAttribute('tabindex', '0');
  autoSyncFooter.addEventListener('click', () => {
    const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;
    if (settingsToggle) settingsToggle.click();
  });
  autoSyncFooter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;
      if (settingsToggle) settingsToggle.click();
    }
  });

  // --- Synced events ---

  async function loadSyncedEvents() {
    syncedEventsList.innerHTML = '<span class="synced-loading">Loading...</span>';
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

  function updateSyncedEventsLabel(count?: number) {
    if (count !== undefined && count > 0) {
      syncedEventsLabel.textContent = `Manage synced events (${count})`;
    } else {
      syncedEventsLabel.textContent = 'Manage synced events';
    }
  }

  function renderSyncedEvents(entries: SyncedEventEntry[]) {
    syncedEventsList.innerHTML = '';
    updateSyncedEventsLabel(entries.length);

    if (entries.length === 0) {
      syncedEventsList.innerHTML = '<span class="synced-empty">No synced events yet.</span>';
      unsyncAllBtn.classList.add('hidden');
      return;
    }

    unsyncAllBtn.classList.remove('hidden');

    const monthGroups = groupByMonth(entries);

    for (const group of monthGroups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'month-group';

      if (!collapsedSyncedMonths.has(group.key)) {
        collapsedSyncedMonths.set(group.key, false);
      }
      const isCollapsed = collapsedSyncedMonths.get(group.key)!;

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

      const entriesEl = document.createElement('div');
      entriesEl.className = `month-entries${isCollapsed ? ' collapsed' : ''}`;

      for (const entry of group.entries) {
        const row = document.createElement('div');
        row.className = 'synced-row';

        const dateEl = document.createElement('span');
        dateEl.className = 'synced-date';
        dateEl.textContent = compactDate(entry.date);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'synced-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', `Remove event for ${compactDate(entry.date)}`);
        removeBtn.addEventListener('click', () => unsyncEvent(entry.date, row));

        row.appendChild(dateEl);
        row.appendChild(removeBtn);
        entriesEl.appendChild(row);
      }

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
    const confirmMsg = `Remove this event from your calendar?\n\nThis will delete the calendar event for ${date}.`;
    if (!confirm(confirmMsg)) return;

    const removeBtn = rowEl.querySelector('.synced-remove') as HTMLButtonElement;
    if (removeBtn) {
      removeBtn.disabled = true;
      removeBtn.textContent = 'Removing...';
    }

    try {
      const response: { success: boolean; error?: string } = await browser.runtime.sendMessage({
        type: 'UNSYNC_EVENT',
        date,
      });

      if (response.success) {
        // Animate removal
        rowEl.classList.add('removing');
        setTimeout(() => {
          const monthEntries = rowEl.closest('.month-entries');
          const monthGroup = monthEntries?.closest('.month-group');
          rowEl.remove();
          if (monthEntries && monthEntries.children.length === 0 && monthGroup) {
            monthGroup.remove();
          }
          if (syncedEventsList.querySelectorAll('.synced-row').length === 0) {
            syncedEventsList.innerHTML = '<span class="synced-empty">No synced events.</span>';
            unsyncAllBtn.classList.add('hidden');
          }
          const remaining = syncedEventsList.querySelectorAll('.synced-row').length;
          updateSyncedEventsLabel(remaining);
        }, 300);
      } else {
        if (removeBtn) {
          removeBtn.disabled = false;
          removeBtn.textContent = 'Remove';
        }
        const errorEl = document.createElement('span');
        errorEl.style.color = '#cf222e';
        errorEl.style.fontSize = '11px';
        errorEl.style.marginLeft = '4px';
        errorEl.textContent = 'Could not remove';
        rowEl.appendChild(errorEl);
        setTimeout(() => errorEl.remove(), 3000);
      }
    } catch {
      if (removeBtn) {
        removeBtn.disabled = false;
        removeBtn.textContent = 'Remove';
      }
      const errorEl = document.createElement('span');
      errorEl.style.color = '#cf222e';
      errorEl.style.fontSize = '11px';
      errorEl.style.marginLeft = '4px';
      errorEl.textContent = 'Could not remove';
      rowEl.appendChild(errorEl);
      setTimeout(() => errorEl.remove(), 3000);
    }
  }

  unsyncAllBtn.addEventListener('click', async () => {
    const count = syncedEventsList.querySelectorAll('.synced-row').length;
    const confirmMsg = `Remove all synced events?\n\nThis will delete ${count} event${count === 1 ? '' : 's'} from your Google Calendar. This cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    unsyncAllBtn.disabled = true;
    unsyncAllBtn.textContent = 'Removing...';

    try {
      const response: { success: boolean; error?: string } = await browser.runtime.sendMessage({
        type: 'UNSYNC_ALL',
      });

      if (response.success) {
        syncedEventsList.innerHTML = '<span class="synced-empty">No synced events.</span>';
        unsyncAllBtn.classList.add('hidden');
        updateSyncedEventsLabel(0);
      } else {
        unsyncAllBtn.textContent = 'Failed to remove';
        setTimeout(() => {
          unsyncAllBtn.textContent = 'Remove all synced events';
        }, 2000);
      }
    } catch {
      unsyncAllBtn.textContent = 'Failed to remove';
      setTimeout(() => {
        unsyncAllBtn.textContent = 'Remove all synced events';
      }, 2000);
    } finally {
      unsyncAllBtn.disabled = false;
    }
  });

  // --- Main status rendering ---

  // Track last known preview for completion details
  let lastPreview: SyncPreview | null = null;

  function renderStatus(data: SyncStatusResponse) {
    // Track preview for post-sync details
    if (data.preview) {
      lastPreview = data.preview;
    }

    switch (data.status) {
      case 'previewing': {
        // Show progress, hide everything else
        hideMainForSync();
        syncNowBtn.disabled = true;
        showSpinner(syncNowBtn, true);
        syncNowBtnText.textContent = 'Checking...';
        previewLink.parentElement?.classList.add('hidden');
        progressArea.classList.remove('hidden');
        renderProgress(null, data.phaseMessage ?? 'Checking Workday...');
        break;
      }

      case 'syncing':
      case 'awaiting-sso': {
        hideMainForSync();
        syncNowBtn.disabled = true;
        showSpinner(syncNowBtn, true);
        syncNowBtnText.textContent = 'Syncing...';
        previewLink.parentElement?.classList.add('hidden');
        progressArea.classList.remove('hidden');

        const message =
          data.status === 'awaiting-sso'
            ? (data.phaseMessage ?? 'Please sign in to Workday to continue')
            : (data.phaseMessage ?? 'Syncing your PTO...');
        renderProgress(data.progress, message);
        break;
      }

      case 'completed': {
        // Reset button
        syncNowBtn.disabled = false;
        showSpinner(syncNowBtn, false);
        syncNowBtnText.textContent = 'Sync Now';
        progressArea.classList.add('hidden');
        previewArea.classList.add('hidden');
        previewLink.parentElement?.classList.remove('hidden');

        // Show completion card
        renderCompletionCard(data.lastResult);

        // Show status summary
        renderStatusSummary(data.lastResult);

        // Show completion details if we have preview data
        if (lastPreview && lastPreview.entries.length > 0) {
          completionDetailsToggle.classList.remove('hidden');
          renderCompletionDetails(lastPreview);
        } else {
          completionDetailsToggle.classList.add('hidden');
        }

        // Show errors if any
        if (data.lastResult?.errors && data.lastResult.errors.length > 0) {
          showErrorBanner(null, data.lastResult);
        }

        // Load updated activity history and synced events
        loadActivityHistory();
        loadAutoSyncStatus();

        // Show synced section
        syncedSection.classList.remove('hidden');

        stopPolling();
        break;
      }

      case 'failed': {
        syncNowBtn.disabled = false;
        showSpinner(syncNowBtn, false);
        syncNowBtnText.textContent = 'Sync Now';
        progressArea.classList.add('hidden');
        previewArea.classList.add('hidden');
        previewLink.parentElement?.classList.remove('hidden');
        completionCard.classList.add('hidden');

        // Show error
        showErrorBanner(data.error, null);

        // Show status if we have last result
        if (data.lastResult) {
          renderStatusSummary(data.lastResult);
        } else {
          statusSummary.classList.add('hidden');
        }

        stopPolling();
        break;
      }

      case 'idle': {
        syncNowBtn.disabled = false;
        showSpinner(syncNowBtn, false);
        syncNowBtnText.textContent = 'Sync Now';
        progressArea.classList.add('hidden');

        if (inPreviewMode && data.preview) {
          // We're in preview mode and data arrived
          renderPreviewInArea(data.preview);
          previewArea.classList.remove('hidden');
          hideMainForPreview();
        } else {
          previewArea.classList.add('hidden');
          previewLink.parentElement?.classList.remove('hidden');
        }

        // Show status summary
        if (data.lastResult) {
          renderStatusSummary(data.lastResult);
          welcomeCard.classList.add('hidden');
        }

        // Show welcome if never synced and no preview
        if (!data.lastResult && !data.preview) {
          welcomeCard.classList.remove('hidden');
          statusSummary.classList.add('hidden');
        } else {
          welcomeCard.classList.add('hidden');
        }

        stopPolling();
        break;
      }
    }
  }

  // --- Actions ---

  async function startSync() {
    syncNowBtn.disabled = true;
    showSpinner(syncNowBtn, true);
    syncNowBtnText.textContent = 'Syncing...';
    hideMainForSync();
    progressArea.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressBar.classList.add('indeterminate');
    progressPhase.textContent = 'Connecting to Workday...';
    previewLink.parentElement?.classList.add('hidden');

    try {
      await browser.runtime.sendMessage({ type: 'START_SYNC' });
      startPolling();
    } catch {
      syncNowBtn.disabled = false;
      showSpinner(syncNowBtn, false);
      syncNowBtnText.textContent = 'Sync Now';
      progressArea.classList.add('hidden');
      previewLink.parentElement?.classList.remove('hidden');
    }
  }

  async function startPreview() {
    inPreviewMode = true;
    hideMainForPreview();
    previewArea.classList.remove('hidden');
    previewSummary.innerHTML = '<div class="summary-message">Checking Workday for changes...</div>';
    previewTable.innerHTML = '';
    previewApplyBtn.classList.add('hidden');

    // Show progress in preview area
    progressArea.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressBar.classList.add('indeterminate');
    progressPhase.textContent = 'Connecting to Workday...';

    try {
      await browser.runtime.sendMessage({ type: 'PREVIEW_SYNC' });
      startPolling();
    } catch {
      inPreviewMode = false;
      previewArea.classList.add('hidden');
      progressArea.classList.add('hidden');
      showMainView();
    }
  }

  async function applyPreview() {
    inPreviewMode = false;
    previewArea.classList.add('hidden');
    showMainView();

    // Now start sync
    await startSync();
  }

  // --- Event listeners ---
  syncNowBtn.addEventListener('click', startSync);
  previewLink.addEventListener('click', startPreview);
  previewApplyBtn.addEventListener('click', applyPreview);

  // --- Polling ---

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

  // --- Load synced events count for the label ---
  async function loadSyncedEventsCount() {
    try {
      const response: { success: boolean; entries?: SyncedEventEntry[] } =
        await browser.runtime.sendMessage({ type: 'GET_SYNCED_EVENTS' });
      if (response.success && response.entries) {
        updateSyncedEventsLabel(response.entries.length);
        if (response.entries.length > 0) {
          syncedSection.classList.remove('hidden');
        }
      }
    } catch {
      // ignore
    }
  }

  // --- Init ---
  async function initStatus() {
    try {
      await loadCalendarCount();
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

      // Load auxiliary data
      loadActivityHistory();
      loadAutoSyncStatus();
      loadSyncedEventsCount();
    } catch {
      // Background may not be ready yet — show welcome state
      welcomeCard.classList.remove('hidden');
    }
  }

  initStatus();
}
