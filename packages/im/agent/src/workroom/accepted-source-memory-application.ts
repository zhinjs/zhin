import {
  assertPersistedAcceptanceRecord,
  type WorkroomAcceptanceRecord,
} from './acceptance-policy.js';
import {
  projectAcceptedTaskMemory,
  type WorkroomAcceptedProjectStateClaim,
  type WorkroomAcceptedSourceProjection,
  type WorkroomAcceptedTaskMemory,
  type WorkroomProjectMemorySchemaSnapshot,
  type WorkroomStructuredTaskReport,
} from './accepted-source-projector.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import type { WorkroomJournal } from './journal.js';

export interface WorkroomAcceptedReportReadInput {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly reportRef: string;
  readonly candidateHash: string;
  readonly purpose?: 'accepted-source-memory-projector' | 'acceptance-evaluation' | 'acceptance-review';
}

export interface WorkroomAcceptedReportReader {
  read(input: WorkroomAcceptedReportReadInput): Promise<WorkroomStructuredTaskReport | undefined>;
}

export interface WorkroomProjectMemorySchemaReadInput {
  readonly projectId: string;
  readonly revision: number;
  readonly digest: string;
}

export interface WorkroomProjectMemorySchemaReader {
  read(
    input: WorkroomProjectMemorySchemaReadInput,
  ): Promise<WorkroomProjectMemorySchemaSnapshot | undefined>;
}

export type WorkroomProjectFactStatus = 'verified' | 'assumed' | 'disputed' | 'stale';

export interface WorkroomProjectMemoryFact extends Omit<WorkroomAcceptedProjectStateClaim, 'status'> {
  readonly status: WorkroomProjectFactStatus;
  readonly acceptedStatus: 'verified' | 'assumed';
  readonly appliedAtStateRevision: number;
}

export interface WorkroomContextReleaseEligibility {
  readonly eligible: true;
  readonly ref: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly sourceAcceptanceId: string;
  readonly sourceHash: string;
  readonly taskMemoryId: string;
  readonly statePatchId: string;
  readonly stateRevision: number;
}

export interface WorkroomAcceptedSourceApplicationReceipt {
  readonly status: 'applied';
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly sourceSequence: number;
  readonly stateRevision: number;
  readonly sourceHash: string;
  readonly contextRelease: WorkroomContextReleaseEligibility;
}

export interface WorkroomProjectMemorySnapshot {
  readonly projectId: string;
  readonly stateRevision: number;
  readonly sourceSequencesByRun: Readonly<Record<string, number>>;
  readonly facts: readonly WorkroomProjectMemoryFact[];
  readonly taskMemories: readonly WorkroomAcceptedTaskMemory[];
  readonly receipts: readonly WorkroomAcceptedSourceApplicationReceipt[];
}

export interface WorkroomAcceptedSourceApplicationEvent {
  readonly version: 1;
  readonly projectId: string;
  readonly stateRevision: number;
  readonly type: 'accepted_source.applied';
  readonly projectionDigest: string;
  readonly projection: WorkroomAcceptedSourceProjection;
  readonly receipt: WorkroomAcceptedSourceApplicationReceipt;
}

export interface ProjectMemoryApplicationRepository {
  read(projectId: string): Promise<readonly WorkroomAcceptedSourceApplicationEvent[]>;
  append(
    projectId: string,
    expectedStateRevision: number,
    projection: WorkroomAcceptedSourceProjection,
  ): Promise<WorkroomAcceptedSourceApplicationEvent>;
}

export class ProjectMemoryStateRevisionConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly expectedStateRevision: number,
    readonly actualStateRevision: number,
  ) {
    super(
      `Project Memory ${projectId} state revision conflict: expected `
      + `${expectedStateRevision}, actual ${actualStateRevision}`,
    );
    this.name = 'ProjectMemoryStateRevisionConflictError';
  }
}

export class MemoryProjectMemoryApplicationRepository implements ProjectMemoryApplicationRepository {
  readonly #projects = new Map<string, readonly WorkroomAcceptedSourceApplicationEvent[]>();

  async read(projectId: string): Promise<readonly WorkroomAcceptedSourceApplicationEvent[]> {
    return this.#projects.get(canonicalId(projectId, 'projectId')) ?? Object.freeze([]);
  }

  async append(
    projectId: string,
    expectedStateRevision: number,
    projection: WorkroomAcceptedSourceProjection,
  ): Promise<WorkroomAcceptedSourceApplicationEvent> {
    const id = canonicalId(projectId, 'projectId');
    assertStateRevision(expectedStateRevision);
    const current = await this.read(id);
    const replay = findExactProjectMemoryApplicationReplay(current, projection);
    if (replay) return replay;
    const actual = current.at(-1)?.stateRevision ?? 0;
    if (actual !== expectedStateRevision) {
      throw new ProjectMemoryStateRevisionConflictError(id, expectedStateRevision, actual);
    }
    const event = createProjectMemoryApplicationEvent(id, expectedStateRevision + 1, projection);
    replayProjectMemoryApplication(id, Object.freeze([...current, event]));
    this.#projects.set(id, Object.freeze([...current, event]));
    return event;
  }
}

export interface ApplyAcceptedSourceMemoryInput {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly kernelSequence: number;
  readonly expectedStateRevision: number;
  readonly schemaRevision: number;
  readonly schemaDigest: string;
}

export interface AcceptedSourceMemoryApplicationOptions {
  readonly kernel: WorkroomJournal;
  readonly repository: ProjectMemoryApplicationRepository;
  readonly reports: WorkroomAcceptedReportReader;
  readonly schemas: WorkroomProjectMemorySchemaReader;
}

/**
 * The only application boundary from persisted Kernel Acceptance to durable
 * Project State/Task Memory. It deliberately has no free-text or generic-event
 * input: the Acceptance Record is read from the exact `task.accepted` fact.
 */
export class AcceptedSourceMemoryApplication {
  constructor(readonly options: AcceptedSourceMemoryApplicationOptions) {}

  async apply(input: ApplyAcceptedSourceMemoryInput): Promise<WorkroomAcceptedSourceApplicationReceipt> {
    const projectId = canonicalId(input.projectId, 'projectId');
    const runId = canonicalId(input.runId, 'runId');
    const taskKey = canonicalId(input.taskKey, 'taskKey');
    assertSequence(input.kernelSequence, 'kernelSequence');
    assertStateRevision(input.expectedStateRevision);
    assertPositiveInteger(input.schemaRevision, 'schemaRevision');
    assertDigest(input.schemaDigest, 'schemaDigest');

    const history = await this.options.kernel.read(runId);
    const runCreated = history[0];
    if (!runCreated || runCreated.type !== 'run.created'
      || runCreated.payload.projectId !== projectId) {
      throw new Error('Accepted Source targets another Project or missing Workroom Run');
    }
    const source = history[input.kernelSequence];
    if (!source || source.sequence !== input.kernelSequence
      || source.type !== 'task.accepted') {
      throw new Error('Accepted Source must be an exact Kernel task.accepted event');
    }
    if (source.payload.taskKey !== taskKey) {
      throw new Error('Accepted Source Task binding does not match');
    }
    const reportRef = canonicalId(String(source.payload.reportRef ?? ''), 'reportRef');
    const acceptance = source.payload.record;
    assertPersistedAcceptanceRecord(acceptance, taskKey, reportRef, source.sequence);
    const record = acceptance as WorkroomAcceptanceRecord;

    const applicationEvents = await this.options.repository.read(projectId);
    const current = replayProjectMemoryApplication(projectId, applicationEvents);
    const existing = applicationEvents.find(event =>
      event.receipt.runId === runId && event.receipt.sourceSequence === source.sequence);
    if (existing) {
      if (existing.receipt.taskKey !== taskKey
        || existing.projection.statePatch.acceptanceId !== record.id
        || existing.projection.statePatch.schemaRevision !== input.schemaRevision
        || existing.projection.statePatch.schemaDigest !== input.schemaDigest) {
        throw new Error('Accepted Source identity payload drift');
      }
      const previous = replayProjectMemoryApplication(
        projectId,
        applicationEvents.slice(0, existing.stateRevision - 1),
      );
      const replayProjection = await this.#project({
        projectId, runId, taskKey, reportRef, record,
        schemaRevision: input.schemaRevision,
        schemaDigest: input.schemaDigest,
        baseStateRevision: previous.stateRevision,
        previousSourceSequence: previous.sourceSequencesByRun[runId] ?? -1,
      });
      if (canonicalWorkroomJson(replayProjection)
        !== canonicalWorkroomJson(existing.projection)) {
        throw new Error('Accepted Source identity payload drift');
      }
      return existing.receipt;
    }
    if (current.stateRevision !== input.expectedStateRevision) {
      throw new ProjectMemoryStateRevisionConflictError(
        projectId,
        input.expectedStateRevision,
        current.stateRevision,
      );
    }
    const previousSourceSequence = current.sourceSequencesByRun[runId] ?? -1;
    const projection = await this.#project({
      projectId, runId, taskKey, reportRef, record,
      schemaRevision: input.schemaRevision,
      schemaDigest: input.schemaDigest,
      baseStateRevision: current.stateRevision,
      previousSourceSequence,
    });
    const appended = await this.options.repository.append(
      projectId,
      input.expectedStateRevision,
      projection,
    );
    return appended.receipt;
  }

  async recall(projectId: string): Promise<WorkroomProjectMemorySnapshot> {
    const id = canonicalId(projectId, 'projectId');
    return replayProjectMemoryApplication(id, await this.options.repository.read(id));
  }

  async #project(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    reportRef: string;
    record: WorkroomAcceptanceRecord;
    schemaRevision: number;
    schemaDigest: string;
    baseStateRevision: number;
    previousSourceSequence: number;
  }>): Promise<WorkroomAcceptedSourceProjection> {
    const report = await this.options.reports.read({
      projectId: input.projectId,
      runId: input.runId,
      taskKey: input.taskKey,
      reportRef: input.reportRef,
      candidateHash: input.record.candidateHash,
      purpose: 'accepted-source-memory-projector',
    });
    if (!report) throw new Error(`Accepted structured Task Report ${input.reportRef} not found`);
    const schema = await this.options.schemas.read({
      projectId: input.projectId,
      revision: input.schemaRevision,
      digest: input.schemaDigest,
    });
    if (!schema) throw new Error('Pinned Project Memory Schema not found');
    if (schema.revision !== input.schemaRevision || schema.digest !== input.schemaDigest) {
      throw new Error('Pinned Project Memory Schema binding does not match');
    }
    return projectAcceptedTaskMemory({
      projectId: input.projectId,
      runId: input.runId,
      report,
      acceptance: input.record,
      schema,
      baseStateRevision: input.baseStateRevision,
      previousSourceSequence: input.previousSourceSequence,
    });
  }
}

export function replayProjectMemoryApplication(
  projectId: string,
  events: readonly WorkroomAcceptedSourceApplicationEvent[],
): WorkroomProjectMemorySnapshot {
  const id = canonicalId(projectId, 'projectId');
  let stateRevision = 0;
  const sourceSequencesByRun: Record<string, number> = {};
  const facts = new Map<string, WorkroomProjectMemoryFact>();
  const taskMemories: WorkroomAcceptedTaskMemory[] = [];
  const receipts: WorkroomAcceptedSourceApplicationReceipt[] = [];
  const applications = new Map<string, string>();
  for (const event of events) {
    assertProjectMemoryApplicationEvent(event, id, stateRevision + 1);
    const previousRunSequence = sourceSequencesByRun[event.receipt.runId] ?? -1;
    if (event.receipt.sourceSequence <= previousRunSequence) {
      throw new Error('Accepted Source Kernel sequence is stale in Project Memory Journal');
    }
    const acceptanceId = event.projection.statePatch.acceptanceId;
    const existingHash = applications.get(acceptanceId);
    if (existingHash) {
      if (existingHash !== event.projection.sourceHash) {
        throw new Error('Accepted Source identity payload drift');
      }
      throw new Error('Accepted Source application is duplicated in Project Memory Journal');
    }
    applyProjectionFacts(facts, event.projection, event.stateRevision);
    stateRevision = event.stateRevision;
    sourceSequencesByRun[event.receipt.runId] = event.receipt.sourceSequence;
    taskMemories.push(event.projection.memory);
    receipts.push(event.receipt);
    applications.set(acceptanceId, event.projection.sourceHash);
  }
  return deepFreeze({
    projectId: id,
    stateRevision,
    sourceSequencesByRun,
    facts: [...facts.values()].sort((left, right) => compareCanonicalWorkroomText(left.factId, right.factId)),
    taskMemories: [...taskMemories],
    receipts: [...receipts],
  });
}

export function createProjectMemoryApplicationEvent(
  projectId: string,
  stateRevision: number,
  projection: WorkroomAcceptedSourceProjection,
): WorkroomAcceptedSourceApplicationEvent {
  const contextRelease = deepFreeze({
    eligible: true as const,
    ref: `context-release:${projection.statePatch.acceptanceId}:${projection.sourceHash}`,
    projectId,
    runId: projection.statePatch.runId,
    taskKey: projection.statePatch.taskKey,
    sourceAcceptanceId: projection.statePatch.acceptanceId,
    sourceHash: projection.sourceHash,
    taskMemoryId: projection.memory.id,
    statePatchId: projection.statePatch.id,
    stateRevision,
  });
  const receipt = deepFreeze({
    status: 'applied' as const,
    projectId,
    runId: projection.statePatch.runId,
    taskKey: projection.statePatch.taskKey,
    sourceSequence: projection.statePatch.sourceSequence,
    stateRevision,
    sourceHash: projection.sourceHash,
    contextRelease,
  });
  return deepFreeze({
    version: 1 as const,
    projectId,
    stateRevision,
    type: 'accepted_source.applied' as const,
    projectionDigest: digest(projection),
    projection,
    receipt,
  });
}

function applyProjectionFacts(
  facts: Map<string, WorkroomProjectMemoryFact>,
  projection: WorkroomAcceptedSourceProjection,
  stateRevision: number,
): void {
  for (const claim of projection.statePatch.claims) {
    if (facts.has(claim.factId)) throw new Error(`Project Fact ${claim.factId} already exists`);
    for (const supersededId of claim.supersedesFactIds ?? []) {
      const superseded = facts.get(supersededId);
      if (!superseded || superseded.key !== claim.key || superseded.status === 'stale') {
        throw new Error(`Project Fact supersession ${supersededId} is invalid`);
      }
      facts.set(supersededId, deepFreeze({ ...superseded, status: 'stale' as const }));
    }
    const activeSameKey = [...facts.values()].filter(fact =>
      fact.key === claim.key && fact.status !== 'stale');
    const conflicts = activeSameKey.filter(fact => fact.value !== claim.value);
    for (const conflict of conflicts) {
      facts.set(conflict.factId, deepFreeze({ ...conflict, status: 'disputed' as const }));
    }
    facts.set(claim.factId, deepFreeze({
      ...claim,
      acceptedStatus: claim.status,
      status: conflicts.length > 0 ? 'disputed' as const : claim.status,
      appliedAtStateRevision: stateRevision,
    }));
  }
}

export function findExactProjectMemoryApplicationReplay(
  events: readonly WorkroomAcceptedSourceApplicationEvent[],
  projection: WorkroomAcceptedSourceProjection,
): WorkroomAcceptedSourceApplicationEvent | undefined {
  const sameIdentity = events.find(event =>
    event.projection.statePatch.acceptanceId === projection.statePatch.acceptanceId);
  if (!sameIdentity) return undefined;
  if (canonicalWorkroomJson(sameIdentity.projection) !== canonicalWorkroomJson(projection)) {
    throw new Error('Accepted Source identity payload drift');
  }
  return sameIdentity;
}

export function assertProjectMemoryApplicationEvent(
  event: WorkroomAcceptedSourceApplicationEvent,
  projectId: string,
  expectedRevision: number,
): void {
  const projection = event.projection;
  const patch = projection.statePatch;
  const memory = projection.memory;
  const release = event.receipt.contextRelease;
  if (event.version !== 1 || event.type !== 'accepted_source.applied'
    || event.projectId !== projectId || event.stateRevision !== expectedRevision
    || !/^sha256:[a-f0-9]{64}$/u.test(projection.sourceHash)
    || event.projectionDigest !== digest(projection)
    || patch.projectId !== projectId
    || patch.baseStateRevision !== expectedRevision - 1
    || !Number.isSafeInteger(patch.sourceSequence) || patch.sourceSequence < 0
    || !/^sha256:[a-f0-9]{64}$/u.test(patch.schemaDigest)
    || patch.id !== `state-patch:${patch.acceptanceId}:${projection.sourceHash}`
    || memory.id !== `task-memory:${patch.acceptanceId}:${projection.sourceHash}`
    || memory.projectId !== projectId
    || memory.runId !== patch.runId
    || memory.taskKey !== patch.taskKey
    || memory.taskRevision !== patch.taskRevision
    || memory.planRef !== patch.planRef
    || memory.planRevision !== patch.planRevision
    || memory.sourceReportRef !== patch.reportRef
    || memory.sourceAcceptanceId !== patch.acceptanceId
    || memory.schemaRevision !== patch.schemaRevision
    || memory.sourceHash !== projection.sourceHash
    || event.receipt.projectId !== projectId
    || event.receipt.stateRevision !== expectedRevision
    || event.receipt.sourceHash !== event.projection.sourceHash
    || event.receipt.runId !== patch.runId
    || event.receipt.taskKey !== patch.taskKey
    || event.receipt.sourceSequence !== patch.sourceSequence
    || release.eligible !== true
    || release.projectId !== projectId
    || release.runId !== patch.runId
    || release.taskKey !== patch.taskKey
    || release.sourceAcceptanceId !== patch.acceptanceId
    || release.sourceHash !== projection.sourceHash
    || release.taskMemoryId !== memory.id
    || release.statePatchId !== patch.id
    || release.stateRevision !== expectedRevision
    || canonicalWorkroomJson([...memory.claimIds].sort())
      !== canonicalWorkroomJson(patch.claims.map(claim => claim.id).sort())
    || patch.claims.some(claim =>
      claim.sourceAcceptanceId !== patch.acceptanceId
      || claim.sourceReportRef !== patch.reportRef
      || claim.factId !== `project-fact:${patch.acceptanceId}:${encodeURIComponent(claim.id)}`)) {
    throw new Error('Invalid Accepted Source Project Memory application event');
  }
  const expectedRef = `context-release:${patch.acceptanceId}:${projection.sourceHash}`;
  if (release.ref !== expectedRef) {
    throw new Error('Invalid Accepted Source context-release receipt');
  }
}

function canonicalId(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
  return value;
}

function assertStateRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Project State revision');
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
}

function assertSequence(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
}

function assertDigest(value: string, name: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`Invalid ${name}`);
}
