import type { WorkroomAcceptanceContract } from './acceptance-policy.js';
import type { GovernedDisclosureManifestSnapshot } from '../data-governance/disclosure-manifest.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutionFactAnchor,
  type AssignmentExecutionSnapshotReference,
  type AssignmentExecutionWorkspaceReference,
  type AssignmentExecutorRole,
} from './assignment-executor.js';
import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import {
  assertWorkroomRemoteDispatchRetry,
  createWorkroomRemoteDispatchOutboxItem,
  type WorkroomGithubWorkspaceReference,
  type WorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteEndpointSnapshot,
} from './remote-dispatch.js';

export interface WorkroomRemoteAssignmentClaimRequest {
  readonly operationId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly agentDefinitionId: string;
  readonly endpointId: string;
}

export interface WorkroomRemoteAssignmentAuthorityInput {
  readonly projectId: string;
  readonly runId: string;
  readonly task: Readonly<{
    key: string;
    revision: number;
    acceptanceContract: WorkroomAcceptanceContract;
  }>;
  readonly assignment: Readonly<{
    id: string;
    revision: number;
    attempt: number;
    fence: number;
  }>;
  readonly requestedAgentDefinitionId: string;
  readonly requestedEndpointId: string;
  readonly factAnchor: AssignmentExecutionFactAnchor;
}

/**
 * Generation-owned resolver. Its implementation must intersect the current
 * Run Profile pin, Agent Definition, role/task policy and generation catalog;
 * callers only name the desired definition/endpoint and cannot provide refs.
 */
export interface WorkroomRemoteAssignmentAuthorityPort {
  resolve(
    input: WorkroomRemoteAssignmentAuthorityInput,
  ): Promise<WorkroomRemoteAssignmentResolvedAuthority>;
}

export interface WorkroomRemoteAssignmentResolvedAuthority {
  /** Authorized execution identity; never copied from the scheduler request. */
  readonly principalId: string;
  readonly role: AssignmentExecutorRole;
  readonly agentDefinitionId: string;
  readonly agentDefinition: AssignmentExecutionSnapshotReference;
  readonly plan: AssignmentExecutionSnapshotReference;
  readonly contextPolicy: AssignmentExecutionSnapshotReference;
  /** Exact six-way generation/profile/definition/role/task/policy intersection. */
  readonly capabilitySnapshot: AssignmentExecutionSnapshotReference;
  /** Composite current Profile + execution/risk policy pin. */
  readonly policySnapshot: AssignmentExecutionSnapshotReference;
  readonly workspace: AssignmentExecutionWorkspaceReference;
  readonly endpoint: WorkroomRemoteEndpointSnapshot;
  readonly contextView: Readonly<{ ref: string; hash: string }>;
  readonly capabilityGrantRef: string;
  readonly disclosureManifest: GovernedDisclosureManifestSnapshot;
  readonly remoteWorkspace: WorkroomGithubWorkspaceReference;
}

export interface WorkroomRemoteAssignmentIssuance {
  readonly operationId: string;
  readonly requestDigest: string;
  readonly issuedAt: number;
  readonly reconcileDeadline: number;
  readonly envelope: AssignmentExecutionEnvelope;
  readonly dispatchItem: WorkroomRemoteDispatchOutboxItem;
}

export interface MaterializeWorkroomRemoteAssignmentInput {
  readonly request: WorkroomRemoteAssignmentClaimRequest;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly issuedAt: number;
  readonly leaseExpiresAt: number;
  readonly reconcileDeadline: number;
  readonly acceptanceContract: WorkroomAcceptanceContract;
  readonly factAnchor: AssignmentExecutionFactAnchor;
  readonly authority: WorkroomRemoteAssignmentResolvedAuthority;
}

export function normalizeWorkroomRemoteAssignmentClaimRequest(
  value: WorkroomRemoteAssignmentClaimRequest,
): WorkroomRemoteAssignmentClaimRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote Assignment request must be an object');
  }
  const keys = Object.keys(value).sort();
  const expected = [
    'operationId', 'projectId', 'runId', 'taskKey', 'agentDefinitionId', 'endpointId',
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('Remote Assignment request contains forbidden identity or authority fields');
  }
  return deepFreeze({
    operationId: text(value.operationId, 'operationId'),
    projectId: text(value.projectId, 'projectId'),
    runId: text(value.runId, 'runId'),
    taskKey: text(value.taskKey, 'taskKey'),
    agentDefinitionId: text(value.agentDefinitionId, 'agentDefinitionId'),
    endpointId: text(value.endpointId, 'endpointId'),
  });
}

export function workroomRemoteAssignmentRequestDigest(
  request: WorkroomRemoteAssignmentClaimRequest,
): string {
  return digest({ version: 1, ...normalizeWorkroomRemoteAssignmentClaimRequest(request) });
}

export function workroomRemoteAssignmentId(operationId: string): string {
  return `remote-assignment:v1:${encodeURIComponent(text(operationId, 'operationId'))}`;
}

export function materializeWorkroomRemoteAssignment(
  input: MaterializeWorkroomRemoteAssignmentInput,
): WorkroomRemoteAssignmentIssuance {
  const request = normalizeWorkroomRemoteAssignmentClaimRequest(input.request);
  positive(input.taskRevision, 'taskRevision');
  positive(input.assignmentRevision, 'assignmentRevision');
  positive(input.attempt, 'attempt');
  positive(input.fence, 'fence');
  const issuedAt = timestamp(input.issuedAt, 'issuedAt');
  const leaseExpiresAt = timestamp(input.leaseExpiresAt, 'leaseExpiresAt');
  const reconcileDeadline = timestamp(input.reconcileDeadline, 'reconcileDeadline');
  if (leaseExpiresAt <= issuedAt || reconcileDeadline < leaseExpiresAt) {
    throw new Error('Remote Assignment deadlines must follow issuance and Assignment lease');
  }
  if (input.authority.role !== 'executor' && input.authority.role !== 'integration') {
    throw new Error('Resolved Remote Assignment role is not executable');
  }
  if (input.authority.endpoint.id !== request.endpointId) {
    throw new Error('Resolved Remote Assignment endpoint does not match the requested endpoint');
  }
  if (input.authority.agentDefinitionId !== request.agentDefinitionId) {
    throw new Error('Resolved Remote Assignment Agent Definition does not match the request');
  }
  if (input.authority.workspace.fence !== input.fence
    || input.authority.remoteWorkspace.fence !== input.fence
    || input.authority.workspace.baseRevision !== input.authority.remoteWorkspace.baseSha) {
    throw new Error('Resolved Remote Assignment Workspace authority drift');
  }
  const envelope = createAssignmentExecutionEnvelope({
    projectId: request.projectId,
    runId: request.runId,
    taskKey: request.taskKey,
    taskRevision: input.taskRevision,
    assignmentId: text(input.assignmentId, 'assignmentId'),
    assignmentRevision: input.assignmentRevision,
    attempt: input.attempt,
    fence: input.fence,
    principalId: text(input.authority.principalId, 'resolved principalId'),
    role: input.authority.role,
    agentDefinition: input.authority.agentDefinition,
    plan: input.authority.plan,
    contextPolicy: input.authority.contextPolicy,
    factAnchor: input.factAnchor,
    capabilitySnapshot: input.authority.capabilitySnapshot,
    policySnapshot: input.authority.policySnapshot,
    workspace: input.authority.workspace,
  });
  const dispatchItem = createWorkroomRemoteDispatchOutboxItem({
    projectId: envelope.projectId,
    runId: envelope.runId,
    taskKey: envelope.taskKey,
    taskRevision: envelope.taskRevision,
    assignmentId: envelope.assignmentId,
    attempt: envelope.attempt,
    fence: envelope.fence,
    endpoint: input.authority.endpoint,
    contextView: input.authority.contextView,
    acceptanceContract: {
      ref: input.acceptanceContract.id,
      hash: input.acceptanceContract.digest,
    },
    capabilitySnapshot: {
      ref: envelope.capabilitySnapshot.ref,
      hash: envelope.capabilitySnapshot.digest,
      grantRef: text(input.authority.capabilityGrantRef, 'capabilityGrantRef'),
    },
    disclosureManifest: input.authority.disclosureManifest,
    workspace: input.authority.remoteWorkspace,
  });
  return deepFreeze({
    operationId: request.operationId,
    requestDigest: workroomRemoteAssignmentRequestDigest(request),
    issuedAt,
    reconcileDeadline,
    envelope,
    dispatchItem,
  });
}

export function parseWorkroomRemoteAssignmentIssuance(
  value: unknown,
): WorkroomRemoteAssignmentIssuance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted Remote Assignment issuance must be an object');
  }
  const record = value as Partial<WorkroomRemoteAssignmentIssuance>;
  const keys = Object.keys(record).sort();
  const expected = [
    'dispatchItem', 'envelope', 'issuedAt', 'operationId', 'reconcileDeadline', 'requestDigest',
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('Persisted Remote Assignment issuance has invalid keys');
  }
  const operationId = text(record.operationId, 'operationId');
  if (!/^sha256:[a-f0-9]{64}$/u.test(record.requestDigest ?? '')) {
    throw new Error('Persisted Remote Assignment requestDigest is invalid');
  }
  const issuedAt = timestamp(record.issuedAt, 'issuedAt');
  const reconcileDeadline = timestamp(record.reconcileDeadline, 'reconcileDeadline');
  if (reconcileDeadline <= issuedAt) {
    throw new Error('Persisted Remote Assignment reconcile deadline must follow issuance');
  }
  const persistedEnvelope = record.envelope as AssignmentExecutionEnvelope;
  if (!persistedEnvelope || typeof persistedEnvelope !== 'object') {
    throw new Error('Persisted Remote Assignment Envelope is invalid');
  }
  const {
    version: _envelopeVersion,
    digest: persistedEnvelopeDigest,
    ...envelopeInput
  } = persistedEnvelope;
  const canonicalEnvelope = createAssignmentExecutionEnvelope(envelopeInput);
  if (canonicalEnvelope.digest !== persistedEnvelopeDigest) {
    throw new Error('Persisted Remote Assignment Envelope digest drift');
  }
  const item = record.dispatchItem as WorkroomRemoteDispatchOutboxItem;
  assertExactKeys(item, [
    'version', 'dispatchId', 'messageId', 'envelopeDigest', 'envelope',
  ], 'dispatch item');
  const envelope = item?.envelope;
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Persisted Remote Assignment dispatch item is invalid');
  }
  assertExactKeys(envelope, [
    'version', 'dispatchId', 'messageId', 'projectId', 'runId', 'taskKey',
    'taskRevision', 'assignmentId', 'attempt', 'fence', 'endpoint', 'contextView',
    'acceptanceContract', 'capabilitySnapshot', 'disclosureManifest', 'workspace',
  ], 'dispatch Envelope');
  const {
    version: _version,
    dispatchId: _dispatchId,
    messageId: _messageId,
    ...dispatchInput
  } = envelope;
  const canonicalItem = createWorkroomRemoteDispatchOutboxItem(dispatchInput);
  assertWorkroomRemoteDispatchRetry(canonicalItem, item);
  if (canonicalEnvelope.projectId !== item.envelope.projectId
    || canonicalEnvelope.runId !== item.envelope.runId
    || canonicalEnvelope.taskKey !== item.envelope.taskKey
    || canonicalEnvelope.taskRevision !== item.envelope.taskRevision
    || canonicalEnvelope.assignmentId !== item.envelope.assignmentId
    || canonicalEnvelope.attempt !== item.envelope.attempt
    || canonicalEnvelope.fence !== item.envelope.fence
    || canonicalEnvelope.capabilitySnapshot.ref !== item.envelope.capabilitySnapshot.ref
    || canonicalEnvelope.capabilitySnapshot.digest !== item.envelope.capabilitySnapshot.hash) {
    throw new Error('Persisted Remote Assignment Envelope and dispatch intent drift');
  }
  return deepFreeze({
    operationId,
    requestDigest: record.requestDigest!,
    issuedAt,
    reconcileDeadline,
    envelope: canonicalEnvelope,
    dispatchItem: canonicalItem,
  });
}

function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  field: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Persisted Remote Assignment ${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`Persisted Remote Assignment ${field} has invalid keys`);
  }
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) {
    throw new Error(`Remote Assignment ${field} must be a finite timestamp`);
  }
  return Number(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Remote Assignment ${field} is required`);
  }
  return value.trim();
}

function positive(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Remote Assignment ${field} must be a positive integer`);
  }
  return Number(value);
}
