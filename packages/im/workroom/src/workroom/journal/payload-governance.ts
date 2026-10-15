import type { WorkroomEvent } from '../kernel-contracts.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from '../canonical-value.js';
import type { WorkroomGovernedPayloadReceipt } from '../workroom-task-report-store.js';
import type {
  GovernedPayloadPublicationVerification,
  GovernedPayloadWriteSagaSnapshot,
} from '../../data-governance/governed-payload-write-saga.js';
import type {
  GovernedWorkroomJournalPayloadReference,
  StoredWorkroomEvent,
  WorkroomJournalPayloadPort,
} from './contracts.js';
import { deriveStoredEventControl } from './stored-event-projection.js';
import { isNonEmptyString, isRecord, validatePayload } from './event-validation.js';
import {
  containsGovernedValue,
  isContentFreeJournalValue,
  isDigest,
  isGovernedJournalPayloadReference,
} from './payload-reference.js';

export async function protectEvents(
  events: readonly WorkroomEvent[],
  projectId: string,
  payloads: WorkroomJournalPayloadPort,
): Promise<readonly StoredWorkroomEvent[]> {
  return Object.freeze(await Promise.all(events.map(async event => Object.freeze({
    ...event,
    version: 3 as const,
    control: deriveStoredEventControl(event),
    payload: await protectValue(event.payload, '$.payload', event, projectId, payloads) as Readonly<Record<string, unknown>>,
  }))));
}

async function protectValue(
  value: unknown,
  fieldPath: string,
  event: WorkroomEvent,
  projectId: string,
  payloads: WorkroomJournalPayloadPort,
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Object.freeze(await Promise.all(value.map((item, index) =>
      protectValue(item, `${fieldPath}[${index}]`, event, projectId, payloads))));
  }
  if (!isRecord(value)) return value;
  const entries: Array<readonly [string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    const path = `${fieldPath}.${key}`;
    if (!isContentFreeJournalValue(event.type, path, child) && containsGovernedValue(child)) {
      const contentHash = digestCanonicalWorkroomValue(child);
      const source = journalPayloadSource(event, path, contentHash);
      const receipt = await payloads.write({
        projectId,
        runId: event.runId,
        eventId: event.eventId,
        eventType: event.type,
        occurredAt: event.occurredAt,
        fieldPath: path,
        value: structuredClone(child),
        contentHash,
        source,
      });
      assertJournalPayloadReceipt(
        receipt,
        createWorkroomJournalPayloadObjectId({
          projectId,
          runId: event.runId,
          eventId: event.eventId,
          eventType: event.type,
          occurredAt: event.occurredAt,
          fieldPath: path,
          contentHash,
        }),
        contentHash,
        source,
      );
      entries.push([key, Object.freeze<GovernedWorkroomJournalPayloadReference>({
        version: 1,
        kind: 'governed_workroom_journal_payload',
        fieldPath: path,
        contentHash,
        receipt,
      })]);
      continue;
    }
    entries.push([key, await protectValue(child, path, event, projectId, payloads)]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

export async function materializeStoredEvents(
  events: readonly StoredWorkroomEvent[],
  payloads: WorkroomJournalPayloadPort,
): Promise<readonly WorkroomEvent[]> {
  assertStoredEventReceiptBindings(events);
  const projectId = storedProjectId(events);
  const materialized = await Promise.all(events.map(async event => {
    const payload = await materializeValue(event.payload, '$.payload', event, projectId, payloads);
    if (!isRecord(payload)) throw new Error('Materialized Workroom Journal payload is invalid');
    validatePayload(event.type, payload, event.sequence);
    const derivedControl = deriveStoredEventControl({ ...event, version: 1, payload });
    const comparableControl = event.type === 'task.blocked'
      && Object.keys(event.control).length === 2
      ? Object.freeze({ taskKey: derivedControl.taskKey, blockerId: derivedControl.blockerId })
      : derivedControl;
    if (canonicalWorkroomJson(event.control) !== canonicalWorkroomJson(comparableControl)) {
      throw new Error('Stored Workroom control projection does not match the governed payload');
    }
    const { control: _control, ...eventHeader } = event;
    return Object.freeze<WorkroomEvent>({
      ...eventHeader,
      version: 1,
      payload: Object.freeze({ ...payload }),
    });
  }));
  return Object.freeze(materialized);
}

export async function reconcileJournalPayloads(
  runId: string,
  events: readonly StoredWorkroomEvent[],
  payloads: WorkroomJournalPayloadPort,
): Promise<void> {
  if (!payloads.reconcile || events.length === 0) return;
  await payloads.reconcile({
    projectId: storedProjectId(events),
    runId,
    receipts: collectGovernedPayloadReceipts(events),
    publicationDigest: journalPublicationDigest(runId, events),
  });
}

export function journalPublicationDigest(
  runId: string,
  events: readonly StoredWorkroomEvent[],
): string {
  return digestCanonicalWorkroomValue({
    version: 1,
    runId,
    eventHeaders: events.map(event => ({
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type,
      control: event.control,
      payload: event.payload,
    })),
  });
}

export function verifyJournalPayloadPublication(
  intent: GovernedPayloadWriteSagaSnapshot,
  events: readonly StoredWorkroomEvent[],
): GovernedPayloadPublicationVerification {
  if (intent.consumer !== 'journal_header') return deepFreeze({ status: 'unknown' as const });
  const runId = intent.publicationScope;
  if (!runId || events.length === 0 || events.some(event => event.runId !== runId)) {
    return deepFreeze({ status: 'missing' as const });
  }
  const exact = collectGovernedPayloadReceipts(events).some(receipt =>
    receipt.descriptor.objectId === intent.objectId
    && receipt.descriptor.payloadHash === intent.payloadHash
    && receipt.descriptor.descriptorDigest === intent.descriptorDigest
    && receipt.source.bindingDigest === intent.sourceBindingDigest);
  return exact
    ? deepFreeze({
        status: 'exact' as const,
        publicationDigest: journalPublicationDigest(runId, events),
      })
    : deepFreeze({ status: 'missing' as const });
}

export function collectGovernedPayloadReceipts(
  events: readonly StoredWorkroomEvent[],
): readonly WorkroomGovernedPayloadReceipt[] {
  const receipts: WorkroomGovernedPayloadReceipt[] = [];
  const visit = (value: unknown): void => {
    if (isGovernedJournalPayloadReference(value)) {
      receipts.push(value.receipt);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item);
    }
  };
  for (const event of events) visit(event.payload);
  return Object.freeze(receipts);
}

async function materializeValue(
  value: unknown,
  fieldPath: string,
  event: StoredWorkroomEvent,
  projectId: string,
  payloads: WorkroomJournalPayloadPort,
): Promise<unknown> {
  if (isGovernedJournalPayloadReference(value)) {
    if (value.fieldPath !== fieldPath) throw new Error('Governed Workroom Journal payload field binding drift');
    const source = journalPayloadSource(event, fieldPath, value.contentHash);
    assertJournalPayloadReceipt(
      value.receipt,
      createWorkroomJournalPayloadObjectId({
        projectId,
        runId: event.runId,
        eventId: event.eventId,
        eventType: event.type,
        occurredAt: event.occurredAt,
        fieldPath,
        contentHash: value.contentHash,
      }),
      value.contentHash,
      source,
    );
    const materialized = await payloads.read({
      projectId,
      runId: event.runId,
      eventId: event.eventId,
      eventType: event.type,
      fieldPath,
      contentHash: value.contentHash,
      receipt: value.receipt,
      purpose: 'kernel-replay',
    });
    if (digestCanonicalWorkroomValue(materialized) !== value.contentHash) {
      throw new Error('Governed Workroom Journal payload content hash mismatch');
    }
    if (Buffer.byteLength(canonicalWorkroomJson(materialized)) !== value.receipt.descriptor.bytes) {
      throw new Error('Governed Workroom Journal payload byte length mismatch');
    }
    return materialized;
  }
  if (Array.isArray(value)) {
    return Object.freeze(await Promise.all(value.map((item, index) =>
      materializeValue(item, `${fieldPath}[${index}]`, event, projectId, payloads))));
  }
  if (!isRecord(value)) return value;
  return Object.freeze(Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [
    key,
    await materializeValue(child, `${fieldPath}.${key}`, event, projectId, payloads),
  ]))));
}

export function projectIdForAppend(
  current: readonly StoredWorkroomEvent[],
  appended: readonly WorkroomEvent[],
): string {
  if (current.length > 0) return storedProjectId(current);
  const created = appended[0];
  if (!created || created.type !== 'run.created' || !isNonEmptyString(created.payload.projectId)) {
    throw new Error('Workroom Journal first append must begin with a Project-bound run.created event');
  }
  return created.payload.projectId;
}

export function storedProjectId(events: readonly StoredWorkroomEvent[]): string {
  const created = events[0];
  if (!created || created.type !== 'run.created' || !isNonEmptyString(created.payload.projectId)) {
    throw new Error('Stored Workroom Journal has no Project-bound run.created header');
  }
  return created.payload.projectId;
}

export function journalPayloadSource(
  event: Pick<WorkroomEvent, 'runId' | 'eventId' | 'type'>,
  fieldPath: string,
  contentHash: string,
) {
  const ref = `workroom-journal-event:${event.runId}:${event.eventId}:${fieldPath}`;
  const sourceBody = Object.freeze({
    version: 1 as const,
    runId: event.runId,
    eventId: event.eventId,
    eventType: event.type,
    fieldPath,
    contentHash,
  });
  const sourceDigest = digestCanonicalWorkroomValue(sourceBody);
  return Object.freeze({
    ref,
    digest: sourceDigest,
    bindingDigest: digestCanonicalWorkroomValue({ ref, sourceDigest, ...sourceBody }),
  });
}

export function assertJournalPayloadReceipt(
  receipt: WorkroomGovernedPayloadReceipt,
  objectId: string,
  contentHash: string,
  source: ReturnType<typeof journalPayloadSource>,
): void {
  if (!receipt || !isRecord(receipt.descriptor) || !isRecord(receipt.source)
    || !isNonEmptyString(receipt.descriptor.vaultObjectId)
    || receipt.descriptor.objectId !== objectId
    || receipt.descriptor.payloadHash !== contentHash
    || !isDigest(receipt.descriptor.descriptorDigest)
    || !isDigest(receipt.descriptor.locationManifestDigest)
    || !Number.isSafeInteger(receipt.descriptor.bytes) || Number(receipt.descriptor.bytes) < 0
    || receipt.source.kind !== 'command'
    || receipt.source.ref !== source.ref
    || receipt.source.digest !== source.digest
    || receipt.source.bindingDigest !== source.bindingDigest
    || receipt.source.verification !== 'verified') {
    throw new Error('Governed Workroom Journal payload receipt is forged or incomplete');
  }
}

export function assertStoredEventReceiptBindings(events: readonly StoredWorkroomEvent[]): void {
  if (events.length === 0) return;
  const projectId = storedProjectId(events);
  const visit = (value: unknown, fieldPath: string, event: StoredWorkroomEvent): void => {
    if (isGovernedJournalPayloadReference(value)) {
      if (value.fieldPath !== fieldPath) {
        throw new Error('Governed Workroom Journal payload field binding drift');
      }
      const source = journalPayloadSource(event, fieldPath, value.contentHash);
      assertJournalPayloadReceipt(
        value.receipt,
        createWorkroomJournalPayloadObjectId({
          projectId,
          runId: event.runId,
          eventId: event.eventId,
          eventType: event.type,
          occurredAt: event.occurredAt,
          fieldPath,
          contentHash: value.contentHash,
        }),
        value.contentHash,
        source,
      );
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${fieldPath}[${index}]`, event));
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, `${fieldPath}.${key}`, event);
      }
    }
  };
  for (const event of events) visit(event.payload, '$.payload', event);
}

export function createWorkroomJournalPayloadObjectId(input: Readonly<{
  projectId: string;
  runId: string;
  eventId: string;
  eventType: WorkroomEvent['type'];
  occurredAt: number;
  fieldPath: string;
  contentHash: string;
}>): string {
  return `workroom-journal-payload:${digestCanonicalWorkroomValue({
    version: 2,
    projectId: input.projectId,
    runId: input.runId,
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    fieldPath: input.fieldPath,
    contentHash: input.contentHash,
  })}`;
}
