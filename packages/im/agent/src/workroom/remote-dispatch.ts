import { createHash } from 'node:crypto';

export const WORKROOM_A2A_EXTENSION_URI =
  'https://zhin.dev/extensions/workroom-executor/v1' as const;

export interface WorkroomRemoteEndpointSnapshot {
  readonly id: string;
  readonly owner: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly workroomExtension: typeof WORKROOM_A2A_EXTENSION_URI;
  readonly idempotentDispatch: boolean;
  readonly typedCompletionEnvelope: boolean;
  readonly workspaceProviders: readonly string[];
}

export interface WorkroomGithubWorkspaceReference {
  readonly provider: 'github_pull_request';
  readonly repositoryId: string;
  readonly integrationBindingId: string;
  readonly baseSha: string;
  readonly targetRef: string;
  readonly branchRef: string;
  readonly pathScope: readonly string[];
  readonly mode: 'branch_only' | 'branch_and_pr';
  readonly fence: number;
  readonly checkpointSha?: string;
}

export interface WorkroomRemoteDispatchEnvelope {
  readonly version: 1;
  readonly dispatchId: string;
  readonly messageId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly attempt: number;
  readonly fence: number;
  readonly endpoint: WorkroomRemoteEndpointSnapshot;
  readonly contextView: Readonly<{ ref: string; hash: string }>;
  readonly acceptanceContract: Readonly<{ ref: string; hash: string }>;
  readonly capabilitySnapshot: Readonly<{ ref: string; hash: string; grantRef: string }>;
  readonly disclosureManifest: Readonly<{ ref: string; hash: string }>;
  readonly workspace: WorkroomGithubWorkspaceReference;
}

export interface WorkroomRemoteDispatchOutboxItem {
  readonly version: 1;
  readonly dispatchId: string;
  readonly messageId: string;
  readonly envelopeDigest: string;
  readonly envelope: WorkroomRemoteDispatchEnvelope;
}

export type WorkroomRemoteDispatchInput = Omit<
  WorkroomRemoteDispatchEnvelope,
  'version' | 'dispatchId' | 'messageId'
>;

/**
 * Materializes the immutable payload that must be journaled before transport I/O.
 * Retry callers reuse this exact item; they never regenerate transport identity.
 */
export function createWorkroomRemoteDispatchOutboxItem(
  input: WorkroomRemoteDispatchInput,
): WorkroomRemoteDispatchOutboxItem {
  validateInput(input);
  const identity = [
    input.projectId,
    input.runId,
    input.assignmentId,
    String(input.attempt),
    String(input.fence),
  ].map(encodeURIComponent).join(':');
  const dispatchId = `workroom-dispatch:v1:${identity}`;
  const messageId = `workroom-message:v1:${identity}`;
  const envelope = freezeEnvelope({
    ...input,
    version: 1,
    dispatchId,
    messageId,
  });
  return Object.freeze({
    version: 1,
    dispatchId,
    messageId,
    envelopeDigest: digestEnvelope(envelope),
    envelope,
  });
}

/** Fail closed if a retry attempts to drift from the persisted outbox fact. */
export function assertWorkroomRemoteDispatchRetry(
  persisted: WorkroomRemoteDispatchOutboxItem,
  retry: WorkroomRemoteDispatchOutboxItem,
): void {
  if (retry.dispatchId !== persisted.dispatchId || retry.messageId !== persisted.messageId) {
    throw new Error('Remote dispatch retry identity does not match the persisted outbox item');
  }
  const actualDigest = digestEnvelope(retry.envelope);
  if (retry.envelopeDigest !== persisted.envelopeDigest || actualDigest !== persisted.envelopeDigest) {
    throw new Error('Remote dispatch retry envelope digest does not match the persisted outbox item');
  }
}

function validateInput(input: WorkroomRemoteDispatchInput): void {
  requireText([
    input.projectId,
    input.runId,
    input.taskKey,
    input.assignmentId,
    input.endpoint.id,
    input.endpoint.owner,
    input.endpoint.cardDigest,
    input.endpoint.authBindingId,
    input.contextView.ref,
    input.contextView.hash,
    input.acceptanceContract.ref,
    input.acceptanceContract.hash,
    input.capabilitySnapshot.ref,
    input.capabilitySnapshot.hash,
    input.capabilitySnapshot.grantRef,
    input.disclosureManifest.ref,
    input.disclosureManifest.hash,
    input.workspace.repositoryId,
    input.workspace.integrationBindingId,
    input.workspace.targetRef,
    input.workspace.branchRef,
  ]);
  requirePositiveInteger(input.taskRevision, 'taskRevision');
  requirePositiveInteger(input.attempt, 'attempt');
  requirePositiveInteger(input.fence, 'fence');
  if (input.workspace.fence !== input.fence) {
    throw new Error('Remote dispatch Workspace fence does not match the Assignment fence');
  }
  if (input.endpoint.workroomExtension !== WORKROOM_A2A_EXTENSION_URI
    || !input.endpoint.idempotentDispatch
    || !input.endpoint.typedCompletionEnvelope
    || !input.endpoint.workspaceProviders.includes(input.workspace.provider)) {
    throw new Error('Remote endpoint cannot claim a Workroom Assignment');
  }
  requireSha(input.workspace.baseSha, 'baseSha');
  if (input.workspace.checkpointSha) requireSha(input.workspace.checkpointSha, 'checkpointSha');
  if (!input.workspace.targetRef.startsWith('refs/heads/')
    || !input.workspace.branchRef.startsWith('refs/heads/')
    || input.workspace.targetRef === input.workspace.branchRef) {
    throw new Error('Remote dispatch Workspace requires distinct canonical target and attempt branch refs');
  }
  if (input.workspace.pathScope.length === 0
    || input.workspace.pathScope.some((path) => !isCanonicalRelativePath(path))) {
    throw new Error('Remote dispatch Workspace path scope must contain relative canonical paths');
  }
}

function freezeEnvelope(value: WorkroomRemoteDispatchEnvelope): WorkroomRemoteDispatchEnvelope {
  return Object.freeze({
    ...value,
    endpoint: Object.freeze({
      ...value.endpoint,
      workspaceProviders: Object.freeze([...value.endpoint.workspaceProviders]),
    }),
    contextView: Object.freeze({ ...value.contextView }),
    acceptanceContract: Object.freeze({ ...value.acceptanceContract }),
    capabilitySnapshot: Object.freeze({ ...value.capabilitySnapshot }),
    disclosureManifest: Object.freeze({ ...value.disclosureManifest }),
    workspace: Object.freeze({
      ...value.workspace,
      pathScope: Object.freeze([...value.workspace.pathScope]),
    }),
  });
}

function digestEnvelope(value: WorkroomRemoteDispatchEnvelope): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function requireText(values: readonly string[]): void {
  if (values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('Remote dispatch requires non-empty immutable references');
  }
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Remote dispatch ${name} must be a positive integer`);
  }
}

function requireSha(value: string, name: string): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) {
    throw new Error(`Remote dispatch Workspace ${name} must be an immutable Git object id`);
  }
}

function isCanonicalRelativePath(value: string): boolean {
  if (!value.trim() || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
