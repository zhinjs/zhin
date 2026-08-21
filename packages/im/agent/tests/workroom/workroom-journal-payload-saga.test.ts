import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileWorkroomJournal,
  WorkroomSequenceConflictError,
  createWorkroomJournalPayloadObjectId,
  type WorkroomJournalPayloadPort,
} from '../../src/workroom/journal.js';
import {
  canonicalWorkroomJson,
  digestCanonicalWorkroomValue as digest,
} from '../../src/workroom/canonical-value.js';
import type { GovernedPayloadWriteSagaSnapshot } from '../../src/data-governance/governed-payload-write-saga.js';
import type { WorkroomGovernedPayloadReceipt } from '../../src/workroom/workroom-task-report-store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Workroom Journal governed payload publication saga', () => {
  it('reconciles a durable header after publication acknowledgement is interrupted', async () => {
    const directory = await journalDirectory();
    const payloads = new SagaPayloadPort();
    payloads.failNextPublish = true;
    const journal = new FileWorkroomJournal(directory, payloads);

    await expect(journal.append('run-1', -1, [created('event-1', 'secret title')]))
      .rejects.toThrow('publication acknowledgement interrupted');
    expect(payloads.abandon).not.toHaveBeenCalled();

    await new FileWorkroomJournal(directory, payloads).read('run-1');
    expect(payloads.reconcile).toHaveBeenCalledOnce();
    expect(payloads.reconcile.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project-1', runId: 'run-1', receipts: [{ descriptor: { bytes: 14 } }],
    });
  });

  it('marks a create-only CAS loser for purge without changing the winning header', async () => {
    const directory = await journalDirectory();
    const payloads = new SagaPayloadPort();
    const left = new FileWorkroomJournal(directory, payloads);
    const right = new FileWorkroomJournal(directory, payloads);

    const results = await Promise.allSettled([
      left.append('run-1', -1, [created('event-left', 'left private title')]),
      right.append('run-1', -1, [created('event-right', 'right private title')]),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(WorkroomSequenceConflictError) });
    expect(payloads.abandon).toHaveBeenCalledOnce();
    expect(payloads.abandon.mock.calls[0]?.[0]).toMatchObject({ reason: 'cas_lost' });
    expect(await new FileWorkroomJournal(directory, payloads).read('run-1'))
      .toHaveLength(1);
  });

  it('verifies a durable Journal header without materializing its governed body', async () => {
    const directory = await journalDirectory();
    const payloads = new SagaPayloadPort();
    const journal = new FileWorkroomJournal(directory, payloads);
    await journal.append('run-1', -1, [created('event-1', 'private title')]);
    const receipt = payloads.lastReceipt;
    if (!receipt) throw new Error('fixture did not prepare a governed receipt');
    const verification = await journal.verifyGovernedPayloadPublication!(
      indexedIntent(receipt, 'journal_header', 'run-1'),
    );

    expect(verification).toEqual({
      status: 'exact',
      publicationDigest: payloads.publish.mock.calls[0]?.[0].publicationDigest,
    });
  });
});

class SagaPayloadPort implements WorkroomJournalPayloadPort {
  readonly #values = new Map<string, unknown>();
  failNextPublish = false;
  lastReceipt?: WorkroomGovernedPayloadReceipt;
  readonly abandon = vi.fn<NonNullable<WorkroomJournalPayloadPort['abandon']>>(async () => {});
  readonly reconcile = vi.fn<NonNullable<WorkroomJournalPayloadPort['reconcile']>>(async () => {});
  readonly publish = vi.fn<NonNullable<WorkroomJournalPayloadPort['publish']>>(async () => {
    if (this.failNextPublish) {
      this.failNextPublish = false;
      throw new Error('publication acknowledgement interrupted');
    }
  });

  async write(input: Parameters<WorkroomJournalPayloadPort['write']>[0]) {
    const vaultObjectId = `vault:${digest({ eventId: input.eventId, fieldPath: input.fieldPath })}`;
    this.#values.set(vaultObjectId, structuredClone(input.value));
    const receipt = Object.freeze({
      descriptor: Object.freeze({
        vaultObjectId,
        objectId: createWorkroomJournalPayloadObjectId(input),
        payloadHash: input.contentHash,
        descriptorDigest: digest({ descriptor: input.contentHash }),
        locationManifestDigest: digest({ location: vaultObjectId }),
        bytes: Buffer.byteLength(canonicalWorkroomJson(input.value)),
      }),
      source: Object.freeze({
        kind: 'command' as const,
        ref: input.source.ref,
        digest: input.source.digest,
        bindingDigest: input.source.bindingDigest,
        verification: 'verified' as const,
      }),
    });
    this.lastReceipt = receipt;
    return receipt;
  }

  async read(input: Parameters<WorkroomJournalPayloadPort['read']>[0]) {
    return structuredClone(this.#values.get(input.receipt.descriptor.vaultObjectId));
  }
}

async function journalDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workroom-journal-saga-'));
  roots.push(root);
  const directory = join(root, 'journal');
  await mkdir(directory);
  return directory;
}

function created(eventId: string, title: string) {
  return Object.freeze({
    eventId,
    occurredAt: 100,
    type: 'run.created' as const,
    payload: Object.freeze({ projectId: 'project-1', title }),
  });
}

function indexedIntent(
  receipt: WorkroomGovernedPayloadReceipt,
  consumer: 'journal_header',
  publicationScope: string,
): GovernedPayloadWriteSagaSnapshot {
  return Object.freeze({
    version: 1,
    operationId: 'fixture:publication',
    projectId: 'project-1',
    objectId: receipt.descriptor.objectId,
    payloadHash: receipt.descriptor.payloadHash,
    descriptorDigest: receipt.descriptor.descriptorDigest,
    sourceBindingDigest: receipt.source.bindingDigest,
    consumer,
    publicationScope,
    intentId: 'governed-payload-write:fixture',
    sequence: 2,
    state: 'authority_indexed',
    authorityIndexDigest: digest({ authority: 1 }),
    digest: digest({ intent: 1 }),
  });
}
