import { createToken } from '@zhin.js/plugin-runtime';
import {
  type WorkroomEffectAuthorization,
  type WorkroomEffectAuthorizationPort,
  type WorkroomEffectGatewayReceipt,
  type WorkroomEffectState,
} from '../workroom/effect-ledger.js';
import {
  GitWorkspaceGateway,
  createGitWorkspaceLease,
  type GitWorkspaceCredentialPort,
  type GitWorkspaceLease,
  type GitWorkspaceTransportPort,
} from '../workroom/git-workspace-gateway.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { WorkroomEffectGatewayPort } from './workroom-effect-runtime.js';

export interface WorkroomPersistedEffectAuthorizationFacts {
  readonly version: 1;
  readonly projectId: string;
  readonly runId: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly candidateHash: string;
  readonly risk: Readonly<{ assessmentRef: string; assessmentDigest: string }>;
  readonly policy: Readonly<{ id: string; revision: number; digest: string }>;
  readonly policyDecision: Readonly<{ ref: string; digest: string }>;
  readonly scope: Readonly<{
    assignmentAttempt: number;
    workspaceFence: number;
    workspaceRef: string;
    workspaceDigest: string;
    preconditionsDigest: string;
    deadline: number;
  }>;
  readonly sponsor: Readonly<{
    decision: 'approved';
    decisionRef: string;
    decisionDigest: string;
    principalId: string;
  }>;
  readonly authorizationId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface WorkroomPersistedEffectAuthorizationFactsPort {
  resolve(input: Readonly<{
    projectId: string;
    expectedSequence: number;
    intentId: string;
    intentDigest: string;
  }>): Promise<WorkroomPersistedEffectAuthorizationFacts | null>;
}

export const workroomPersistedEffectAuthorizationFactsToken =
  createToken<WorkroomPersistedEffectAuthorizationFactsPort>(
    'zhin.agent.workroom-persisted-effect-authorization-facts',
    'P7 persisted candidate/risk/policy/Sponsor facts for exact Effect authorization',
  );

/** Generation facade: an Effect caller can never attach its own Sponsor claim. */
export class GenerationOwnedP7EffectAuthorization implements WorkroomEffectAuthorizationPort {
  constructor(readonly resolveFacts: () => WorkroomPersistedEffectAuthorizationFactsPort | undefined) {}

  async authorize(input: Parameters<WorkroomEffectAuthorizationPort['authorize']>[0]): Promise<WorkroomEffectAuthorization> {
    const port = this.resolveFacts();
    if (!port) throw new Error('P7 persisted Effect Authorization facts are unavailable');
    const facts = await port.resolve({
      projectId: input.projectId,
      expectedSequence: input.expectedSequence,
      intentId: input.intent.id,
      intentDigest: input.intent.digest,
    });
    if (!facts) throw new Error('P7 has not authorized this exact Effect Intent');
    assertAuthorizationFacts(facts, input);
    return deepFreeze({
      version: 1,
      authorized: true,
      intentId: input.intent.id,
      intentDigest: input.intent.digest,
      candidateHash: input.intent.candidateHash,
      authorizationId: facts.authorizationId,
      authorizationDigest: digest(facts),
      policy: facts.policy,
      authorizedBy: `p7-sponsor:${facts.sponsor.principalId}:${facts.sponsor.decisionDigest}`,
      expiresAt: facts.expiresAt,
    });
  }
}

export interface WorkroomGitWorkspaceLeaseAuthorityPort {
  resolve(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
    leaseRef: string;
    leaseDigest: string;
  }>): Promise<GitWorkspaceLease | null>;
}

export const workroomGitWorkspaceLeaseAuthorityToken =
  createToken<WorkroomGitWorkspaceLeaseAuthorityPort>(
    'zhin.agent.workroom-git-workspace-lease-authority',
    'Trusted exact Git Workspace Lease resolver',
  );

export interface WorkroomGitBranchProtectionAttestation {
  readonly version: 1;
  readonly repositoryId: string;
  readonly targetRef: string;
  readonly directPushForbidden: true;
  readonly forcePushForbidden: true;
  readonly pullRequestRequired: true;
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly observedAt: number;
  readonly digest: string;
}

export interface WorkroomGitBranchProtectionAuthorityPort {
  attest(input: Readonly<{
    projectId: string;
    leaseDigest: string;
    repositoryId: string;
    targetRef: string;
  }>): Promise<WorkroomGitBranchProtectionAttestation>;
}

export const workroomGitBranchProtectionAuthorityToken =
  createToken<WorkroomGitBranchProtectionAuthorityPort>(
    'zhin.agent.workroom-git-branch-protection-authority',
    'Trusted Git provider branch-protection attestation',
  );

export interface WorkroomGitHubReconciliationObservation {
  readonly outcome: 'committed' | 'failed' | 'outcome_unknown';
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly remoteRef: string;
  readonly remoteDigest: string;
  readonly observedAt: number;
  readonly authenticatedBy: string;
}

export interface WorkroomGitHubCapabilityPort {
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly credentials: GitWorkspaceCredentialPort;
  readonly transport: GitWorkspaceTransportPort;
  reconcile(input: Readonly<{
    generation: number;
    state: WorkroomEffectState;
    lease: GitWorkspaceLease;
  }>, signal: AbortSignal): Promise<WorkroomGitHubReconciliationObservation>;
}

export const workroomGitHubCapabilityToken = createToken<WorkroomGitHubCapabilityPort>(
  'zhin.agent.workroom-github-capability',
  'Generation-owned GitHub API/credential capability; never exposes a token',
);

export interface ProductionGitWorkroomEffectGatewayOptions {
  readonly generation: number;
  readonly now?: () => number;
  readonly protectionMaxAgeMs?: number;
  readonly resolveLease: () => WorkroomGitWorkspaceLeaseAuthorityPort | undefined;
  readonly resolveProtection: () => WorkroomGitBranchProtectionAuthorityPort | undefined;
  readonly resolveCapability: () => WorkroomGitHubCapabilityPort | undefined;
}

/** Exact Effect Intent → Workspace Lease → protected Git provider join. */
export class ProductionGitWorkroomEffectGateway implements WorkroomEffectGatewayPort {
  readonly #now: () => number;
  readonly #protectionMaxAgeMs: number;

  constructor(readonly options: ProductionGitWorkroomEffectGatewayOptions) {
    this.#now = options.now ?? Date.now;
    this.#protectionMaxAgeMs = positive(options.protectionMaxAgeMs ?? 60_000, 'protectionMaxAgeMs');
  }

  async prepare(state: WorkroomEffectState, signal: AbortSignal): Promise<void> {
    await this.#resolve(state, signal, state.intent.operation.kind !== 'git_cancel_remote');
  }

  async execute(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    if (!state.authorization || !state.attempt) throw new Error('Effect execution requires authorized attempt');
    const { lease, capability } = await this.#resolve(
      state,
      signal,
      state.intent.operation.kind !== 'git_cancel_remote',
    );
    const gateway = new GitWorkspaceGateway({
      generation: this.options.generation,
      credentials: capability.credentials,
      transport: capability.transport,
      now: this.#now,
    });
    const operation = state.intent.operation;
    if (operation.kind === 'git_push') {
      const receipt = await gateway.push({
        operationId: state.attempt.operationId,
        lease,
        fence: lease.fence,
        ref: operation.parameters.ref,
        headSha: operation.parameters.headSha,
        changedPaths: operation.parameters.changedPaths,
        force: false,
      }, signal);
      assertProviderIdentity(receipt.provider, capability.provider);
      return effectReceipt(state, 'committed', receipt.provider, receipt.externalReceiptRef,
        receipt.externalReceiptDigest, this.#now(), capability.provider.id);
    }
    if (operation.kind === 'git_open_pr') {
      const receipt = await gateway.openPullRequest({
        operationId: state.attempt.operationId,
        lease,
        fence: lease.fence,
        headRef: operation.parameters.headRef,
        baseRef: operation.parameters.baseRef,
        headSha: operation.parameters.headSha,
      }, signal);
      assertProviderIdentity(receipt.provider, capability.provider);
      return effectReceipt(state, 'committed', receipt.provider, receipt.prRef,
        receipt.externalReceiptDigest, this.#now(), capability.provider.id);
    }
    if (operation.kind === 'git_cancel_remote') {
      const receipt = await gateway.cancel({
        operationId: state.attempt.operationId,
        lease,
        fence: lease.fence,
        remoteOperationId: operation.parameters.remoteOperationId,
      }, signal);
      assertProviderIdentity(receipt.provider, capability.provider);
      return effectReceipt(state, receipt.acknowledged ? 'committed' : 'outcome_unknown', receipt.provider,
        receipt.externalReceiptRef, receipt.externalReceiptDigest, this.#now(), capability.provider.id);
    }
    throw new Error('Compensation requires a separately registered typed capability');
  }

  async reconcile(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    if (!state.authorization || !state.attempt) throw new Error('Effect reconciliation requires authorized attempt');
    const { lease, capability } = await this.#resolve(state, signal, false);
    const observation = await capability.reconcile({
      generation: this.options.generation,
      state,
      lease,
    }, signal);
    if (canonicalWorkroomJson(observation.provider) !== canonicalWorkroomJson(capability.provider)) {
      throw new Error('GitHub reconciliation provider identity drift');
    }
    return effectReceipt(state, observation.outcome, observation.provider, observation.remoteRef,
      observation.remoteDigest, observation.observedAt, observation.authenticatedBy);
  }

  async #resolve(state: WorkroomEffectState, signal: AbortSignal, requireProtection: boolean): Promise<{
    lease: GitWorkspaceLease;
    capability: WorkroomGitHubCapabilityPort;
  }> {
    signal.throwIfAborted();
    if (state.intent.operation.kind === 'processor_recall') {
      throw new Error('Processor recall requires its separately registered typed capability');
    }
    const authority = this.options.resolveLease();
    if (!authority) throw new Error('Trusted Git Workspace Lease authority is unavailable');
    const lease = await authority.resolve({
      projectId: state.intent.projectId,
      runId: state.intent.runId,
      taskKey: state.intent.taskKey,
      taskRevision: state.intent.taskRevision,
      leaseRef: state.intent.target.ref,
      leaseDigest: state.intent.target.digest,
    });
    if (!lease) throw new Error('Exact Git Workspace Lease is unavailable');
    const canonical = createGitWorkspaceLease(lease);
    assertLeaseJoin(canonical, state);
    const capability = this.options.resolveCapability();
    if (!capability) throw new Error('Generation-owned GitHub capability is unavailable');
    requireProvider(capability.provider);
    if (requireProtection) {
      const protection = this.options.resolveProtection();
      if (!protection) throw new Error('Git branch-protection authority is unavailable');
      assertProtection(await protection.attest({
        projectId: state.intent.projectId,
        leaseDigest: canonical.digest,
        repositoryId: canonical.repository.id,
        targetRef: canonical.targetRef,
      }), canonical, capability.provider, this.#now(), this.#protectionMaxAgeMs);
    }
    return { lease: canonical, capability };
  }
}

function assertAuthorizationFacts(
  facts: WorkroomPersistedEffectAuthorizationFacts,
  input: Parameters<WorkroomEffectAuthorizationPort['authorize']>[0],
): void {
  if (facts.version !== 1 || facts.projectId !== input.projectId || facts.runId !== input.intent.runId
    || facts.intentId !== input.intent.id || facts.intentDigest !== input.intent.digest
    || facts.candidateHash !== input.intent.candidateHash
    || facts.risk.assessmentRef !== input.intent.risk.assessmentRef
    || facts.risk.assessmentDigest !== input.intent.risk.assessmentDigest
    || facts.scope.workspaceRef !== input.intent.target.ref
    || facts.scope.workspaceDigest !== input.intent.target.digest
    || facts.scope.preconditionsDigest !== digest(input.intent.preconditions)
    || facts.sponsor.decision !== 'approved' || facts.expiresAt <= input.now
    || facts.issuedAt > input.now || facts.expiresAt > facts.scope.deadline) {
    throw new Error('P7 persisted Effect Authorization fact binding drift');
  }
  required(facts.authorizationId, 'authorizationId');
  required(facts.policy.id, 'policy id');
  positive(facts.policy.revision, 'policy revision');
  requiredDigest(facts.policy.digest, 'policy digest');
  required(facts.policyDecision.ref, 'policy decision ref');
  requiredDigest(facts.policyDecision.digest, 'policy decision digest');
  positive(facts.scope.assignmentAttempt, 'Assignment attempt');
  positive(facts.scope.workspaceFence, 'Workspace fence');
  positive(facts.scope.deadline, 'authorization deadline');
  required(facts.sponsor.decisionRef, 'Sponsor decision ref');
  requiredDigest(facts.sponsor.decisionDigest, 'Sponsor decision digest');
  required(facts.sponsor.principalId, 'Sponsor principal');
  positive(facts.issuedAt, 'authorization issuedAt');
  positive(facts.expiresAt, 'authorization expiresAt');
}

function assertLeaseJoin(lease: GitWorkspaceLease, state: WorkroomEffectState): void {
  const operation = state.intent.operation;
  if (operation.kind === 'compensation') {
    throw new Error('Compensation is not a Git Workspace publication operation');
  }
  if (operation.kind === 'processor_recall') {
    throw new Error('Processor recall is not a Git Workspace publication operation');
  }
  if (lease.leaseRef !== state.intent.target.ref || lease.digest !== state.intent.target.digest
    || lease.projectId !== state.intent.projectId || lease.runId !== state.intent.runId
    || lease.taskKey !== state.intent.taskKey || lease.taskRevision !== state.intent.taskRevision
    || lease.repository.id !== operation.parameters.repositoryId) {
    throw new Error('Effect Intent and Git Workspace Lease binding drift');
  }
  if (operation.kind === 'git_push'
    && (operation.parameters.ref !== lease.attemptBranch
      || !operation.parameters.changedPaths.every(path =>
        lease.pathScopes.some(scope => path === scope || (scope.endsWith('/') && path.startsWith(scope)))))) {
    throw new Error('Git push Effect exceeds Workspace Lease');
  }
  if (operation.kind === 'git_open_pr'
    && (operation.parameters.headRef !== lease.attemptBranch
      || operation.parameters.baseRef !== lease.targetRef)) {
    throw new Error('Git Pull Request Effect exceeds Workspace Lease');
  }
}

function assertProtection(
  value: WorkroomGitBranchProtectionAttestation,
  lease: GitWorkspaceLease,
  provider: Readonly<{ id: string; digest: string }>,
  now: number,
  maxAgeMs: number,
): void {
  positive(value.observedAt, 'branch protection observedAt');
  const body = deepFreeze({
    version: 1 as const,
    repositoryId: value.repositoryId,
    targetRef: value.targetRef,
    directPushForbidden: value.directPushForbidden,
    forcePushForbidden: value.forcePushForbidden,
    pullRequestRequired: value.pullRequestRequired,
    provider: value.provider,
    observedAt: value.observedAt,
  });
  if (value.repositoryId !== lease.repository.id || value.targetRef !== lease.targetRef
    || value.directPushForbidden !== true || value.forcePushForbidden !== true
    || value.pullRequestRequired !== true
    || canonicalWorkroomJson(value.provider) !== canonicalWorkroomJson(provider)
    || value.observedAt > now || value.observedAt < now - maxAgeMs
    || value.digest !== digest(body)) {
    throw new Error('Git branch-protection attestation drift');
  }
}

function effectReceipt(
  state: WorkroomEffectState,
  outcome: WorkroomEffectGatewayReceipt['outcome'],
  provider: Readonly<{ id: string; digest: string }>,
  remoteRef: string,
  remoteDigest: string,
  observedAt: number,
  authenticatedBy: string,
): WorkroomEffectGatewayReceipt {
  if (!state.authorization || !state.attempt) throw new Error('Effect receipt requires authorized attempt');
  requireProvider(provider);
  return deepFreeze({
    version: 1,
    receiptId: `effect-receipt:${state.attempt.id}:${remoteDigest}`,
    intentId: state.intent.id,
    intentDigest: state.intent.digest,
    authorizationDigest: state.authorization.authorizationDigest,
    attemptId: state.attempt.id,
    fence: state.attempt.fence,
    provider,
    outcome,
    remoteRef: required(remoteRef, 'remoteRef'),
    remoteDigest: requiredDigest(remoteDigest, 'remoteDigest'),
    observedAt: positive(observedAt, 'observedAt'),
    authenticatedBy: required(authenticatedBy, 'authenticatedBy'),
  });
}

function requireProvider(value: Readonly<{ id: string; digest: string }>): void {
  required(value?.id, 'provider id');
  requiredDigest(value?.digest, 'provider digest');
}

function assertProviderIdentity(
  actual: Readonly<{ id: string; digest: string }>,
  expected: Readonly<{ id: string; digest: string }>,
): void {
  if (canonicalWorkroomJson(actual) !== canonicalWorkroomJson(expected)) {
    throw new Error('GitHub provider receipt identity drift');
  }
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
