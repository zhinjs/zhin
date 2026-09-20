import type { WorkroomBlocker, WorkroomBlockerKind, WorkroomEvent, WorkroomEventDraft } from '../kernel-contracts.js';
import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from '../canonical-value.js';
import type { WorkroomGovernedPayloadReceipt } from '../workroom-task-report-store.js';
import type { LegacyEmbeddedPayloadRecord } from '../legacy-embedded-payload-migration.js';
import type {
  StoredWorkroomEvent,
  WorkroomAssignmentRoleHeader,
  WorkroomStoredEventControl,
  WorkroomStoredEventHeader,
  WorkroomStoredProtectedReceiptHeader,
  WorkroomStoredRunHeaders,
} from './contracts.js';
import {
  assertExactRecordKeys,
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  isSequence,
  isWorkroomEventType,
  validatePayload,
} from './event-validation.js';
import {
  isDigest,
  legacyJournalPayloadError,
  validateProtectedPayload,
} from './payload-reference.js';
import {
  deriveStoredEventControl,
  storedProtectedReceiptHeaders,
  validateStoredEventControl,
} from './stored-event-projection.js';
import { assertStoredEventReceiptBindings } from './payload-governance.js';

export function legacyDatabaseJournalRecords(
  rows: readonly Record<string, unknown>[],
): readonly LegacyEmbeddedPayloadRecord[] {
  return Object.freeze(rows.map(row => {
    let envelope: unknown;
    try {
      envelope = JSON.parse(String(row.payload_json)) as unknown;
    } catch {
      throw new Error('Legacy Workroom Journal database payload is corrupt or unknown');
    }
    return Object.freeze({
      storage: 'database' as const,
      sourceKind: 'journal' as const,
      recordRef: `workroom-events:${digestCanonicalWorkroomValue({
        runId: String(row.run_id),
        sequence: row.sequence,
      })}`,
      value: Object.freeze({ version: row.version, envelope }),
    });
  }));
}

export function materializeEvents(
  runId: string,
  expectedSequence: number,
  drafts: readonly WorkroomEventDraft[],
): readonly WorkroomEvent[] {
  if (!isNonEmptyString(runId) || !Number.isSafeInteger(expectedSequence) || expectedSequence < -1) {
    throw new Error('Invalid Workroom append position');
  }
  return Object.freeze(drafts.map<WorkroomEvent>((draft, index) => {
    if (!isNonEmptyString(draft.eventId) || !isFiniteNumber(draft.occurredAt)
      || !isWorkroomEventType(draft.type) || !isRecord(draft.payload)) {
      throw new Error('Invalid Workroom event draft');
    }
    validatePayload(draft.type, draft.payload, expectedSequence + index + 1);
    return Object.freeze({
      ...draft,
      version: 1,
      runId,
      sequence: expectedSequence + index + 1,
      payload: Object.freeze({ ...draft.payload }),
    });
  }));
}

export function parseStoredEvents(values: readonly unknown[]): readonly StoredWorkroomEvent[] {
  const events = values.map((value): StoredWorkroomEvent => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid Workroom journal event');
    }
    const raw = value as Record<string, unknown>;
    if (raw.version === 1 || raw.version === 2) throw legacyJournalPayloadError();
    assertExactRecordKeys(raw, [
      'version', 'eventId', 'runId', 'sequence', 'occurredAt', 'type', 'control', 'payload',
    ], 'Stored Workroom event');
    const event = value as Partial<StoredWorkroomEvent>;
    if (event.version !== 3 || !isNonEmptyString(event.eventId) || !isNonEmptyString(event.runId)
      || !isSequence(event.sequence) || !isFiniteNumber(event.occurredAt)
      || !isWorkroomEventType(event.type) || !isRecord(event.control) || !isRecord(event.payload)) {
      throw new Error('Invalid Workroom journal event');
    }
    validateStoredEventControl(event.type, event.control);
    validateProtectedPayload(event.type, event.payload);
    const sequence = Number(event.sequence);
    return Object.freeze({
      ...event,
      version: 3,
      eventId: event.eventId,
      runId: event.runId,
      sequence,
      occurredAt: event.occurredAt,
      type: event.type,
      control: deepFreeze({ ...event.control }),
      payload: Object.freeze({ ...event.payload }),
    });
  });
  return Object.freeze(events.sort((left, right) => left.sequence - right.sequence));
}

export function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

export function isSegmentName(name: string): boolean {
  return /^[a-f0-9]{64}\.[0-9]{16}\.json$/u.test(name);
}

export function isSegmentTemporaryName(name: string): boolean {
  return /^[a-f0-9]{64}\.[0-9]{16}\.json\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/u
    .test(name);
}

export function segmentFirstSequence(name: string): number {
  if (!isSegmentName(name)) throw new Error('Invalid Workroom journal segment name');
  const value = Number(name.slice(65, 81));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid Workroom journal segment first sequence');
  }
  return value;
}

export function toRow(event: StoredWorkroomEvent): Record<string, unknown> {
  const storedEventDigest = digestStoredWorkroomEvent(event);
  const row: Record<string, unknown> = {
    id: `${event.runId}:${event.sequence}`,
    run_id: event.runId,
    sequence: event.sequence,
    version: event.version,
    type: event.type,
    payload_json: canonicalWorkroomJson({
      eventId: event.eventId,
      control: event.control,
      payload: event.payload,
    }),
    occurred_at: event.occurredAt,
    stored_event_digest: storedEventDigest,
  };
  return { ...row, row_binding_digest: digestWorkroomEventRowBinding(row) };
}

export function parseStoredRows(runId: string, rows: readonly Record<string, unknown>[]): readonly StoredWorkroomEvent[] {
  const events = rows.map(row => {
    if (row.version === 1 || row.version === 2) throw legacyJournalPayloadError();
    if (!isDigest(row.stored_event_digest) || !isDigest(row.row_binding_digest)) {
      throw legacyJournalPayloadError();
    }
    if (row.version !== 3) throw new Error(`Unsupported Workroom event version: ${String(row.version)}`);
    let envelope: { eventId?: unknown; control?: unknown; payload?: unknown };
    try {
      envelope = JSON.parse(String(row.payload_json)) as typeof envelope;
    } catch {
      throw new Error('Invalid Workroom event payload JSON');
    }
    if (!envelope || !isNonEmptyString(envelope.eventId) || !isRecord(envelope.control)
      || !isRecord(envelope.payload)
      || !isSequence(row.sequence) || !isFiniteNumber(row.occurred_at)
      || !isWorkroomEventType(row.type)) {
      throw new Error('Invalid Workroom event payload envelope');
    }
    assertExactRecordKeys(envelope, ['eventId', 'control', 'payload'], 'Workroom event payload envelope');
    const expectedId = `${runId}:${Number(row.sequence)}`;
    if (row.id !== expectedId) throw new Error('Workroom event row id binding is invalid');
    if (String(row.payload_json) !== canonicalWorkroomJson(envelope)) {
      throw new Error('Workroom event payload JSON is not canonical');
    }
    validateStoredEventControl(row.type, envelope.control);
    validateProtectedPayload(row.type, envelope.payload);
    const event = Object.freeze<StoredWorkroomEvent>({
      version: 3 as const,
      eventId: envelope.eventId,
      runId,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      type: row.type,
      control: deepFreeze({ ...envelope.control }),
      payload: Object.freeze({ ...envelope.payload }),
    });
    if (row.stored_event_digest !== digestStoredWorkroomEvent(event)) {
      throw new Error('Workroom stored event digest mismatch');
    }
    if (row.row_binding_digest !== digestWorkroomEventRowBinding(row)) {
      throw new Error('Workroom event row binding digest mismatch');
    }
    return event;
  }).sort((left, right) => left.sequence - right.sequence);
  const stored = Object.freeze(events);
  if (stored.length > 0) assertStoredEventReceiptBindings(stored);
  return stored;
}

export function parseStoredRowGroups(
  rows: readonly Record<string, unknown>[],
): ReadonlyMap<string, readonly StoredWorkroomEvent[]> {
  const rowGroups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const runId = String(row.run_id ?? '');
    if (!isNonEmptyString(runId)) throw new Error('Invalid Workroom event Run id');
    rowGroups.set(runId, [...(rowGroups.get(runId) ?? []), row]);
  }
  return new Map([...rowGroups.entries()]
    .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
    .map(([runId, runRows]) => [runId, parseStoredRows(runId, runRows)] as const));
}

export function digestStoredWorkroomEvent(event: Readonly<{
  version: 3;
  eventId: string;
  runId: string;
  sequence: number;
  occurredAt: number;
  type: WorkroomEvent['type'];
  control: WorkroomStoredEventControl;
  payload: Readonly<Record<string, unknown>>;
}>): string {
  return digestCanonicalWorkroomValue({
    version: event.version,
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.type,
    control: event.control,
    payload: event.payload,
  });
}

export function digestWorkroomEventRowBinding(row: Readonly<Record<string, unknown>>): string {
  return digestCanonicalWorkroomValue({
    version: 1,
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    storedVersion: row.version,
    type: row.type,
    payloadJson: row.payload_json,
    occurredAt: row.occurred_at,
    storedEventDigest: row.stored_event_digest,
  });
}

export function storedRunHeaders(
  runId: string,
  values: readonly StoredWorkroomEvent[],
): WorkroomStoredRunHeaders {
  if (!isNonEmptyString(runId) || values.length === 0
    || values.some((event, index) => event.runId !== runId || event.sequence !== index)) {
    throw new Error('Stored Workroom Journal header sequence or Run binding is invalid');
  }
  assertStoredEventReceiptBindings(values);
  const events = values.map((event): WorkroomStoredEventHeader => {
    const protectedPayloadDigest = digestCanonicalWorkroomValue(event.payload);
    const body = deepFreeze({
      version: 1 as const,
      eventRef: `workroom-event:${digestCanonicalWorkroomValue({
        runId, eventId: event.eventId, sequence: event.sequence,
      })}`,
      runId,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      type: event.type,
      control: event.control,
      protectedPayloadDigest,
      protectedReceipts: storedProtectedReceiptHeaders(event.payload),
    });
    return deepFreeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
  });
  const body = deepFreeze({ version: 1 as const, runId, events });
  return deepFreeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
}
