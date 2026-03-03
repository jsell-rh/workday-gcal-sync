export type DomainEvent =
  | SyncStarted
  | EntriesParsed
  | EntrySkipped
  | CalendarEventCreated
  | CalendarEventAlreadyExists
  | SyncCompleted
  | SyncFailed;

export interface SyncStarted {
  readonly type: 'SyncStarted';
  readonly timestamp: string;
  readonly source: string;
}

export interface EntriesParsed {
  readonly type: 'EntriesParsed';
  readonly timestamp: string;
  readonly count: number;
  readonly syncableCount: number;
}

export interface EntrySkipped {
  readonly type: 'EntrySkipped';
  readonly timestamp: string;
  readonly date: string;
  readonly reason: string;
}

export interface CalendarEventCreated {
  readonly type: 'CalendarEventCreated';
  readonly timestamp: string;
  readonly date: string;
  readonly summary: string;
}

export interface CalendarEventAlreadyExists {
  readonly type: 'CalendarEventAlreadyExists';
  readonly timestamp: string;
  readonly date: string;
}

export interface SyncCompleted {
  readonly type: 'SyncCompleted';
  readonly timestamp: string;
  readonly entriesSynced: number;
  readonly entriesSkipped: number;
}

export interface SyncFailed {
  readonly type: 'SyncFailed';
  readonly timestamp: string;
  readonly error: string;
}

export function createDomainEvent<T extends DomainEvent['type']>(
  type: T,
  data: Omit<Extract<DomainEvent, { type: T }>, 'type' | 'timestamp'>,
): Extract<DomainEvent, { type: T }> {
  return {
    type,
    timestamp: new Date().toISOString(),
    ...data,
  } as Extract<DomainEvent, { type: T }>;
}
