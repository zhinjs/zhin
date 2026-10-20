import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutionFactAnchor,
  type AssignmentExecutionSnapshotReference,
  type AssignmentExecutionWorkspaceReference,
  type AssignmentExecutorRole,
} from './assignment-executor.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import type { WorkroomAcceptanceContract } from './acceptance-policy.js';

export interface WorkroomLocalAssignmentClaimRequest {
  readonly operationId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly agentDefinitionId: string;
}

export interface WorkroomLocalAssignmentAuthorityInput {
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
  readonly factAnchor: AssignmentExecutionFactAnchor;
}

export interface WorkroomLocalAssignmentResolvedAuthority {
  readonly principalId: string;
  readonly role: AssignmentExecutorRole;
  readonly agentDefinitionId: string;
  readonly agentDefinition: AssignmentExecutionSnapshotReference;
  readonly plan: AssignmentExecutionSnapshotReference;
  readonly contextPolicy: AssignmentExecutionSnapshotReference;
  readonly capabilitySnapshot: AssignmentExecutionSnapshotReference;
  readonly policySnapshot: AssignmentExecutionSnapshotReference;
  readonly workspace: AssignmentExecutionWorkspaceReference;
  readonly contextView: Readonly<{ ref: string; hash: string }>;
  readonly capabilityGrantRef: string;
}

export interface WorkroomLocalAssignmentAuthorityPort {
  resolveLocal(
    input: WorkroomLocalAssignmentAuthorityInput,
  ): Promise<WorkroomLocalAssignmentResolvedAuthority>;
}

export interface WorkroomLocalAssignmentIssuance {
  readonly operationId: string;
  readonly requestDigest: string;
  readonly agentDefinitionId: string;
  readonly issuedAt: number;
  readonly envelope: AssignmentExecutionEnvelope;
}

export function normalizeWorkroomLocalAssignmentClaimRequest(
  value: WorkroomLocalAssignmentClaimRequest,
): WorkroomLocalAssignmentClaimRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local Assignment request must be an object');
  }
  const expected = [
    'operationId', 'projectId', 'runId', 'taskKey', 'agentDefinitionId',
  ].sort();
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('Local Assignment request contains forbidden identity or authority fields');
  }
  return deepFreeze({
    operationId: text(value.operationId, 'operationId'),
    projectId: text(value.projectId, 'projectId'),
    runId: text(value.runId, 'runId'),
    taskKey: text(value.taskKey, 'taskKey'),
    agentDefinitionId: text(value.agentDefinitionId, 'agentDefinitionId'),
  });
}

export function workroomLocalAssignmentRequestDigest(
  request: WorkroomLocalAssignmentClaimRequest,
): string {
  return digest({ version: 1, ...normalizeWorkroomLocalAssignmentClaimRequest(request) });
}

export function workroomLocalAssignmentId(operationId: string): string {
  return `local-assignment:v1:${encodeURIComponent(text(operationId, 'operationId'))}`;
}

export function materializeWorkroomLocalAssignment(input: Readonly<{
  request: WorkroomLocalAssignmentClaimRequest;
  taskRevision: number;
  assignmentId: string;
  assignmentRevision: number;
  attempt: number;
  fence: number;
  issuedAt: number;
  factAnchor: AssignmentExecutionFactAnchor;
  authority: WorkroomLocalAssignmentResolvedAuthority;
}>): WorkroomLocalAssignmentIssuance {
  const request = normalizeWorkroomLocalAssignmentClaimRequest(input.request);
  positive(input.taskRevision, 'taskRevision');
  positive(input.assignmentRevision, 'assignmentRevision');
  positive(input.attempt, 'attempt');
  positive(input.fence, 'fence');
  timestamp(input.issuedAt, 'issuedAt');
  if (input.authority.agentDefinitionId !== request.agentDefinitionId) {
    throw new Error('Resolved Local Assignment Agent Definition does not match the request');
  }
  if (input.authority.role !== 'executor' && input.authority.role !== 'integration') {
    throw new Error('Resolved Local Assignment role is not executable');
  }
  if (input.authority.workspace.fence !== input.fence) {
    throw new Error('Resolved Local Assignment Workspace fence drift');
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
    principalId: text(input.authority.principalId, 'principalId'),
    role: input.authority.role,
    agentDefinition: input.authority.agentDefinition,
    plan: input.authority.plan,
    contextPolicy: input.authority.contextPolicy,
    factAnchor: input.factAnchor,
    capabilitySnapshot: input.authority.capabilitySnapshot,
    policySnapshot: input.authority.policySnapshot,
    workspace: input.authority.workspace,
  });
  return deepFreeze({
    operationId: request.operationId,
    requestDigest: workroomLocalAssignmentRequestDigest(request),
    agentDefinitionId: request.agentDefinitionId,
    issuedAt: input.issuedAt,
    envelope,
  });
}

export function parseWorkroomLocalAssignmentIssuance(
  value: unknown,
): WorkroomLocalAssignmentIssuance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted Local Assignment issuance must be an object');
  }
  const record = value as Partial<WorkroomLocalAssignmentIssuance>;
  const expected = [
    'operationId', 'requestDigest', 'agentDefinitionId', 'issuedAt', 'envelope',
  ].sort();
  const keys = Object.keys(record).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('Persisted Local Assignment issuance has invalid keys');
  }
  const operationId = text(record.operationId, 'operationId');
  const agentDefinitionId = text(record.agentDefinitionId, 'agentDefinitionId');
  if (!/^sha256:[a-f0-9]{64}$/u.test(record.requestDigest ?? '')) {
    throw new Error('Persisted Local Assignment requestDigest is invalid');
  }
  const issuedAt = timestamp(record.issuedAt, 'issuedAt');
  const persisted = record.envelope as AssignmentExecutionEnvelope;
  if (!persisted || typeof persisted !== 'object') {
    throw new Error('Persisted Local Assignment Envelope is invalid');
  }
  const { version: _version, digest: persistedDigest, ...input } = persisted;
  const envelope = createAssignmentExecutionEnvelope(input);
  if (persistedDigest !== envelope.digest) {
    throw new Error('Persisted Local Assignment Envelope digest drift');
  }
  const issuance = deepFreeze({
    operationId,
    requestDigest: record.requestDigest!,
    agentDefinitionId,
    issuedAt,
    envelope,
  });
  if (canonicalWorkroomJson(issuance) !== canonicalWorkroomJson(value)) {
    throw new Error('Persisted Local Assignment issuance is not canonical');
  }
  return issuance;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Local Assignment ${label} is required`);
  }
  return value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Local Assignment ${label} must be a positive safe integer`);
  }
  return Number(value);
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) {
    throw new Error(`Local Assignment ${label} must be a finite timestamp`);
  }
  return Number(value);
}
