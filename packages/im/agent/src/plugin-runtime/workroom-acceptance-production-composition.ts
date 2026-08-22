import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Scope } from '@zhin.js/plugin-runtime';
import type { WorkroomAcceptedReportReader } from '../workroom/accepted-source-memory-application.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import {
  replayWorkroomEffectLedger,
  type WorkroomEffectIntent,
  type WorkroomEffectJournal,
} from '../workroom/effect-ledger.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import type { WorkroomRunState } from '../workroom/kernel-contracts.js';
import { workroomAcceptanceAuthorityToken } from './workroom-acceptance-authority.js';
import { workroomAcceptancePolicyDecisionToken } from './workroom-acceptance-policy.js';
import {
  DurableWorkroomContextReleaseConsumer,
  EffectLedgerWorkroomAcceptanceState,
  KernelHeaderWorkroomRiskFacts,
  ProfileOwnedWorkroomAcceptanceProvider,
  TypedWorkroomAcceptanceCheckRunner,
  CatalogWorkroomAcceptancePrincipalRegistry,
  type WorkroomContextReleaseConsumerPort,
  type WorkroomGovernedAcceptanceProjectionPort,
  type WorkroomKernelRiskHeaderPort,
  type WorkroomTypedAcceptanceCheck,
} from './workroom-acceptance-provider-composition.js';
import {
  workroomExecutionContextReleaseToken,
  workroomProjectMemorySchemaAuthorityToken,
  type WorkroomContextReleaseRequest,
} from './workroom-accepted-source-runtime.js';
import {
  workroomAcceptancePrincipalRegistryToken,
  workroomReviewerViewReaderToken,
  ProfileWorkroomAcceptanceAuthority,
  WorkroomReviewerViewReader,
} from './workroom-reviewer-authority-runtime.js';
import {
  workroomAcceptanceCheckRunnerToken,
  workroomAcceptancePolicyFactsToken,
  workroomTrustedRiskFactsToken,
  PinnedWorkroomAcceptancePolicy,
} from './workroom-risk-acceptance-runtime.js';
import {
  workroomPersistedEffectAuthorizationFactsToken,
  type WorkroomPersistedEffectAuthorizationFacts,
  type WorkroomPersistedEffectAuthorizationFactsPort,
} from './workroom-effect-production.js';

export interface WorkroomEffectSponsorDecisionBinding {
  readonly effectIntentId: string;
  readonly effectIntentDigest: string;
  readonly candidateHash: string;
  readonly assignmentAttempt: number;
  readonly workspaceFence: number;
  readonly workspaceRef: string;
  readonly workspaceDigest: string;
  readonly preconditionsDigest: string;
  readonly risk: WorkroomEffectIntent['risk'];
  readonly policy: Readonly<{ id: string; revision: number; digest: string }>;
  readonly deadline: number;
}

export type WorkroomEffectSponsorDecisionReasonCode =
  | 'approved_as_requested'
  | 'rejected_policy'
  | 'rejected_scope'
  | 'rejected_risk'
  | 'rejected_by_sponsor';

export interface WorkroomEffectSponsorDecisionCommand {
  readonly version: 2;
  readonly operationId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly effectIntentId: string;
  readonly effectIntentDigest: string;
  readonly principalId: string;
  readonly decision: 'approve' | 'reject';
  /** Closed, content-free code. Human rationale belongs in a governed payload, never this repository. */
  readonly reasonCode: WorkroomEffectSponsorDecisionReasonCode;
  readonly decidedAt: number;
}

interface WorkroomEffectSponsorDecisionRequest extends WorkroomEffectSponsorDecisionCommand {
  readonly digest: string;
}

export type WorkroomEffectSponsorDecisionAuthorityResult = Readonly<{
  authorized: true;
  authorizedBy: string;
  catalogRevision: string;
  projectDigest: string;
  profileRef: string;
  profileDigest: string;
  profileRevision: number;
  binding: WorkroomEffectSponsorDecisionBinding;
  requestDigest: string;
}> | Readonly<{ authorized: false; requestDigest: string; reason: string }>;

export interface WorkroomEffectSponsorDecisionAuthorityPort {
  authorize(request: WorkroomEffectSponsorDecisionRequest): Promise<WorkroomEffectSponsorDecisionAuthorityResult>;
}

export interface WorkroomEffectSponsorDecisionScopePort {
  resolve(input: Readonly<{
    request: WorkroomEffectSponsorDecisionRequest;
    intent: WorkroomEffectIntent;
  }>): Promise<WorkroomEffectSponsorDecisionBinding | null>;
}

export interface WorkroomEffectSponsorDecisionRecord extends WorkroomEffectSponsorDecisionCommand {
  readonly binding: WorkroomEffectSponsorDecisionBinding;
  readonly authorizedBy: string;
  readonly catalogRevision: string;
  readonly projectDigest: string;
  readonly profileRef: string;
  readonly profileDigest: string;
  readonly profileRevision: number;
  readonly requestDigest: string;
  readonly digest: string;
}

interface WorkroomEffectSponsorLegacyDecisionQuarantineReceipt {
  readonly version: 1;
  readonly kind: 'workroom_effect_sponsor_legacy_decision_quarantine';
  readonly effectIntentRef: string;
  readonly status: 'quarantined';
  readonly disposition: 'superseded_by_v2';
  readonly legacyDecisionDigest: string;
  readonly successorDecisionDigest: string;
  readonly digest: string;
}

type WorkroomEffectSponsorLegacyDecisionSlot =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'v1'; digest: string }>
  | Readonly<{ kind: 'quarantined'; receipt: WorkroomEffectSponsorLegacyDecisionQuarantineReceipt }>
  | Readonly<{ kind: 'v2'; decision: WorkroomEffectSponsorDecisionRecord }>;

export interface WorkroomEffectAuthorizationPolicyPort {
  authorize(input: Readonly<{
    projectId: string;
    intent: WorkroomEffectIntent;
    candidateHash: string;
    acceptancePolicy: WorkroomEffectSponsorDecisionBinding['policy'];
    sponsorDecision: WorkroomEffectSponsorDecisionRecord;
  }>): Promise<Readonly<{
    approved: true;
    policy: WorkroomEffectSponsorDecisionBinding['policy'];
    expiresAt: number;
    policyDecisionRef: string;
    policyDecisionDigest: string;
  }> | null>;
}

export interface WorkroomEffectSponsorDecisionControlPort {
  decide(command: WorkroomEffectSponsorDecisionCommand): Promise<WorkroomEffectSponsorDecisionRecord>;
}

export interface SponsorDecisionWorkroomEffectAuthorizationProjectorOptions {
  readonly directory: string;
  readonly effectJournal: WorkroomEffectJournal;
  readonly sponsorAuthority: WorkroomEffectSponsorDecisionAuthorityPort;
  readonly policy: WorkroomEffectAuthorizationPolicyPort;
}

/**
 * Dedicated Effect approval plane. It never reads discussion or Acceptance
 * Sponsor Gate events and it has no Task/Assignment writer.
 */
export class SponsorDecisionWorkroomEffectAuthorizationProjector
implements WorkroomPersistedEffectAuthorizationFactsPort {
  readonly #store: DurableFileStore;
  readonly control: WorkroomEffectSponsorDecisionControlPort;

  constructor(readonly options: SponsorDecisionWorkroomEffectAuthorizationProjectorOptions) {
    this.#store = new DurableFileStore(options.directory);
    this.control = Object.freeze({
      decide: async (command: WorkroomEffectSponsorDecisionCommand) => await this.#decide(command),
    });
  }

  async drainProject(projectId: string): Promise<number> {
    const states = replayWorkroomEffectLedger(projectId, await this.options.effectJournal.read(projectId));
    let projected = 0;
    for (const state of Object.values(states)) {
      if (state.status !== 'pending_authorization') continue;
      const decision = await this.#readDecision(state.intent.id);
      if (!decision || decision.decision !== 'approve') continue;
      const existing = await this.#readFact(state.intent.id);
      if (existing) continue;
      assertDecisionIntentBinding(decision, state.intent);
      const policy = await this.options.policy.authorize({
        projectId,
        intent: state.intent,
        candidateHash: state.intent.candidateHash,
        acceptancePolicy: decision.binding.policy,
        sponsorDecision: decision,
      });
      if (!policy) continue;
      if (canonicalWorkroomJson(policy.policy) !== canonicalWorkroomJson(decision.binding.policy)
        || policy.expiresAt > decision.binding.deadline
        || policy.expiresAt <= decision.decidedAt) {
        throw new Error('P8 Effect Authorization policy returned a stale decision');
      }
      required(policy.policyDecisionRef, 'Effect policy decision ref');
      requiredDigest(policy.policyDecisionDigest, 'Effect policy decision digest');
      const fact = deepFreeze<WorkroomPersistedEffectAuthorizationFacts>({
        version: 1,
        projectId,
        runId: state.intent.runId,
        intentId: state.intent.id,
        intentDigest: state.intent.digest,
        candidateHash: state.intent.candidateHash,
        risk: {
          assessmentRef: state.intent.risk.assessmentRef,
          assessmentDigest: state.intent.risk.assessmentDigest,
        },
        policy: policy.policy,
        policyDecision: {
          ref: policy.policyDecisionRef,
          digest: policy.policyDecisionDigest,
        },
        scope: {
          assignmentAttempt: decision.binding.assignmentAttempt,
          workspaceFence: decision.binding.workspaceFence,
          workspaceRef: decision.binding.workspaceRef,
          workspaceDigest: decision.binding.workspaceDigest,
          preconditionsDigest: decision.binding.preconditionsDigest,
          deadline: decision.binding.deadline,
        },
        sponsor: {
          decision: 'approved',
          decisionRef: `effect-sponsor-decision:${decision.digest}`,
          decisionDigest: decision.digest,
          principalId: decision.principalId,
        },
        authorizationId: `effect-authorization:${digest({
          intentDigest: state.intent.digest,
          sponsorDecisionDigest: decision.digest,
          policyDecisionDigest: policy.policyDecisionDigest,
        })}`,
        issuedAt: decision.decidedAt,
        expiresAt: policy.expiresAt,
      });
      await this.#publishFact(fact);
      projected += 1;
    }
    return projected;
  }

  async resolve(input: Parameters<WorkroomPersistedEffectAuthorizationFactsPort['resolve']>[0]) {
    const events = await this.options.effectJournal.read(input.projectId);
    if (events.length - 1 !== input.expectedSequence) {
      throw new Error('Effect Authorization facts target a stale Effect Ledger sequence');
    }
    const state = replayWorkroomEffectLedger(input.projectId, events)[input.intentId];
    if (!state || state.intent.digest !== input.intentDigest || state.status !== 'pending_authorization') return null;
    const fact = await this.#readFact(input.intentId);
    if (!fact || fact.intentDigest !== input.intentDigest || fact.projectId !== input.projectId) return null;
    return fact;
  }

  async #decide(command: WorkroomEffectSponsorDecisionCommand): Promise<WorkroomEffectSponsorDecisionRecord> {
    const request = createDecisionRequest(command);
    const states = replayWorkroomEffectLedger(
      request.projectId,
      await this.options.effectJournal.read(request.projectId),
    );
    const state = states[request.effectIntentId];
    if (!state || state.status !== 'pending_authorization'
      || state.intent.runId !== request.runId
      || state.intent.digest !== request.effectIntentDigest) {
      throw new Error('Effect Sponsor decision targets a stale or started Effect Intent');
    }
    const authority = await this.options.sponsorAuthority.authorize(request);
    if (!authority.authorized) throw new Error(`Effect Sponsor decision unauthorized: ${authority.reason}`);
    assertSponsorAuthority(authority, request, state.intent);
    const { digest: requestDigest, ...requestBody } = request;
    const body = deepFreeze({
      ...requestBody,
      binding: authority.binding,
      authorizedBy: authority.authorizedBy,
      catalogRevision: authority.catalogRevision,
      projectDigest: authority.projectDigest,
      profileRef: authority.profileRef,
      profileDigest: authority.profileDigest,
      profileRevision: authority.profileRevision,
      requestDigest,
    });
    const record = deepFreeze({ ...body, digest: digest(body) });
    await this.#store.ensureDurableLeaf('Workroom Effect Sponsor decision repository');
    const existingV2 = await this.#readV2Decision(record.effectIntentId);
    if (existingV2) {
      const verified = await this.#readDecision(record.effectIntentId);
      if (!verified || canonicalWorkroomJson(verified) !== canonicalWorkroomJson(record)) {
        throw new Error('Workroom Effect Sponsor decision CAS conflict');
      }
      return verified;
    }
    const legacy = await this.#readLegacyDecisionSlot(record.effectIntentId);
    const existingReceipt = await this.#readLegacyQuarantineReceipt(record.effectIntentId);
    if (legacy.kind === 'v2') {
      if (existingReceipt || canonicalWorkroomJson(legacy.decision) !== canonicalWorkroomJson(record)) {
        throw new Error('Workroom Effect Sponsor decision CAS conflict');
      }
      return legacy.decision;
    }
    if (legacy.kind === 'v1') {
      const receipt = createLegacyDecisionQuarantineReceipt(
        record.effectIntentId,
        legacy.digest,
        record.digest,
      );
      await this.#publishLegacyQuarantineReceipt(record.effectIntentId, receipt);
      await this.#assertLegacyDecisionSupersession(record.effectIntentId, record, receipt);
      await this.#store.removeIfExists(this.#legacyDecisionTarget(record.effectIntentId), true);
      await this.#store.publishCreateOnly({
        target: this.#legacyDecisionTarget(record.effectIntentId),
        content: canonicalWorkroomJson(receipt),
        createdValue: receipt,
        onConflict: async () => {
          const slot = await this.#readLegacyDecisionSlot(record.effectIntentId);
          if (slot.kind !== 'quarantined'
            || canonicalWorkroomJson(slot.receipt) !== canonicalWorkroomJson(receipt)) {
            throw new Error('Workroom Effect Sponsor legacy plaintext tombstone conflict');
          }
          return slot.receipt;
        },
      });
      if ((await this.#readLegacyDecisionSlot(record.effectIntentId)).kind !== 'quarantined') {
        throw new Error('Workroom Effect Sponsor legacy plaintext decision purge failed');
      }
    } else if (legacy.kind === 'quarantined') {
      if (!existingReceipt
        || canonicalWorkroomJson(legacy.receipt) !== canonicalWorkroomJson(existingReceipt)
        || existingReceipt.successorDecisionDigest !== record.digest) {
        throw new Error('Workroom Effect Sponsor legacy decision quarantine receipt is orphaned');
      }
    } else if (existingReceipt) {
      if (existingReceipt.successorDecisionDigest !== record.digest) {
        throw new Error('Workroom Effect Sponsor legacy decision quarantine receipt is orphaned');
      }
      await this.#store.publishCreateOnly({
        target: this.#legacyDecisionTarget(record.effectIntentId),
        content: canonicalWorkroomJson(existingReceipt),
        createdValue: existingReceipt,
        onConflict: async () => {
          const slot = await this.#readLegacyDecisionSlot(record.effectIntentId);
          if (slot.kind !== 'quarantined'
            || canonicalWorkroomJson(slot.receipt) !== canonicalWorkroomJson(existingReceipt)) {
            throw new Error('Workroom Effect Sponsor legacy plaintext tombstone conflict');
          }
          return slot.receipt;
        },
      });
    }
    const target = this.#v2DecisionTarget(record.effectIntentId);
    const publication = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(record),
      createdValue: record,
      onConflict: async () => {
        const existing = await this.#readV2Decision(record.effectIntentId);
        if (!existing || canonicalWorkroomJson(existing) !== canonicalWorkroomJson(record)) {
          throw new Error('Workroom Effect Sponsor decision CAS conflict');
        }
        return existing;
      },
    });
    const verified = await this.#readDecision(record.effectIntentId);
    if (!verified || canonicalWorkroomJson(verified) !== canonicalWorkroomJson(publication.value)) {
      throw new Error('Workroom Effect Sponsor decision publication is incomplete');
    }
    return verified;
  }

  async #publishFact(fact: WorkroomPersistedEffectAuthorizationFacts): Promise<void> {
    await this.#store.ensureDurableLeaf('Workroom Effect Authorization fact repository');
    const target = this.#factTarget(fact.intentId);
    await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(fact),
      createdValue: fact,
      onConflict: async () => {
        const existing = await this.#readFact(fact.intentId);
        if (!existing || canonicalWorkroomJson(existing) !== canonicalWorkroomJson(fact)) {
          throw new Error('Workroom Effect Authorization fact CAS conflict');
        }
        return existing;
      },
    });
  }

  async #readDecision(effectIntentId: string): Promise<WorkroomEffectSponsorDecisionRecord | undefined> {
    const v2 = await this.#readV2Decision(effectIntentId);
    const legacy = await this.#readLegacyDecisionSlot(effectIntentId);
    const receipt = await this.#readLegacyQuarantineReceipt(effectIntentId);
    if (!v2) {
      if (receipt) {
        throw new Error('Workroom Effect Sponsor legacy decision migration is incomplete');
      }
      if (legacy.kind === 'v2') return legacy.decision;
      if (legacy.kind === 'v1') throw legacyDecisionQuarantineError();
      return undefined;
    }
    if (legacy.kind === 'absent') {
      if (receipt && receipt.successorDecisionDigest !== v2.digest) {
        throw new Error('Workroom Effect Sponsor legacy decision quarantine receipt is orphaned');
      }
      return v2;
    }
    if (legacy.kind === 'v2') {
      if (receipt || canonicalWorkroomJson(legacy.decision) !== canonicalWorkroomJson(v2)) {
        throw new Error('Workroom Effect Sponsor v2 decision slots conflict');
      }
      return v2;
    }
    if (legacy.kind === 'quarantined') {
      if (!receipt || canonicalWorkroomJson(legacy.receipt) !== canonicalWorkroomJson(receipt)
        || receipt.successorDecisionDigest !== v2.digest) {
        throw new Error('Workroom Effect Sponsor legacy decision supersession receipt is missing');
      }
      return v2;
    }
    if (!receipt) {
      throw new Error('Workroom Effect Sponsor legacy decision supersession receipt is missing');
    }
    await this.#assertLegacyDecisionSupersession(effectIntentId, v2, receipt);
    return v2;
  }

  async #readV2Decision(effectIntentId: string): Promise<WorkroomEffectSponsorDecisionRecord | undefined> {
    return await readOptional(this.#v2DecisionTarget(effectIntentId), parseDecision);
  }

  async #readLegacyDecisionSlot(effectIntentId: string): Promise<WorkroomEffectSponsorLegacyDecisionSlot> {
    const value = await readOptional(this.#legacyDecisionTarget(effectIntentId), candidate => candidate);
    if (value === undefined) return Object.freeze({ kind: 'absent' });
    if ((value as { kind?: unknown }).kind === 'workroom_effect_sponsor_legacy_decision_quarantine') {
      return Object.freeze({
        kind: 'quarantined',
        receipt: parseLegacyDecisionQuarantineReceipt(value, effectIntentId),
      });
    }
    if (isLegacyDecisionV1(value)) {
      return Object.freeze({ kind: 'v1', digest: digest(value) });
    }
    return Object.freeze({ kind: 'v2', decision: parseDecision(value) });
  }

  async #readLegacyQuarantineReceipt(
    effectIntentId: string,
  ): Promise<WorkroomEffectSponsorLegacyDecisionQuarantineReceipt | undefined> {
    return await readOptional(
      this.#legacyQuarantineReceiptTarget(effectIntentId),
      value => parseLegacyDecisionQuarantineReceipt(value, effectIntentId),
    );
  }

  async #publishLegacyQuarantineReceipt(
    effectIntentId: string,
    receipt: WorkroomEffectSponsorLegacyDecisionQuarantineReceipt,
  ): Promise<void> {
    await this.#store.publishCreateOnly({
      target: this.#legacyQuarantineReceiptTarget(effectIntentId),
      content: canonicalWorkroomJson(receipt),
      createdValue: receipt,
      onConflict: async () => {
        const existing = await this.#readLegacyQuarantineReceipt(effectIntentId);
        if (!existing || canonicalWorkroomJson(existing) !== canonicalWorkroomJson(receipt)) {
          throw new Error('Workroom Effect Sponsor legacy decision quarantine receipt CAS conflict');
        }
        return existing;
      },
    });
  }

  async #assertLegacyDecisionSupersession(
    effectIntentId: string,
    successor: WorkroomEffectSponsorDecisionRecord,
    receipt: WorkroomEffectSponsorLegacyDecisionQuarantineReceipt,
  ): Promise<void> {
    const legacy = await this.#readLegacyDecisionSlot(effectIntentId);
    if ((legacy.kind !== 'v1' && legacy.kind !== 'quarantined')
      || receipt.effectIntentRef !== legacyEffectIntentRef(effectIntentId)
      || (legacy.kind === 'v1' && receipt.legacyDecisionDigest !== legacy.digest)
      || (legacy.kind === 'quarantined'
        && canonicalWorkroomJson(legacy.receipt) !== canonicalWorkroomJson(receipt))
      || receipt.successorDecisionDigest !== successor.digest) {
      throw new Error('Workroom Effect Sponsor legacy decision supersession drift');
    }
  }

  async #readFact(effectIntentId: string): Promise<WorkroomPersistedEffectAuthorizationFacts | undefined> {
    return await readOptional(this.#factTarget(effectIntentId), value => {
      const fact = value as WorkroomPersistedEffectAuthorizationFacts;
      if (fact.version !== 1 || fact.intentId !== effectIntentId) {
        throw new Error('Workroom Effect Authorization fact is malformed');
      }
      return deepFreeze(fact);
    });
  }

  #legacyDecisionTarget(effectIntentId: string): string {
    return join(this.options.directory, `${key(effectIntentId)}.decision.json`);
  }

  #v2DecisionTarget(effectIntentId: string): string {
    return join(this.options.directory, `${key(effectIntentId)}.decision.v2.json`);
  }

  #legacyQuarantineReceiptTarget(effectIntentId: string): string {
    return join(this.options.directory, `${key(effectIntentId)}.decision-v1-quarantine.json`);
  }

  #factTarget(effectIntentId: string): string {
    return join(this.options.directory, `${key(effectIntentId)}.fact.json`);
  }
}

export interface InstallWorkroomAcceptanceResourcesOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: Pick<Scope, 'has' | 'provide'>;
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly projections?: WorkroomGovernedAcceptanceProjectionPort;
  readonly reports: WorkroomAcceptedReportReader;
  readonly riskHeaders?: WorkroomKernelRiskHeaderPort;
  readonly checks?: readonly WorkroomTypedAcceptanceCheck[];
  readonly contextConsumer?: WorkroomContextReleaseConsumerPort;
  readonly effectJournal: WorkroomEffectJournal;
  readonly runState: Readonly<{ read(projectId: string, runId: string): Promise<WorkroomRunState> }>;
  readonly effectAuthorizationPolicy?: WorkroomEffectAuthorizationPolicyPort;
  readonly effectSponsorDecisionScopes?: WorkroomEffectSponsorDecisionScopePort;
  /** Exact Project ids owned by this generation; enables restart-safe Effect fact projection. */
  readonly projects?: Readonly<{ listProjectIds(): Promise<readonly string[]> }>;
  readonly projectorIntervalMs?: number;
  readonly onProjectorError?: (error: unknown) => void;
}

export interface WorkroomAcceptanceProductionComposition {
  readonly policy: PinnedWorkroomAcceptancePolicy;
  readonly effectAuthorizations: SponsorDecisionWorkroomEffectAuthorizationProjector;
  readonly projectorRuntime: WorkroomEffectAuthorizationProjectionRuntime;
  /** Root-private authenticated Effect Sponsor control; never publish as a model Resource. */
  readonly effectSponsorControl: WorkroomEffectSponsorDecisionControlPort;
}

/** Generation lifecycle for the durable Sponsor decision -> P8 authorization fact projector. */
export class WorkroomEffectAuthorizationProjectionRuntime {
  readonly #intervalMs: number;
  #timer?: ReturnType<typeof setInterval>;
  #draining?: Promise<number>;

  constructor(readonly options: Readonly<{
    signal: AbortSignal;
    projects?: Readonly<{ listProjectIds(): Promise<readonly string[]> }>;
    projector: SponsorDecisionWorkroomEffectAuthorizationProjector;
    intervalMs?: number;
    onError?: (error: unknown) => void;
  }>) {
    this.#intervalMs = positive(options.intervalMs ?? 1_000, 'Effect Authorization projector interval');
  }

  start(): void {
    this.options.signal.throwIfAborted();
    if (this.#timer) return;
    void this.#scheduledDrain();
    this.#timer = setInterval(() => void this.#scheduledDrain(), this.#intervalMs);
  }

  async drain(): Promise<number> {
    this.options.signal.throwIfAborted();
    if (this.#draining) return await this.#draining;
    const operation = this.#drainProjects();
    this.#draining = operation;
    try {
      return await operation;
    } finally {
      if (this.#draining === operation) this.#draining = undefined;
    }
  }

  async dispose(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#draining;
  }

  async #drainProjects(): Promise<number> {
    if (!this.options.projects) return 0;
    const projectIds = [...new Set(await this.options.projects.listProjectIds())]
      .map(projectId => required(projectId, 'Effect Authorization projector Project id'))
      .sort();
    let projected = 0;
    for (const projectId of projectIds) {
      this.options.signal.throwIfAborted();
      projected += await this.options.projector.drainProject(projectId);
    }
    return projected;
  }

  async #scheduledDrain(): Promise<void> {
    try {
      await this.drain();
    } catch (error) {
      if (!this.options.signal.aborted) this.options.onError?.(error);
    }
  }
}

/** Standard resource graph. Every published port is generation-abort guarded. */
export function installWorkroomAcceptanceResources(
  options: InstallWorkroomAcceptanceResourcesOptions,
): WorkroomAcceptanceProductionComposition {
  if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
    throw new Error('Workroom Acceptance generation is invalid');
  }
  options.signal.throwIfAborted();
  const stateRoot = join(options.projectRoot, '.zhin');
  const blockers = new FileWorkroomAcceptanceProviderBlockerRepository(
    join(stateRoot, 'workroom-acceptance-provider-blockers'),
  );
  const projectionProvider = options.projections;
  const projections = Object.freeze({
    resolve: async (input: Parameters<WorkroomGovernedAcceptanceProjectionPort['resolve']>[0]) => {
      const projection = await projectionProvider?.resolve(input) ?? null;
      if (projection) return projection;
      await blockers.block('acceptance_projection',
        `${input.projectId}:${input.profileRevisionId}:${input.profileDigest}`,
        'Governed Acceptance projection provider is unavailable');
      return null;
    },
  });
  const riskHeaderProvider = options.riskHeaders;
  const riskHeaders = Object.freeze({
    resolve: async (input: Parameters<WorkroomKernelRiskHeaderPort['resolve']>[0]) => {
      const headers = await riskHeaderProvider?.resolve(input) ?? Object.freeze([]);
      if (headers.length > 0) return headers;
      await blockers.block('risk_headers',
        `${input.projectId}:${input.runId}:${input.taskKey}:${input.taskRevision}:${input.candidateHash}`,
        'Trusted Kernel Risk header provider is unavailable');
      return Object.freeze([]);
    },
  });
  const profile = new ProfileOwnedWorkroomAcceptanceProvider({
    profiles: options.profiles,
    catalog: options.catalog,
    projections,
  });
  const principals = new CatalogWorkroomAcceptancePrincipalRegistry({
    profiles: options.profiles,
    catalog: options.catalog,
  });
  const checks = options.checks && options.checks.length > 0
    ? new TypedWorkroomAcceptanceCheckRunner({ checks: options.checks })
    : undefined;
  const checkPort = Object.freeze({
    run: async (input: Parameters<TypedWorkroomAcceptanceCheckRunner['run']>[0]) => {
      options.signal.throwIfAborted();
      if (checks) return await checks.run(input);
      await blockers.block('acceptance_check', `${input.projectId}:${input.runId}:${input.taskKey}:${input.criterion.id}`,
        'Typed Acceptance Check provider is unavailable');
      return deepFreeze({
        id: `acceptance-check-blocker:${digest(input)}`,
        criterionId: input.criterion.id,
        status: 'error' as const,
        candidateHash: input.candidateHash,
        runner: 'provider-blocker',
        runnerVersion: '1',
        evidenceRefs: Object.freeze([]),
      });
    },
  });
  const contextRelease = options.contextConsumer
    ? new DurableWorkroomContextReleaseConsumer({
        directory: join(stateRoot, 'workroom-context-release-consumer'),
        consumer: options.contextConsumer,
      })
    : Object.freeze({
        release: async (input: WorkroomContextReleaseRequest) => {
          options.signal.throwIfAborted();
          await blockers.block('context_release', input.operationId, 'Execution Context disposer is unavailable');
          const body = deepFreeze({
            status: 'outcome_unknown' as const,
            operationId: input.operationId,
            receiptRef: `context-release-provider-blocker:${digest(input)}`,
          });
          return deepFreeze({ ...body, digest: digest(body) });
        },
      });
  const effects = new EffectLedgerWorkroomAcceptanceState({ journal: options.effectJournal });
  const risk = new KernelHeaderWorkroomRiskFacts({ headers: riskHeaders });
  const policy = new PinnedWorkroomAcceptancePolicy({
    policies: profile,
    reports: options.reports,
    risk,
    checks: checkPort,
    effects,
  });
  const authority = new ProfileWorkroomAcceptanceAuthority({ principals, runState: options.runState });
  const reviewer = new WorkroomReviewerViewReader({ runState: options.runState, reports: options.reports });
  const sponsorAuthority = new CatalogProfileWorkroomEffectSponsorAuthority({
    principals,
    effects: options.effectJournal,
    scopes: options.effectSponsorDecisionScopes,
  });
  const effectAuthorizations = new SponsorDecisionWorkroomEffectAuthorizationProjector({
    directory: join(stateRoot, 'workroom-effect-authorization-facts'),
    effectJournal: options.effectJournal,
    sponsorAuthority,
    policy: options.effectAuthorizationPolicy ?? Object.freeze({ authorize: async () => null }),
  });
  const projectorRuntime = new WorkroomEffectAuthorizationProjectionRuntime({
    signal: options.signal,
    projector: effectAuthorizations,
    ...(options.projects ? { projects: options.projects } : {}),
    ...(options.projectorIntervalMs === undefined ? {} : { intervalMs: options.projectorIntervalMs }),
    ...(options.onProjectorError ? { onError: options.onProjectorError } : {}),
  });
  provideIfAbsent(options.resources, workroomAcceptancePolicyFactsToken, profile);
  provideIfAbsent(options.resources, workroomTrustedRiskFactsToken, risk);
  provideIfAbsent(options.resources, workroomAcceptanceCheckRunnerToken, checkPort);
  provideIfAbsent(options.resources, workroomAcceptancePrincipalRegistryToken, principals);
  provideIfAbsent(options.resources, workroomProjectMemorySchemaAuthorityToken, profile.memorySchemas);
  provideIfAbsent(options.resources, workroomExecutionContextReleaseToken, contextRelease);
  provideIfAbsent(options.resources, workroomAcceptancePolicyDecisionToken, policy);
  provideIfAbsent(options.resources, workroomAcceptanceAuthorityToken, authority);
  provideIfAbsent(options.resources, workroomReviewerViewReaderToken, reviewer);
  provideIfAbsent(options.resources, workroomPersistedEffectAuthorizationFactsToken, effectAuthorizations);
  return Object.freeze({
    policy,
    effectAuthorizations,
    projectorRuntime,
    effectSponsorControl: effectAuthorizations.control,
  });
}

class CatalogProfileWorkroomEffectSponsorAuthority implements WorkroomEffectSponsorDecisionAuthorityPort {
  constructor(readonly options: {
    readonly principals: CatalogWorkroomAcceptancePrincipalRegistry;
    readonly effects: WorkroomEffectJournal;
    readonly scopes?: WorkroomEffectSponsorDecisionScopePort;
  }) {}

  async authorize(request: WorkroomEffectSponsorDecisionRequest): Promise<WorkroomEffectSponsorDecisionAuthorityResult> {
    const reject = (reason: string) => deepFreeze({ authorized: false as const, requestDigest: request.digest, reason });
    const principal = await this.options.principals.resolve({
      projectId: request.projectId,
      runId: request.runId,
      principalId: request.principalId,
    });
    if (!principal?.roles.includes('sponsor')) return reject('principal_is_not_exact_project_sponsor');
    const state = replayWorkroomEffectLedger(
      request.projectId,
      await this.options.effects.read(request.projectId),
    )[request.effectIntentId];
    if (!state || state.status !== 'pending_authorization'
      || state.intent.runId !== request.runId
      || state.intent.digest !== request.effectIntentDigest) {
      return reject('effect_intent_is_stale');
    }
    const binding = await this.options.scopes?.resolve({ request, intent: state.intent }) ?? null;
    if (!binding) return reject('trusted_effect_decision_scope_is_unavailable');
    return deepFreeze({
      authorized: true as const,
      authorizedBy: principal.issuer,
      catalogRevision: principal.catalogRevision,
      projectDigest: principal.projectDigest,
      profileRef: principal.profileRef,
      profileDigest: principal.profileDigest,
      profileRevision: principal.revision,
      binding,
      requestDigest: request.digest,
    });
  }
}

class FileWorkroomAcceptanceProviderBlockerRepository {
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async block(
    kind: 'acceptance_projection' | 'risk_headers' | 'acceptance_check' | 'context_release',
    blockerKey: string,
    reason: string,
  ): Promise<void> {
    const body = deepFreeze({
      version: 1 as const,
      kind,
      blockerKey: required(blockerKey, 'Provider blocker key'),
      reason: required(reason, 'Provider blocker reason'),
      allowedActions: ['provide_capability', 'replan', 'cancel'] as const,
    });
    const record = deepFreeze({ ...body, digest: digest(body) });
    await this.#store.ensureDurableLeaf('Workroom Acceptance provider blocker repository');
    const target = join(this.directory, `${key(`${kind}:${blockerKey}:${record.digest}`)}.json`);
    await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(record),
      createdValue: record,
      onConflict: async () => {
        const existing = JSON.parse(await readFile(target, 'utf8')) as unknown;
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(record)) {
          throw new Error('Workroom Acceptance provider blocker identity drift');
        }
        return record;
      },
    });
  }
}

function createDecisionRequest(command: WorkroomEffectSponsorDecisionCommand): WorkroomEffectSponsorDecisionRequest {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('Effect Sponsor decision shape is invalid');
  }
  if ((command as { version?: unknown }).version === 1) {
    throw new Error('Legacy Effect Sponsor decision v1 is quarantined; submit a v2 closed reason code');
  }
  assertExactKeys(command as unknown as Readonly<Record<string, unknown>>, [
    'version', 'operationId', 'projectId', 'runId', 'effectIntentId', 'effectIntentDigest',
    'principalId', 'decision', 'reasonCode', 'decidedAt',
  ], 'Effect Sponsor decision');
  if (command.version !== 2) throw new Error('Effect Sponsor decision version is invalid');
  const decision = enumValue(command.decision, ['approve', 'reject'], 'Effect Sponsor decision');
  const reasonCode = enumValue(command.reasonCode, [
    'approved_as_requested', 'rejected_policy', 'rejected_scope', 'rejected_risk',
    'rejected_by_sponsor',
  ], 'Effect Sponsor reason code');
  if ((decision === 'approve') !== (reasonCode === 'approved_as_requested')) {
    throw new Error('Effect Sponsor reason code does not match the decision');
  }
  const body = deepFreeze({
    version: 2 as const,
    operationId: required(command.operationId, 'Effect Sponsor operation id'),
    projectId: required(command.projectId, 'Effect Sponsor Project id'),
    runId: required(command.runId, 'Effect Sponsor Run id'),
    effectIntentId: required(command.effectIntentId, 'Effect Sponsor Intent id'),
    effectIntentDigest: requiredDigest(command.effectIntentDigest, 'Effect Sponsor Intent digest'),
    principalId: required(command.principalId, 'Effect Sponsor principal'),
    decision,
    reasonCode,
    decidedAt: positive(command.decidedAt, 'Effect Sponsor decidedAt'),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function assertSponsorAuthority(
  authority: Extract<WorkroomEffectSponsorDecisionAuthorityResult, { authorized: true }>,
  request: WorkroomEffectSponsorDecisionRequest,
  intent: WorkroomEffectIntent,
): void {
  if (authority.requestDigest !== request.digest) throw new Error('Effect Sponsor authority request echo drift');
  required(authority.authorizedBy, 'Effect Sponsor authorizedBy');
  required(authority.catalogRevision, 'Effect Sponsor Catalog revision');
  requiredDigest(authority.projectDigest, 'Effect Sponsor Project digest');
  required(authority.profileRef, 'Effect Sponsor Profile ref');
  requiredDigest(authority.profileDigest, 'Effect Sponsor Profile digest');
  positive(authority.profileRevision, 'Effect Sponsor Profile revision');
  assertDecisionBinding(authority.binding, intent, request.decidedAt);
}

function assertDecisionBinding(
  binding: WorkroomEffectSponsorDecisionBinding,
  intent: WorkroomEffectIntent,
  decidedAt: number,
): void {
  if (binding.effectIntentId !== intent.id
    || binding.effectIntentDigest !== intent.digest
    || binding.candidateHash !== intent.candidateHash
    || binding.workspaceRef !== intent.target.ref
    || binding.workspaceDigest !== intent.target.digest
    || binding.preconditionsDigest !== digest(intent.preconditions)
    || canonicalWorkroomJson(binding.risk) !== canonicalWorkroomJson(intent.risk)
    || binding.deadline <= decidedAt) {
    throw new Error('Effect Sponsor authority binding drift');
  }
  positive(binding.assignmentAttempt, 'Effect Sponsor Assignment attempt');
  positive(binding.workspaceFence, 'Effect Sponsor Workspace fence');
  required(binding.policy.id, 'Effect Sponsor policy id');
  positive(binding.policy.revision, 'Effect Sponsor policy revision');
  requiredDigest(binding.policy.digest, 'Effect Sponsor policy digest');
}

function assertDecisionIntentBinding(
  decision: WorkroomEffectSponsorDecisionRecord,
  intent: WorkroomEffectIntent,
): void {
  assertDecisionBinding(decision.binding, intent, decision.decidedAt);
  if (decision.effectIntentId !== intent.id || decision.effectIntentDigest !== intent.digest) {
    throw new Error('Persisted Effect Sponsor decision Intent drift');
  }
}

function createLegacyDecisionQuarantineReceipt(
  effectIntentId: string,
  legacyDecisionDigest: string,
  successorDecisionDigest: string,
): WorkroomEffectSponsorLegacyDecisionQuarantineReceipt {
  const body = deepFreeze({
    version: 1 as const,
    kind: 'workroom_effect_sponsor_legacy_decision_quarantine' as const,
    effectIntentRef: legacyEffectIntentRef(effectIntentId),
    status: 'quarantined' as const,
    disposition: 'superseded_by_v2' as const,
    legacyDecisionDigest: requiredDigest(legacyDecisionDigest, 'Legacy Effect Sponsor decision digest'),
    successorDecisionDigest: requiredDigest(successorDecisionDigest, 'Successor Effect Sponsor decision digest'),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function parseLegacyDecisionQuarantineReceipt(
  value: unknown,
  effectIntentId: string,
): WorkroomEffectSponsorLegacyDecisionQuarantineReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted Effect Sponsor legacy decision quarantine receipt is malformed');
  }
  const receipt = value as WorkroomEffectSponsorLegacyDecisionQuarantineReceipt;
  assertExactKeys(receipt as unknown as Readonly<Record<string, unknown>>, [
    'version', 'kind', 'effectIntentRef', 'status', 'disposition', 'legacyDecisionDigest',
    'successorDecisionDigest', 'digest',
  ], 'Persisted Effect Sponsor legacy decision quarantine receipt');
  if (receipt.version !== 1
    || receipt.kind !== 'workroom_effect_sponsor_legacy_decision_quarantine'
    || receipt.effectIntentRef !== legacyEffectIntentRef(effectIntentId)
    || receipt.status !== 'quarantined'
    || receipt.disposition !== 'superseded_by_v2') {
    throw new Error('Persisted Effect Sponsor legacy decision quarantine receipt is malformed');
  }
  requiredDigest(receipt.legacyDecisionDigest, 'Legacy Effect Sponsor decision digest');
  requiredDigest(receipt.successorDecisionDigest, 'Successor Effect Sponsor decision digest');
  const { digest: supplied, ...body } = receipt;
  if (supplied !== digest(body)) {
    throw new Error('Persisted Effect Sponsor legacy decision quarantine receipt digest drift');
  }
  return deepFreeze(receipt);
}

function legacyEffectIntentRef(effectIntentId: string): string {
  return `effect-intent:${key(effectIntentId)}`;
}

function isLegacyDecisionV1(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as { version?: unknown }).version === 1);
}

function legacyDecisionQuarantineError(): Error {
  return new Error('Legacy Effect Sponsor decision v1 is quarantined; submit a v2 closed reason code');
}

function parseDecision(value: unknown): WorkroomEffectSponsorDecisionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted Effect Sponsor decision is malformed');
  }
  if ((value as { version?: unknown }).version === 1) {
    throw legacyDecisionQuarantineError();
  }
  const record = value as WorkroomEffectSponsorDecisionRecord;
  assertExactKeys(record as unknown as Readonly<Record<string, unknown>>, [
    'version', 'operationId', 'projectId', 'runId', 'effectIntentId', 'effectIntentDigest',
    'principalId', 'decision', 'reasonCode', 'decidedAt', 'binding', 'authorizedBy',
    'catalogRevision', 'projectDigest', 'profileRef', 'profileDigest', 'profileRevision',
    'requestDigest', 'digest',
  ], 'Persisted Effect Sponsor decision');
  const request = createDecisionRequest({
    version: record.version,
    operationId: record.operationId,
    projectId: record.projectId,
    runId: record.runId,
    effectIntentId: record.effectIntentId,
    effectIntentDigest: record.effectIntentDigest,
    principalId: record.principalId,
    decision: record.decision,
    reasonCode: record.reasonCode,
    decidedAt: record.decidedAt,
  });
  const { digest: supplied, ...body } = record;
  if (record.requestDigest !== request.digest || supplied !== digest(body)) {
    throw new Error('Persisted Effect Sponsor decision digest drift');
  }
  return deepFreeze(record);
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${label} keys are invalid`);
  }
}

async function readOptional<T>(target: string, parse: (value: unknown) => T): Promise<T | undefined> {
  try {
    return parse(JSON.parse(await readFile(target, 'utf8')) as unknown);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function provideIfAbsent<T>(
  resources: Pick<Scope, 'has' | 'provide'>,
  token: import('@zhin.js/plugin-runtime').Token<T>,
  value: T,
): void {
  if (!resources.has(token)) resources.provide(token, value);
}

function key(value: string): string {
  return digest(value).slice('sha256:'.length);
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

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
