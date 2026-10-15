import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import type { WorkroomExecutionRole } from './kernel-contracts.js';

export type AssignmentExecutorRole = Extract<WorkroomExecutionRole, 'executor' | 'integration'>;

export interface AssignmentExecutionSnapshotReference {
  readonly ref: string;
  readonly revision: number;
  readonly digest: string;
}

export interface AssignmentExecutionWorkspaceReference {
  readonly leaseRef: string;
  readonly mountRef: string;
  readonly baseRevision: string;
  readonly fence: number;
}

export interface AssignmentExecutionFactAnchor {
  readonly ref: string;
  readonly sequence: number;
  readonly digest: string;
}

export interface AssignmentExecutionEnvelopeInput {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly principalId: string;
  readonly role: AssignmentExecutorRole;
  readonly agentDefinition: AssignmentExecutionSnapshotReference;
  readonly plan: AssignmentExecutionSnapshotReference;
  readonly contextPolicy: AssignmentExecutionSnapshotReference;
  readonly factAnchor: AssignmentExecutionFactAnchor;
  readonly capabilitySnapshot: AssignmentExecutionSnapshotReference;
  readonly policySnapshot: AssignmentExecutionSnapshotReference;
  readonly workspace: AssignmentExecutionWorkspaceReference;
}

export interface AssignmentExecutionEnvelope extends AssignmentExecutionEnvelopeInput {
  readonly version: 1;
  readonly digest: string;
}

export interface AssignmentProgressObservation {
  readonly version: 1;
  readonly type: 'progress';
  readonly observationId: string;
  readonly envelopeDigest: string;
  readonly progress: Readonly<{
    summary: string;
    completedUnits?: number;
    totalUnits?: number;
  }>;
}

export interface AssignmentHeartbeatObservation {
  readonly version: 1;
  readonly type: 'heartbeat';
  readonly observationId: string;
  readonly envelopeDigest: string;
}

export interface AssignmentCheckpointObservation {
  readonly version: 1;
  readonly type: 'checkpoint';
  readonly observationId: string;
  readonly envelopeDigest: string;
  readonly checkpoint: Readonly<{
    ref: string;
    digest: string;
  }>;
}

export interface AssignmentExecutionCompletedObservation {
  readonly version: 1;
  readonly type: 'execution_completed';
  readonly observationId: string;
  readonly envelopeDigest: string;
  readonly completion: Readonly<{
    report: Readonly<{ ref: string; digest: string }>;
    candidate: Readonly<{ ref: string; hash: string }>;
    completionReceiptDigest?: string;
  }>;
}

export type AssignmentExecutionObservation =
  | AssignmentProgressObservation
  | AssignmentHeartbeatObservation
  | AssignmentCheckpointObservation
  | AssignmentExecutionCompletedObservation;

/** Transport adapters receive no mutable Workroom state or command surface. */
export interface AssignmentExecutorPort {
  /** The adapter must stop its transport/sandbox when the trusted caller aborts. */
  execute(
    envelope: AssignmentExecutionEnvelope,
    signal: AbortSignal,
  ): AsyncIterable<AssignmentExecutionObservation>;
}

/**
 * Materializes the exact role-scoped authority a trusted Workroom issuer gives
 * one Assignment attempt. Executors may consume this value, but never widen it.
 */
export function createAssignmentExecutionEnvelope(
  input: AssignmentExecutionEnvelopeInput,
): AssignmentExecutionEnvelope {
  validateEnvelopeInput(input);
  const projection = {
    version: 1 as const,
    ...input,
    agentDefinition: { ...input.agentDefinition },
    plan: { ...input.plan },
    contextPolicy: { ...input.contextPolicy },
    factAnchor: { ...input.factAnchor },
    capabilitySnapshot: { ...input.capabilitySnapshot },
    policySnapshot: { ...input.policySnapshot },
    workspace: { ...input.workspace },
  };
  return deepFreeze({
    ...projection,
    digest: digest(projection),
  });
}

/**
 * Caller-owned execution boundary. Cancellation is checked before transport
 * dispatch and before any observation escapes toward a trusted Kernel adapter.
 */
export async function* executeAssignment(
  port: AssignmentExecutorPort,
  envelope: AssignmentExecutionEnvelope,
  signal: AbortSignal,
): AsyncIterable<AssignmentExecutionObservation> {
  assertAssignmentExecutionEnvelope(envelope);
  signal.throwIfAborted();
  const iterator = port.execute(envelope, signal)[Symbol.asyncIterator]();
  let completed = false;
  try {
    while (true) {
      const next = await nextWithAbort(iterator, signal);
      if (next.done) {
        completed = true;
        return;
      }
      signal.throwIfAborted();
      yield validateAssignmentExecutionObservation(envelope, next.value);
    }
  } finally {
    if (!completed) stopIteratorWithoutWaiting(iterator);
  }
}

/**
 * Validates an Executor observation before any trusted adapter may translate
 * it into a Kernel proposal. The observation itself carries no target scope;
 * its exact Project/Run/Task/Assignment authority is the Envelope digest.
 */
export function validateAssignmentExecutionObservation(
  envelope: AssignmentExecutionEnvelope,
  value: unknown,
): AssignmentExecutionObservation {
  assertAssignmentExecutionEnvelope(envelope);
  const observation = requireRecord(value, 'observation');
  if (observation.version !== 1) {
    throw new Error('Assignment Executor emitted an unsupported observation type');
  }
  requireText(observation.observationId, 'observationId');
  if (observation.envelopeDigest !== envelope.digest) {
    throw new Error('Assignment Execution observation is not bound to the current Envelope');
  }
  if (observation.type === 'heartbeat') {
    assertExactKeys(observation, [
      'version', 'type', 'observationId', 'envelopeDigest',
    ], 'heartbeat observation');
    return deepFreeze({
      version: 1,
      type: 'heartbeat',
      observationId: observation.observationId,
      envelopeDigest: observation.envelopeDigest,
    });
  }
  if (observation.type === 'checkpoint') {
    assertExactKeys(observation, [
      'version', 'type', 'observationId', 'envelopeDigest', 'checkpoint',
    ], 'checkpoint observation');
    const checkpoint = requireRecord(observation.checkpoint, 'checkpoint');
    assertExactKeys(checkpoint, ['ref', 'digest'], 'checkpoint payload');
    requireText(checkpoint.ref, 'checkpoint.ref');
    requireDigest(checkpoint.digest, 'checkpoint.digest');
    return deepFreeze({
      version: 1,
      type: 'checkpoint',
      observationId: observation.observationId,
      envelopeDigest: observation.envelopeDigest,
      checkpoint: {
        ref: checkpoint.ref,
        digest: checkpoint.digest,
      },
    });
  }
  if (observation.type === 'execution_completed') {
    assertExactKeys(observation, [
      'version', 'type', 'observationId', 'envelopeDigest', 'completion',
    ], 'execution_completed observation');
    const completion = requireRecord(observation.completion, 'completion');
    assertExactKeys(completion, [
      'report', 'candidate', 'completionReceiptDigest',
    ], 'completion payload');
    const report = requireRecord(completion.report, 'completion.report');
    const candidate = requireRecord(completion.candidate, 'completion.candidate');
    assertExactKeys(report, ['ref', 'digest'], 'completion report');
    assertExactKeys(candidate, ['ref', 'hash'], 'completion candidate');
    requireText(report.ref, 'completion.report.ref');
    requireDigest(report.digest, 'completion.report.digest');
    requireText(candidate.ref, 'completion.candidate.ref');
    requireDigest(candidate.hash, 'completion.candidate.hash');
    if (completion.completionReceiptDigest !== undefined) {
      requireDigest(
        completion.completionReceiptDigest,
        'completion.completionReceiptDigest',
      );
    }
    return deepFreeze({
      version: 1,
      type: 'execution_completed',
      observationId: observation.observationId,
      envelopeDigest: observation.envelopeDigest,
      completion: {
        report: { ref: report.ref, digest: report.digest },
        candidate: { ref: candidate.ref, hash: candidate.hash },
        ...(completion.completionReceiptDigest === undefined
          ? {}
          : { completionReceiptDigest: completion.completionReceiptDigest }),
      },
    });
  }
  if (observation.type !== 'progress') {
    throw new Error('Assignment Executor emitted an unsupported observation type');
  }
  assertExactKeys(observation, [
    'version', 'type', 'observationId', 'envelopeDigest', 'progress',
  ], 'progress observation');
  const progress = requireRecord(observation.progress, 'progress');
  assertExactKeys(progress, ['summary', 'completedUnits', 'totalUnits'], 'progress payload');
  requireText(progress.summary, 'progress.summary');
  const completedUnits = optionalNonNegativeInteger(progress.completedUnits, 'progress.completedUnits');
  const totalUnits = optionalPositiveInteger(progress.totalUnits, 'progress.totalUnits');
  if (completedUnits !== undefined && totalUnits !== undefined && completedUnits > totalUnits) {
    throw new Error('Assignment Execution progress completedUnits cannot exceed totalUnits');
  }
  return deepFreeze({
    version: 1,
    type: 'progress',
    observationId: observation.observationId,
    envelopeDigest: observation.envelopeDigest,
    progress: {
      summary: progress.summary,
      ...(completedUnits === undefined ? {} : { completedUnits }),
      ...(totalUnits === undefined ? {} : { totalUnits }),
    },
  });
}

/** Guards the trusted local boundary against corrupted or mutable Envelopes. */
export function assertAssignmentExecutionEnvelope(
  value: unknown,
): asserts value is AssignmentExecutionEnvelope {
  const envelope = requireRecord(value, 'Envelope');
  assertExactKeys(envelope, [
    'version', 'digest', 'projectId', 'runId', 'taskKey', 'taskRevision',
    'assignmentId', 'assignmentRevision', 'attempt', 'fence', 'principalId',
    'role', 'agentDefinition', 'plan', 'contextPolicy', 'factAnchor',
    'capabilitySnapshot', 'policySnapshot', 'workspace',
  ], 'Envelope');
  if (envelope.version !== 1) {
    throw new Error('Assignment Execution Envelope version is unsupported');
  }
  requireDigest(envelope.digest, 'Envelope.digest');
  const agentDefinition = requireRecord(envelope.agentDefinition, 'Agent Definition reference');
  const plan = requireRecord(envelope.plan, 'Plan reference');
  const contextPolicy = requireRecord(envelope.contextPolicy, 'Context Policy reference');
  const factAnchor = requireRecord(envelope.factAnchor, 'fact anchor');
  const capabilitySnapshot = requireRecord(envelope.capabilitySnapshot, 'Capability Snapshot reference');
  const policySnapshot = requireRecord(envelope.policySnapshot, 'Policy Snapshot reference');
  const workspace = requireRecord(envelope.workspace, 'Workspace reference');
  const input = {
    projectId: envelope.projectId,
    runId: envelope.runId,
    taskKey: envelope.taskKey,
    taskRevision: envelope.taskRevision,
    assignmentId: envelope.assignmentId,
    assignmentRevision: envelope.assignmentRevision,
    attempt: envelope.attempt,
    fence: envelope.fence,
    principalId: envelope.principalId,
    role: envelope.role,
    agentDefinition,
    plan,
    contextPolicy,
    factAnchor,
    capabilitySnapshot,
    policySnapshot,
    workspace,
  } as unknown as AssignmentExecutionEnvelopeInput;
  validateEnvelopeInput(input);
  const projection = {
    version: 1 as const,
    ...input,
    agentDefinition: { ...input.agentDefinition },
    plan: { ...input.plan },
    contextPolicy: { ...input.contextPolicy },
    factAnchor: { ...input.factAnchor },
    capabilitySnapshot: { ...input.capabilitySnapshot },
    policySnapshot: { ...input.policySnapshot },
    workspace: { ...input.workspace },
  };
  if (digest(projection) !== envelope.digest) {
    throw new Error('Assignment Execution Envelope digest does not match its authority scope');
  }
  if (!Object.isFrozen(value)
    || !Object.isFrozen(envelope.agentDefinition)
    || !Object.isFrozen(envelope.plan)
    || !Object.isFrozen(envelope.contextPolicy)
    || !Object.isFrozen(envelope.factAnchor)
    || !Object.isFrozen(envelope.capabilitySnapshot)
    || !Object.isFrozen(envelope.policySnapshot)
    || !Object.isFrozen(envelope.workspace)) {
    throw new Error('Assignment Execution Envelope must be deeply immutable');
  }
}

function validateEnvelopeInput(input: AssignmentExecutionEnvelopeInput): void {
  assertExactKeys(input as unknown as Record<string, unknown>, [
    'projectId', 'runId', 'taskKey', 'taskRevision', 'assignmentId',
    'assignmentRevision', 'attempt', 'fence', 'principalId', 'role',
    'agentDefinition', 'plan', 'contextPolicy', 'factAnchor',
    'capabilitySnapshot', 'policySnapshot', 'workspace',
  ], 'Envelope input');
  for (const [label, reference] of [
    ['Agent Definition', requireRecord(input.agentDefinition, 'Agent Definition reference')],
    ['Plan', requireRecord(input.plan, 'Plan reference')],
    ['Context Policy', requireRecord(input.contextPolicy, 'Context Policy reference')],
    ['Capability Snapshot', requireRecord(input.capabilitySnapshot, 'Capability Snapshot reference')],
    ['Policy Snapshot', requireRecord(input.policySnapshot, 'Policy Snapshot reference')],
  ] as const) {
    assertExactKeys(reference, [
      'ref', 'revision', 'digest',
    ], `${label} reference`);
  }
  assertExactKeys(requireRecord(input.factAnchor, 'fact anchor'), [
    'ref', 'sequence', 'digest',
  ], 'fact anchor');
  assertExactKeys(requireRecord(input.workspace, 'Workspace reference'), [
    'leaseRef', 'mountRef', 'baseRevision', 'fence',
  ], 'Workspace reference');
  for (const [label, value] of Object.entries({
    projectId: input.projectId,
    runId: input.runId,
    taskKey: input.taskKey,
    assignmentId: input.assignmentId,
    principalId: input.principalId,
    agentDefinitionRef: input.agentDefinition.ref,
    planRef: input.plan.ref,
    contextPolicyRef: input.contextPolicy.ref,
    factAnchorRef: input.factAnchor.ref,
    capabilitySnapshotRef: input.capabilitySnapshot.ref,
    policySnapshotRef: input.policySnapshot.ref,
    workspaceLeaseRef: input.workspace.leaseRef,
    workspaceMountRef: input.workspace.mountRef,
    workspaceBaseRevision: input.workspace.baseRevision,
  })) {
    requireText(value, label);
  }
  if (input.role !== 'executor' && input.role !== 'integration') {
    throw new Error('Assignment Execution role must be executor or integration');
  }
  for (const [label, value] of Object.entries({
    taskRevision: input.taskRevision,
    assignmentRevision: input.assignmentRevision,
    attempt: input.attempt,
    fence: input.fence,
    agentDefinitionRevision: input.agentDefinition.revision,
    planRevision: input.plan.revision,
    contextPolicyRevision: input.contextPolicy.revision,
    capabilitySnapshotRevision: input.capabilitySnapshot.revision,
    policySnapshotRevision: input.policySnapshot.revision,
  })) {
    requirePositiveInteger(value, label);
  }
  requireNonNegativeInteger(input.factAnchor.sequence, 'factAnchor.sequence');
  requireDigest(input.agentDefinition.digest, 'agentDefinition.digest');
  requireDigest(input.plan.digest, 'plan.digest');
  requireDigest(input.contextPolicy.digest, 'contextPolicy.digest');
  requireDigest(input.factAnchor.digest, 'factAnchor.digest');
  requireDigest(input.capabilitySnapshot.digest, 'capabilitySnapshot.digest');
  requireDigest(input.policySnapshot.digest, 'policySnapshot.digest');
  if (input.workspace.fence !== input.fence) {
    throw new Error('Assignment Execution Workspace fence does not match the Envelope fence');
  }
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Assignment Execution ${label} requires non-empty text`);
  }
}

function requirePositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Assignment Execution ${label} must be a positive integer`);
  }
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  requirePositiveInteger(value, label);
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  requireNonNegativeInteger(value, label);
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Assignment Execution ${label} must be a non-negative integer`);
  }
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Assignment Execution ${label} must be a SHA-256 digest`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Assignment Execution ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) {
    throw new Error(`Assignment Execution ${label} contains forbidden field ${unexpected}`);
  }
}

function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  signal.throwIfAborted();
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      operation();
    };
    const onAbort = (): void => {
      finish(() => reject(signal.reason ?? new DOMException('Assignment cancelled', 'AbortError')));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    let pending: PromiseLike<IteratorResult<T>>;
    try {
      pending = iterator.next();
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    Promise.resolve(pending).then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function stopIteratorWithoutWaiting<T>(iterator: AsyncIterator<T>): void {
  try {
    const pending = iterator.return?.();
    if (pending) void Promise.resolve(pending).catch(() => undefined);
  } catch {
    // Cancellation already owns the public outcome; cleanup remains best-effort.
  }
}
