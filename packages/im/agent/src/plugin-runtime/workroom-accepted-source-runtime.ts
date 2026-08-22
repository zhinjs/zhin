import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createToken } from '@zhin.js/plugin-runtime';
import {
  AcceptedSourceMemoryApplication,
  replayProjectMemoryApplication,
  type ProjectMemoryApplicationRepository,
  type WorkroomAcceptedReportReader,
  type WorkroomContextReleaseEligibility,
  type WorkroomProjectMemorySnapshot,
} from '../workroom/accepted-source-memory-application.js';
import type { WorkroomAcceptanceRecord } from '../workroom/acceptance-policy.js';
import type { WorkroomProjectMemorySchemaSnapshot } from '../workroom/accepted-source-projector.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import type { WorkroomEvent } from '../workroom/kernel-contracts.js';
import type { WorkroomJournal } from '../workroom/journal.js';

export interface WorkroomProjectMemorySchemaAuthorityPort {
  resolve(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    acceptance: WorkroomAcceptanceRecord;
  }>): Promise<WorkroomProjectMemorySchemaSnapshot>;
}

export interface WorkroomContextReleaseRequest {
  readonly operationId: string;
  readonly eligibility: WorkroomContextReleaseEligibility;
}

export interface WorkroomContextReleaseReceipt {
  readonly status: 'released' | 'outcome_unknown';
  readonly operationId: string;
  readonly receiptRef: string;
  readonly digest: string;
}

export interface WorkroomExecutionContextReleasePort {
  /** Must be idempotent for operationId; unknown outcomes are reconciled with the same id. */
  release(input: WorkroomContextReleaseRequest): Promise<WorkroomContextReleaseReceipt>;
}

export interface WorkroomContextReleaseJournal {
  isReleased(operationId: string): Promise<boolean>;
  begin(request: WorkroomContextReleaseRequest): Promise<void>;
  record(
    request: WorkroomContextReleaseRequest,
    receipt: WorkroomContextReleaseReceipt,
  ): Promise<void>;
  listReconciling(): Promise<readonly WorkroomContextReleaseRequest[]>;
}

export const workroomProjectMemorySchemaAuthorityToken =
  createToken<WorkroomProjectMemorySchemaAuthorityPort>(
    'zhin.agent.workroom-project-memory-schema-authority',
    'Generation/Profile-owned exact Project Memory Schema authority',
  );
export const workroomAcceptedReportReaderToken = createToken<WorkroomAcceptedReportReader>(
  'zhin.agent.workroom-accepted-report-reader',
  'Governed structured Task Report reader for Acceptance and Accepted Source projection',
);
export const workroomExecutionContextReleaseToken = createToken<WorkroomExecutionContextReleasePort>(
  'zhin.agent.workroom-execution-context-release',
  'Idempotent Execution Context release after accepted-source application',
);
export const workroomAcceptedSourceRecallToken = createToken<WorkroomAcceptedSourceRecallPort>(
  'zhin.agent.workroom-accepted-source-recall',
  'Project-scoped accepted Task Memory and Project State recall',
);
export const workroomAcceptedSourceRuntimeToken = createToken<WorkroomAcceptedSourceRuntime>(
  'zhin.agent.workroom-accepted-source-runtime',
  'Generation-owned durable task.accepted projector and Context release reconciler',
);

export interface WorkroomAcceptedSourceRecallPort {
  recall(projectId: string): Promise<WorkroomProjectMemorySnapshot>;
}

interface ReleaseIntentRecord extends WorkroomContextReleaseRequest {
  readonly version: 1;
  readonly digest: string;
}

/** Content-free durable outbox. Project Memory is never rolled back on release uncertainty. */
export class FileWorkroomContextReleaseJournal implements WorkroomContextReleaseJournal {
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async isReleased(operationId: string): Promise<boolean> {
    try {
      await readFile(join(this.directory, `${operationKey(operationId)}.released.json`));
      return true;
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return false;
      throw error;
    }
  }

  async record(
    request: WorkroomContextReleaseRequest,
    receipt: WorkroomContextReleaseReceipt,
  ): Promise<void> {
    assertReleaseReceipt(receipt, request.operationId);
    await this.begin(request);
    await this.#store.ensureDurableLeaf('Workroom Context Release Journal');
    const suffix = receipt.status === 'released'
      ? 'released'
      : `unknown.${receipt.digest.slice('sha256:'.length)}`;
    const body = deepFreeze({ version: 1 as const, operationId: request.operationId, receipt });
    await this.#store.publishCreateOnly({
      target: join(this.directory, `${operationKey(request.operationId)}.${suffix}.json`),
      content: canonicalWorkroomJson(body),
      createdValue: body,
      onConflict: async () => {
        const existing = JSON.parse(await readFile(
          join(this.directory, `${operationKey(request.operationId)}.${suffix}.json`),
          'utf8',
        )) as unknown;
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(body)) {
          throw new Error('Workroom Context Release receipt identity drift');
        }
        return body;
      },
    });
  }

  async begin(request: WorkroomContextReleaseRequest): Promise<void> {
    const intent = releaseIntent(request);
    await this.#store.ensureDurableLeaf('Workroom Context Release Journal');
    await this.#store.publishCreateOnly({
      target: join(this.directory, `${operationKey(request.operationId)}.intent.json`),
      content: canonicalWorkroomJson(intent),
      createdValue: intent,
      onConflict: async () => parseIntent(await readFile(
        join(this.directory, `${operationKey(request.operationId)}.intent.json`), 'utf8',
      ), request.operationId),
    });
  }

  async listReconciling(): Promise<readonly WorkroomContextReleaseRequest[]> {
    let names: readonly string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const intents = names.filter(name => name.endsWith('.intent.json')).sort();
    const result: WorkroomContextReleaseRequest[] = [];
    for (const name of intents) {
      const intent = parseIntent(await readFile(join(this.directory, name), 'utf8'));
      if (!await this.isReleased(intent.operationId)) {
        result.push(deepFreeze({ operationId: intent.operationId, eligibility: intent.eligibility }));
      }
    }
    return Object.freeze(result);
  }
}

export interface WorkroomAcceptedSourceRuntimeOptions {
  readonly journal: Pick<WorkroomJournal, 'listRunIds' | 'read'>;
  readonly repository: ProjectMemoryApplicationRepository;
  readonly reports: WorkroomAcceptedReportReader;
  readonly schemas: WorkroomProjectMemorySchemaAuthorityPort;
  readonly release: WorkroomExecutionContextReleasePort;
  readonly releases: WorkroomContextReleaseJournal;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export interface WorkroomAcceptedSourceDrainResult {
  readonly applied: number;
  readonly released: number;
  readonly reconciling: number;
}

export class WorkroomAcceptedSourceRuntime implements WorkroomAcceptedSourceRecallPort {
  readonly #application: AcceptedSourceMemoryApplication;
  readonly #intervalMs: number;
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<WorkroomAcceptedSourceDrainResult>;
  #stopped = false;

  constructor(readonly options: WorkroomAcceptedSourceRuntimeOptions) {
    this.#intervalMs = positive(options.intervalMs ?? 1_000, 'intervalMs');
    this.#application = new AcceptedSourceMemoryApplication({
      kernel: options.journal as WorkroomJournal,
      repository: options.repository,
      reports: options.reports,
      schemas: {
        read: async input => {
          const current = this.#activeSchema;
          if (!current || current.revision !== input.revision || current.digest !== input.digest) return undefined;
          return current;
        },
      },
    });
  }

  #activeSchema?: WorkroomProjectMemorySchemaSnapshot;

  start(): void {
    if (this.#stopped) throw new Error('Accepted Source Runtime is stopped');
    if (this.#timer) return;
    this.#schedule(0);
  }

  async drain(): Promise<WorkroomAcceptedSourceDrainResult> {
    if (this.#stopped) throw new Error('Accepted Source Runtime is stopped');
    if (this.#running) return await this.#running;
    const operation = this.#drain();
    this.#running = operation;
    try { return await operation; } finally {
      if (this.#running === operation) this.#running = undefined;
    }
  }

  async recall(projectId: string): Promise<WorkroomProjectMemorySnapshot> {
    return await this.#application.recall(projectId);
  }

  async dispose(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  async #drain(): Promise<WorkroomAcceptedSourceDrainResult> {
    let applied = 0;
    let released = 0;
    let reconciling = 0;
    for (const source of await acceptedSources(this.options.journal)) {
      const before = replayProjectMemoryApplication(
        source.projectId,
        await this.options.repository.read(source.projectId),
      );
      const existed = before.receipts.some(receipt =>
        receipt.runId === source.runId && receipt.sourceSequence === source.event.sequence);
      const schema = await this.options.schemas.resolve({
        projectId: source.projectId,
        runId: source.runId,
        taskKey: source.taskKey,
        acceptance: source.acceptance,
      });
      this.#activeSchema = schema;
      let receipt;
      try {
        receipt = await this.#application.apply({
          projectId: source.projectId,
          runId: source.runId,
          taskKey: source.taskKey,
          kernelSequence: source.event.sequence,
          expectedStateRevision: before.stateRevision,
          schemaRevision: schema.revision,
          schemaDigest: schema.digest,
        });
      } finally {
        this.#activeSchema = undefined;
      }
      if (!existed) applied += 1;
      const operationId = `context-release-operation:${digest(receipt.contextRelease)}`;
      if (await this.options.releases.isReleased(operationId)) continue;
      const request = deepFreeze({ operationId, eligibility: receipt.contextRelease });
      await this.options.releases.begin(request);
      const releaseReceipt = await this.options.release.release(request);
      await this.options.releases.record(request, releaseReceipt);
      if (releaseReceipt.status === 'released') released += 1;
      else reconciling += 1;
    }
    return deepFreeze({ applied, released, reconciling });
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#stopped) return;
      void this.drain().catch(error => this.options.onError?.(error)).finally(() => {
        if (!this.#stopped) this.#schedule(this.#intervalMs);
      });
    }, delay);
    this.#timer.unref?.();
  }
}

async function acceptedSources(journal: Pick<WorkroomJournal, 'listRunIds' | 'read'>) {
  const result: Array<Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    acceptance: WorkroomAcceptanceRecord;
    event: WorkroomEvent;
  }>> = [];
  for (const runId of [...await journal.listRunIds()].sort()) {
    const events = await journal.read(runId);
    const projectId = String(events[0]?.payload.projectId ?? '');
    if (!projectId) continue;
    for (const event of events) {
      if (event.type !== 'task.accepted') continue;
      result.push(deepFreeze({
        projectId,
        runId,
        taskKey: String(event.payload.taskKey ?? ''),
        acceptance: event.payload.record as WorkroomAcceptanceRecord,
        event,
      }));
    }
  }
  return Object.freeze(result.sort((left, right) =>
    compareCanonicalWorkroomText(left.projectId, right.projectId)
    || left.event.occurredAt - right.event.occurredAt
    || compareCanonicalWorkroomText(left.runId, right.runId)
    || left.event.sequence - right.event.sequence));
}

function releaseIntent(request: WorkroomContextReleaseRequest): ReleaseIntentRecord {
  required(request.operationId, 'Context Release operationId');
  const body = deepFreeze({ version: 1 as const, ...request });
  return deepFreeze({ ...body, digest: digest(body) });
}

function parseIntent(serialized: string, operationId?: string): ReleaseIntentRecord {
  const value = JSON.parse(serialized) as ReleaseIntentRecord;
  const canonical = releaseIntent({ operationId: value.operationId, eligibility: value.eligibility });
  if ((operationId && canonical.operationId !== operationId)
    || canonical.digest !== value.digest
    || canonicalWorkroomJson(canonical) !== canonicalWorkroomJson(value)) {
    throw new Error('Workroom Context Release intent drift');
  }
  return canonical;
}

function assertReleaseReceipt(receipt: WorkroomContextReleaseReceipt, operationId: string): void {
  if (receipt.operationId !== operationId
    || (receipt.status !== 'released' && receipt.status !== 'outcome_unknown')) {
    throw new Error('Workroom Context Release receipt binding drift');
  }
  required(receipt.receiptRef, 'Context Release receipt ref');
  requiredDigest(receipt.digest, 'Context Release receipt digest');
}

function operationKey(operationId: string): string {
  return digest({ operationId }).slice('sha256:'.length);
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
