/**
 * Represents a preview of what a sync operation will do,
 * without actually modifying any state or calendar.
 */
export interface SyncPreview {
  entries: SyncPreviewEntry[];
}

export interface SyncPreviewEntry {
  date: string;
  dayOfWeek: string;
  type: string;
  hours: number;
  status: string;
  action: 'create' | 'skip' | 'delete' | 'resync';
  actionReason: string;
}

/**
 * Summarizes a preview into action counts.
 */
export function summarizePreview(preview: SyncPreview): {
  creates: number;
  skips: number;
  deletes: number;
  resyncs: number;
} {
  let creates = 0;
  let skips = 0;
  let deletes = 0;
  let resyncs = 0;

  for (const entry of preview.entries) {
    switch (entry.action) {
      case 'create':
        creates++;
        break;
      case 'skip':
        skips++;
        break;
      case 'delete':
        deletes++;
        break;
      case 'resync':
        resyncs++;
        break;
    }
  }

  return { creates, skips, deletes, resyncs };
}
