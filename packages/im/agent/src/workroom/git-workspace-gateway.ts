import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';

export interface GitWorkspaceLeaseInput {
  readonly leaseRef: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly attempt: number;
  readonly fence: number;
  readonly repository: Readonly<{ id: string; bindingRef: string; bindingDigest: string }>;
  readonly baseSha: string;
  readonly checkpointSha?: string;
  readonly targetRef: string;
  readonly attemptBranch: string;
  readonly pathScopes: readonly string[];
  readonly mode: 'branch_only' | 'pull_request';
  readonly expiresAt: number;
}

export interface GitWorkspaceLease extends GitWorkspaceLeaseInput {
  readonly version: 1;
  readonly digest: string;
}

export interface GitWorkspaceCredential {
  readonly credentialId: string;
  readonly secret: string;
  readonly expiresAt: number;
}

export interface GitWorkspaceCredentialPort {
  resolve(input: Readonly<{
    generation: number;
    leaseDigest: string;
    repositoryId: string;
    bindingRef: string;
    bindingDigest: string;
    operation: 'git_push' | 'git_open_pr' | 'git_cancel_remote';
  }>, signal: AbortSignal): Promise<GitWorkspaceCredential>;
}

interface GitPushTransportInput {
  readonly operationId: string;
  readonly repositoryId: string;
  readonly ref: string;
  readonly headSha: string;
  readonly force: false;
  readonly idempotencyKey: string;
}

interface GitPullRequestTransportInput {
  readonly operationId: string;
  readonly repositoryId: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly headSha: string;
  readonly idempotencyKey: string;
}

export interface GitWorkspaceTransportPort {
  push(input: GitPushTransportInput, credential: GitWorkspaceCredential, signal: AbortSignal): Promise<GitPushReceipt>;
  openPullRequest(
    input: GitPullRequestTransportInput,
    credential: GitWorkspaceCredential,
    signal: AbortSignal,
  ): Promise<GitPullRequestReceipt>;
  cancel(
    input: Readonly<{ operationId: string; repositoryId: string; remoteOperationId: string; idempotencyKey: string }>,
    credential: GitWorkspaceCredential,
    signal: AbortSignal,
  ): Promise<Readonly<{
    repositoryId: string;
    remoteOperationId: string;
    acknowledged: boolean;
    provider: { id: string; digest: string };
    receiptRef: string;
    receiptDigest: string;
  }>>;
}

export interface GitPushReceipt {
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly repositoryId: string;
  readonly ref: string;
  readonly headSha: string;
  readonly externalReceiptRef: string;
  readonly externalReceiptDigest: string;
}

export interface GitPullRequestReceipt {
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly repositoryId: string;
  readonly prRef: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly prHeadSha: string;
  readonly externalReceiptDigest: string;
}

export interface GitCancelReceipt {
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly repositoryId: string;
  readonly remoteOperationId: string;
  readonly acknowledged: boolean;
  readonly externalReceiptRef: string;
  readonly externalReceiptDigest: string;
}

export function createGitWorkspaceLease(input: GitWorkspaceLeaseInput): GitWorkspaceLease {
  const expectedBranch = `refs/heads/zhin/${required(input.runId, 'runId')}/${required(input.assignmentId, 'assignmentId')}/attempt-${positive(input.attempt, 'attempt')}`;
  const repositoryId = required(input.repository?.id, 'repository id');
  if (!/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repositoryId)) {
    throw new Error('Git Workspace canonical repository ID is invalid');
  }
  if (repositoryId !== repositoryId.toLowerCase()) {
    throw new Error('Git Workspace canonical repository ID must be lowercase');
  }
  const targetRef = branchRef(input.targetRef, 'targetRef');
  const attemptBranch = branchRef(input.attemptBranch, 'attemptBranch');
  if (attemptBranch !== expectedBranch || attemptBranch === targetRef) {
    throw new Error('Git Workspace attempt branch is not the exact per-attempt branch');
  }
  if (!Array.isArray(input.pathScopes) || input.pathScopes.length === 0) {
    throw new Error('Git Workspace requires explicit path scope');
  }
  const pathScopes = Object.freeze(input.pathScopes.map(scope => canonicalPath(scope, 'path scope')).sort());
  if (new Set(pathScopes).size !== pathScopes.length) throw new Error('Git Workspace path scopes contain duplicates');
  const body = deepFreeze({
    version: 1 as const,
    leaseRef: required(input.leaseRef, 'leaseRef'),
    projectId: required(input.projectId, 'projectId'),
    runId: input.runId,
    taskKey: required(input.taskKey, 'taskKey'),
    taskRevision: positive(input.taskRevision, 'taskRevision'),
    assignmentId: input.assignmentId,
    attempt: input.attempt,
    fence: positive(input.fence, 'fence'),
    repository: deepFreeze({
      id: repositoryId,
      bindingRef: required(input.repository.bindingRef, 'repository bindingRef'),
      bindingDigest: requiredDigest(input.repository.bindingDigest, 'repository bindingDigest'),
    }),
    baseSha: gitSha(input.baseSha, 'baseSha'),
    ...(input.checkpointSha === undefined
      ? {}
      : { checkpointSha: gitSha(input.checkpointSha, 'checkpointSha') }),
    targetRef,
    attemptBranch,
    pathScopes,
    mode: enumValue(input.mode, ['branch_only', 'pull_request'], 'workspace mode'),
    expiresAt: positive(input.expiresAt, 'expiresAt'),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface GitWorkspaceGatewayOptions {
  readonly generation: number;
  readonly credentials: GitWorkspaceCredentialPort;
  readonly transport: GitWorkspaceTransportPort;
  readonly now?: () => number;
}

/** The only component that sees credentials; callers supply only an immutable lease. */
export class GitWorkspaceGateway {
  readonly #generation: number;
  readonly #now: () => number;

  constructor(readonly options: GitWorkspaceGatewayOptions) {
    this.#generation = positive(options.generation, 'generation');
    this.#now = options.now ?? Date.now;
  }

  async push(input: Readonly<{
    operationId: string;
    lease: GitWorkspaceLease;
    fence: number;
    ref: string;
    headSha: string;
    changedPaths: readonly string[];
    force: boolean;
  }>, signal: AbortSignal): Promise<GitPushReceipt> {
    signal.throwIfAborted();
    const lease = assertLease(input.lease);
    this.#assertActive(lease);
    assertFence(lease, input.fence);
    if (input.ref === lease.targetRef) throw new Error('Git Workspace Gateway forbids canonical target push');
    if (input.ref !== lease.attemptBranch) throw new Error('Git Workspace Gateway push ref is outside the lease');
    if (input.force !== false) throw new Error('Force push is forbidden');
    assertChangedPaths(input.changedPaths, lease.pathScopes);
    const headSha = gitSha(input.headSha, 'push headSha');
    const credential = await this.#credential(lease, 'git_push', signal);
    const request = deepFreeze({
      operationId: required(input.operationId, 'operationId'),
      repositoryId: lease.repository.id,
      ref: lease.attemptBranch,
      headSha,
      force: false as const,
      idempotencyKey: `git-push:${lease.digest}:${input.operationId}`,
    });
    const receipt = await this.options.transport.push(request, credential, signal);
    signal.throwIfAborted();
    return validatePushReceipt(receipt, request);
  }

  async openPullRequest(input: Readonly<{
    operationId: string;
    lease: GitWorkspaceLease;
    fence: number;
    headRef: string;
    baseRef: string;
    headSha: string;
  }>, signal: AbortSignal): Promise<GitPullRequestReceipt> {
    signal.throwIfAborted();
    const lease = assertLease(input.lease);
    this.#assertActive(lease);
    assertFence(lease, input.fence);
    if (lease.mode !== 'pull_request') throw new Error('Git Workspace lease does not allow Pull Requests');
    if (input.headRef !== lease.attemptBranch || input.baseRef !== lease.targetRef) {
      throw new Error('Pull Request refs are outside the exact Git Workspace lease');
    }
    const headSha = gitSha(input.headSha, 'Pull Request headSha');
    const credential = await this.#credential(lease, 'git_open_pr', signal);
    const request = deepFreeze({
      operationId: required(input.operationId, 'operationId'),
      repositoryId: lease.repository.id,
      headRef: lease.attemptBranch,
      baseRef: lease.targetRef,
      headSha,
      idempotencyKey: `git-pr:${lease.digest}:${input.operationId}`,
    });
    const receipt = await this.options.transport.openPullRequest(request, credential, signal);
    signal.throwIfAborted();
    return validatePullRequestReceipt(receipt, request);
  }

  async cancel(input: Readonly<{
    operationId: string;
    lease: GitWorkspaceLease;
    fence: number;
    remoteOperationId: string;
  }>, signal: AbortSignal): Promise<GitCancelReceipt> {
    signal.throwIfAborted();
    const lease = assertLease(input.lease);
    this.#assertActive(lease);
    assertFence(lease, input.fence);
    const operationId = required(input.operationId, 'operationId');
    const remoteOperationId = required(input.remoteOperationId, 'remoteOperationId');
    const credential = await this.#credential(lease, 'git_cancel_remote', signal);
    const receipt = await this.options.transport.cancel(deepFreeze({
      operationId,
      repositoryId: lease.repository.id,
      remoteOperationId,
      idempotencyKey: `git-cancel:${lease.digest}:${operationId}`,
    }), credential, signal);
    signal.throwIfAborted();
    validateProvider(receipt.provider);
    if (receipt.repositoryId !== lease.repository.id
      || receipt.remoteOperationId !== remoteOperationId) {
      throw new Error('Git cancel receipt binding drift');
    }
    required(receipt.receiptRef, 'cancel receiptRef');
    requiredDigest(receipt.receiptDigest, 'cancel receiptDigest');
    return deepFreeze({
      provider: receipt.provider,
      repositoryId: lease.repository.id,
      remoteOperationId,
      acknowledged: receipt.acknowledged === true,
      externalReceiptRef: receipt.receiptRef,
      externalReceiptDigest: receipt.receiptDigest,
    });
  }

  async #credential(
    lease: GitWorkspaceLease,
    operation: 'git_push' | 'git_open_pr' | 'git_cancel_remote',
    signal: AbortSignal,
  ): Promise<GitWorkspaceCredential> {
    const credential = await this.options.credentials.resolve({
      generation: this.#generation,
      leaseDigest: lease.digest,
      repositoryId: lease.repository.id,
      bindingRef: lease.repository.bindingRef,
      bindingDigest: lease.repository.bindingDigest,
      operation,
    }, signal);
    required(credential?.credentialId, 'credentialId');
    required(credential?.secret, 'credential secret');
    positive(credential?.expiresAt, 'credential expiresAt');
    if (credential.expiresAt <= this.#now()) throw new Error('Git Workspace credential is expired');
    return credential;
  }

  #assertActive(lease: GitWorkspaceLease): void {
    if (lease.expiresAt <= this.#now()) throw new Error('Git Workspace Lease is expired');
  }
}

function validatePushReceipt(receipt: GitPushReceipt, input: GitPushTransportInput): GitPushReceipt {
  validateProvider(receipt.provider);
  if (receipt.repositoryId !== input.repositoryId || receipt.ref !== input.ref
    || receipt.headSha !== input.headSha) {
    throw new Error('Git push receipt binding drift');
  }
  required(receipt.externalReceiptRef, 'push externalReceiptRef');
  requiredDigest(receipt.externalReceiptDigest, 'push externalReceiptDigest');
  return deepFreeze(receipt);
}

function validatePullRequestReceipt(
  receipt: GitPullRequestReceipt,
  input: GitPullRequestTransportInput,
): GitPullRequestReceipt {
  validateProvider(receipt.provider);
  if (receipt.repositoryId !== input.repositoryId || receipt.headRef !== input.headRef
    || receipt.baseRef !== input.baseRef || receipt.prHeadSha !== input.headSha) {
    throw new Error('Pull Request receipt head SHA or ref binding drift');
  }
  required(receipt.prRef, 'Pull Request ref');
  requiredDigest(receipt.externalReceiptDigest, 'Pull Request externalReceiptDigest');
  return deepFreeze(receipt);
}

function validateProvider(value: Readonly<{ id: string; digest: string }>): void {
  required(value?.id, 'provider id');
  requiredDigest(value?.digest, 'provider digest');
}

function assertLease(value: GitWorkspaceLease): GitWorkspaceLease {
  const canonical = createGitWorkspaceLease(value);
  if (value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Git Workspace Lease digest drift');
  }
  return canonical;
}

function assertFence(lease: GitWorkspaceLease, fence: number): void {
  if (fence !== lease.fence) throw new Error('Git Workspace fence is stale');
}

function assertChangedPaths(paths: readonly string[], scopes: readonly string[]): void {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('Git push requires changed paths');
  for (const path of paths) {
    const canonical = canonicalPath(path, 'changed path');
    if (!scopes.some(scope => canonical === scope
      || (scope.endsWith('/') && canonical.startsWith(scope)))) {
      throw new Error(`Git changed path is outside lease path scope: ${canonical}`);
    }
  }
}

function canonicalPath(value: unknown, label: string): string {
  const path = required(value, label);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.')) {
    throw new Error(`${label} is not a canonical repository path`);
  }
  return path;
}

function branchRef(value: unknown, label: string): string {
  const ref = required(value, label);
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(ref) || ref.includes('..')
    || ref.includes('//') || ref.endsWith('/')) {
    throw new Error(`${label} is not a canonical branch ref`);
  }
  return ref;
}

function gitSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}
