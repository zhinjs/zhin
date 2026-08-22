import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import type { WorkroomDefinition } from '../workroom/catalog-definition.js';
import type { ProjectProfileRegistry, ProjectProfileRegistrySnapshot } from '../workroom/profile-registry.js';
import {
  createWorkroomProjectMemorySchemaSnapshot,
  type WorkroomProjectMemoryClaimRule,
  type WorkroomProjectMemorySchemaSnapshot,
} from '../workroom/accepted-source-projector.js';
import type { WorkroomAcceptanceRecord } from '../workroom/acceptance-policy.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import {
  replayWorkroomEffectLedger,
  type WorkroomEffectJournal,
  type WorkroomEffectState,
} from '../workroom/effect-ledger.js';
import type {
  WorkroomContextReleaseReceipt,
  WorkroomContextReleaseRequest,
  WorkroomExecutionContextReleasePort,
  WorkroomProjectMemorySchemaAuthorityPort,
} from './workroom-accepted-source-runtime.js';
import type { WorkroomAcceptancePrincipalRegistryPort } from './workroom-reviewer-authority-runtime.js';
import type {
  WorkroomAcceptancePolicyFacts,
  WorkroomAcceptancePolicyFactsPort,
  WorkroomAcceptanceEffectStateFacts,
  WorkroomAcceptanceEffectStatePort,
  WorkroomConservativeRiskDimensions,
  WorkroomTrustedAcceptanceCheckRunnerPort,
  WorkroomTrustedFactSource,
  WorkroomTrustedRiskFacts,
  WorkroomTrustedRiskFactsPort,
} from './workroom-risk-acceptance-runtime.js';

type AcceptanceFloor = WorkroomAcceptancePolicyFacts['minimumRoute'];

export interface WorkroomGovernedAcceptanceTaskPolicy {
  readonly taskKey: string;
  readonly kind: WorkroomAcceptancePolicyFacts['kind'];
  readonly criteria: WorkroomAcceptancePolicyFacts['criteria'];
  readonly requiredEvidence: readonly string[];
  /** This is a floor, never an override of the Kernel risk lattice. */
  readonly minimumRoute: AcceptanceFloor;
  readonly reviewerPrincipalId: string;
  readonly sponsorPrincipalId: string;
  readonly reviewerTimeoutMs: number;
  readonly sponsorTimeoutMs: number;
}

export interface WorkroomGovernedAcceptanceProjectionInput {
  readonly version: 1;
  readonly projectId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly revision: number;
  readonly issuer: string;
  readonly tasks: readonly WorkroomGovernedAcceptanceTaskPolicy[];
  readonly memorySchema: Readonly<{
    revision: number;
    claimRules: readonly WorkroomProjectMemoryClaimRule[];
  }>;
}

export interface WorkroomGovernedAcceptanceProjection
extends WorkroomGovernedAcceptanceProjectionInput {
  readonly digest: string;
}

export interface WorkroomGovernedAcceptanceProjectionPort {
  resolve(input: Readonly<{
    projectId: string;
    profileRevisionId: string;
    profileDigest: string;
  }>): Promise<WorkroomGovernedAcceptanceProjection | null>;
}

/** Canonical Profile-owned projection. The caller cannot supply its content hash. */
export function createWorkroomGovernedAcceptanceProjection(
  input: WorkroomGovernedAcceptanceProjectionInput,
): WorkroomGovernedAcceptanceProjection {
  if (input.version !== 1) throw new Error('Governed Acceptance projection version is invalid');
  const tasks = [...input.tasks].map(task => {
    const criteria = [...task.criteria].map(criterion => deepFreeze({
      id: required(criterion.id, 'Acceptance criterion id'),
      kind: enumValue(criterion.kind, ['deterministic', 'judgment'], 'Acceptance criterion kind'),
      description: required(criterion.description, 'Acceptance criterion description'),
    })).sort(byId);
    unique(criteria.map(criterion => criterion.id), 'Acceptance criteria');
    if (criteria.length === 0) throw new Error('Governed Acceptance Task policy requires criteria');
    return deepFreeze({
      taskKey: required(task.taskKey, 'Acceptance Task key'),
      kind: enumValue(task.kind, ['task_result', 'integration_candidate', 'effect_intent'], 'Acceptance kind'),
      criteria,
      requiredEvidence: unique(task.requiredEvidence, 'Acceptance required evidence'),
      minimumRoute: enumValue(task.minimumRoute, [
        'baseline', 'reviewer_required', 'sponsor_required', 'reviewer_then_sponsor',
      ], 'Acceptance minimum route'),
      reviewerPrincipalId: required(task.reviewerPrincipalId, 'Reviewer principal'),
      sponsorPrincipalId: required(task.sponsorPrincipalId, 'Sponsor principal'),
      reviewerTimeoutMs: positive(task.reviewerTimeoutMs, 'Reviewer timeout'),
      sponsorTimeoutMs: positive(task.sponsorTimeoutMs, 'Sponsor timeout'),
    });
  }).sort((left, right) => compareCanonicalWorkroomText(left.taskKey, right.taskKey));
  unique(tasks.map(task => task.taskKey), 'Acceptance Task policies');
  const schema = createWorkroomProjectMemorySchemaSnapshot(input.memorySchema);
  const body = deepFreeze({
    version: 1 as const,
    projectId: required(input.projectId, 'Acceptance projection Project id'),
    profileRevisionId: required(input.profileRevisionId, 'Acceptance projection Profile revision'),
    profileDigest: requiredDigest(input.profileDigest, 'Acceptance projection Profile digest'),
    revision: positive(input.revision, 'Acceptance projection revision'),
    issuer: required(input.issuer, 'Acceptance projection issuer'),
    tasks,
    memorySchema: {
      revision: schema.revision,
      claimRules: schema.claimRules,
    },
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface ProfileOwnedWorkroomAcceptanceProviderOptions {
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly projections: WorkroomGovernedAcceptanceProjectionPort;
}

/** Exact Run Profile projection shared by Acceptance contracts and Memory Schema authority. */
export class ProfileOwnedWorkroomAcceptanceProvider
implements WorkroomAcceptancePolicyFactsPort {
  readonly memorySchemas: WorkroomProjectMemorySchemaAuthorityPort;

  constructor(readonly options: ProfileOwnedWorkroomAcceptanceProviderOptions) {
    this.memorySchemas = Object.freeze({
      resolve: async (
        input: Parameters<WorkroomProjectMemorySchemaAuthorityPort['resolve']>[0],
      ) => await this.resolveMemorySchema(input),
    });
  }

  async resolve(input: Parameters<WorkroomAcceptancePolicyFactsPort['resolve']>[0]): Promise<WorkroomAcceptancePolicyFacts> {
    positive(input.taskRevision, 'Acceptance Task revision');
    const context = await this.#context(input.projectId, input.runId);
    const projection = context.projection;
    const task = projection.tasks.find(candidate => candidate.taskKey === input.taskKey);
    if (!task) throw new Error(`Pinned Profile has no Acceptance policy for Task ${input.taskKey}`);
    assertPrincipals(
      task,
      context.definition,
      context.profile.revisions[context.pin.profileRevisionId]!.compiledProfile.agents,
    );
    const policyBody = deepFreeze({
      version: 1 as const,
      projectId: input.projectId,
      profileRevisionId: context.pin.profileRevisionId,
      profileDigest: context.pin.profileDigest,
      projectionDigest: projection.digest,
      projectionRevision: projection.revision,
      catalogRevision: context.catalog.revision,
      projectDigest: digest(context.definition),
      taskKey: input.taskKey,
      taskRevision: input.taskRevision,
      task,
    });
    const policyDigest = digest(policyBody);
    const profileRef = `profile:${input.projectId}:${context.pin.profileRevisionId}`;
    return deepFreeze({
      profileRef,
      profileDigest: context.pin.profileDigest,
      policy: {
        id: `acceptance-policy:${input.projectId}:${context.pin.profileRevisionId}:${input.taskKey}`,
        revision: projection.revision,
        digest: policyDigest,
      },
      kind: task.kind,
      criteria: task.criteria,
      requiredEvidence: task.requiredEvidence,
      minimumRoute: task.minimumRoute,
      reviewerOwner: task.reviewerPrincipalId,
      sponsorOwner: task.sponsorPrincipalId,
      reviewerTimeoutMs: task.reviewerTimeoutMs,
      sponsorTimeoutMs: task.sponsorTimeoutMs,
      binding: {
        sourceType: 'project-profile',
        sourceRef: profileRef,
        sourceDigest: context.pin.profileDigest,
        issuer: projection.issuer,
        policyRevision: projection.revision,
      },
    });
  }

  async resolveMemorySchema(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    acceptance: WorkroomAcceptanceRecord;
  }>): Promise<WorkroomProjectMemorySchemaSnapshot> {
    const context = await this.#context(input.projectId, input.runId);
    const task = context.projection.tasks.find(candidate => candidate.taskKey === input.taskKey);
    if (!task) throw new Error(`Pinned Profile has no Memory policy for Task ${input.taskKey}`);
    const expected = await this.resolve({
      projectId: input.projectId,
      runId: input.runId,
      taskKey: input.taskKey,
      taskRevision: input.acceptance.contract.taskRevision,
    });
    if (input.acceptance.disposition !== 'accepted'
      || input.acceptance.policy.id !== expected.policy.id
      || input.acceptance.policy.revision !== expected.policy.revision
      || input.acceptance.policy.digest !== expected.policy.digest
      || input.acceptance.contract.policy.digest !== expected.policy.digest) {
      throw new Error('Project Memory Schema authority targets a stale Acceptance/Profile binding');
    }
    return createWorkroomProjectMemorySchemaSnapshot(context.projection.memorySchema);
  }

  async #context(projectId: string, runId: string) {
    required(projectId, 'Acceptance Project id');
    required(runId, 'Acceptance Run id');
    const [profile, catalog] = await Promise.all([
      this.options.profiles.read(projectId),
      this.options.catalog.read(),
    ]);
    const pin = exactRunProfile(profile, runId);
    const definition = exactCatalogProject(catalog.definitions[projectId], projectId);
    const supplied = await this.options.projections.resolve({
      projectId,
      profileRevisionId: pin.profileRevisionId,
      profileDigest: pin.profileDigest,
    });
    if (!supplied) throw new Error('Governed Acceptance projection is unavailable');
    const projection = createWorkroomGovernedAcceptanceProjection(supplied);
    if (projection.digest !== supplied.digest) throw new Error('Governed Acceptance projection digest mismatch');
    if (projection.projectId !== projectId
      || projection.profileRevisionId !== pin.profileRevisionId
      || projection.profileDigest !== pin.profileDigest) {
      throw new Error('Governed Acceptance projection Profile binding drift');
    }
    return { profile, catalog, pin, definition, projection };
  }
}

export interface WorkroomKernelRiskHeaderInput {
  readonly version: 1;
  readonly sourceType: Extract<WorkroomTrustedFactSource['sourceType'],
  'workflow-plan' | 'capability-snapshot' | 'artifact-header' | 'effect-intent'>;
  readonly sourceRef: string;
  readonly sourceContentDigest: string;
  readonly sourceRevision?: number;
  readonly issuer: string;
  readonly policyRevision: number;
  readonly scope: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
    candidateHash: string;
  }>;
  readonly dimensions: WorkroomConservativeRiskDimensions;
}

export interface WorkroomKernelRiskHeader extends WorkroomKernelRiskHeaderInput {
  readonly digest: string;
}

export function createWorkroomKernelRiskHeader(input: WorkroomKernelRiskHeaderInput): WorkroomKernelRiskHeader {
  if (input.version !== 1) throw new Error('Kernel Risk header version is invalid');
  const body = deepFreeze({
    version: 1 as const,
    sourceType: enumValue(input.sourceType, [
      'workflow-plan', 'capability-snapshot', 'artifact-header', 'effect-intent',
    ], 'Kernel Risk source type'),
    sourceRef: required(input.sourceRef, 'Kernel Risk source ref'),
    sourceContentDigest: requiredDigest(input.sourceContentDigest, 'Kernel Risk source content digest'),
    ...(input.sourceRevision === undefined
      ? {}
      : { sourceRevision: positive(input.sourceRevision, 'Kernel Risk source revision') }),
    issuer: required(input.issuer, 'Kernel Risk issuer'),
    policyRevision: positive(input.policyRevision, 'Kernel Risk policy revision'),
    scope: {
      projectId: required(input.scope.projectId, 'Kernel Risk Project id'),
      runId: required(input.scope.runId, 'Kernel Risk Run id'),
      taskKey: required(input.scope.taskKey, 'Kernel Risk Task key'),
      taskRevision: positive(input.scope.taskRevision, 'Kernel Risk Task revision'),
      candidateHash: requiredDigest(input.scope.candidateHash, 'Kernel Risk candidate hash'),
    },
    dimensions: normalizeDimensions(input.dimensions),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface WorkroomKernelRiskHeaderPort {
  resolve(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
    candidateHash: string;
    reportRef: string;
    reportDigest: string;
    planRef: string;
    planRevision: number;
    artifactRefs: readonly string[];
    policyRevision: number;
  }>): Promise<readonly WorkroomKernelRiskHeader[]>;
}

export class KernelHeaderWorkroomRiskFacts implements WorkroomTrustedRiskFactsPort {
  constructor(readonly options: { readonly headers: WorkroomKernelRiskHeaderPort }) {}

  async assess(input: Parameters<WorkroomTrustedRiskFactsPort['assess']>[0]): Promise<WorkroomTrustedRiskFacts> {
    const request = deepFreeze({
      projectId: input.projectId,
      runId: input.runId,
      taskKey: input.taskKey,
      taskRevision: input.taskRevision,
      candidateHash: input.candidateHash,
      reportRef: input.reportRef,
      reportDigest: input.reportDigest,
      planRef: input.planRef,
      planRevision: input.planRevision,
      artifactRefs: unique(input.artifactRefs, 'Risk artifact refs'),
      policyRevision: input.policy.revision,
    });
    const headers = await this.options.headers.resolve(request);
    if (!Array.isArray(headers) || headers.length === 0) throw new Error('Kernel Risk headers are unavailable');
    const canonical = headers.map(header => validateRiskHeader(header, request));
    unique(canonical.map(header => header.sourceRef), 'Kernel Risk source refs');
    const plan = canonical.filter(header => header.sourceType === 'workflow-plan');
    if (plan.length !== 1 || plan[0]?.sourceRef !== input.planRef
      || plan[0].sourceRevision !== input.planRevision) {
      throw new Error('Kernel Risk requires the exact Workflow Plan header');
    }
    if (canonical.filter(header => header.sourceType === 'capability-snapshot').length !== 1) {
      throw new Error('Kernel Risk requires one exact Capability Snapshot header');
    }
    const artifactHeaderRefs = canonical
      .filter(header => header.sourceType === 'artifact-header')
      .map(header => header.sourceRef).sort();
    if (canonicalWorkroomJson(artifactHeaderRefs) !== canonicalWorkroomJson([...request.artifactRefs].sort())) {
      throw new Error('Kernel Risk Artifact headers do not cover the exact governed artifacts');
    }
    return deepFreeze({
      candidateHash: input.candidateHash,
      facts: joinRisk(canonical.map(header => header.dimensions)),
      sources: canonical.map(header => deepFreeze({
        sourceType: header.sourceType,
        sourceRef: header.sourceRef,
        sourceDigest: header.digest,
        issuer: header.issuer,
        policyRevision: header.policyRevision,
      })),
    });
  }
}

export interface WorkroomTypedAcceptanceCheck {
  readonly id: string;
  readonly runner: string;
  readonly version: string;
  run(input: Parameters<WorkroomTrustedAcceptanceCheckRunnerPort['run']>[0]): Promise<Readonly<{
    status: 'passed' | 'failed' | 'error' | 'expired';
    evidenceRefs: readonly string[];
  }>>;
}

/** Registry invokes one known typed check; no command string or model-selected runner exists. */
export class TypedWorkroomAcceptanceCheckRunner implements WorkroomTrustedAcceptanceCheckRunnerPort {
  readonly #checks: ReadonlyMap<string, WorkroomTypedAcceptanceCheck>;

  constructor(options: { readonly checks: readonly WorkroomTypedAcceptanceCheck[] }) {
    const entries = options.checks.map(check => [required(check.id, 'Typed check id'), check] as const);
    unique(entries.map(([id]) => id), 'Typed checks');
    this.#checks = new Map(entries);
  }

  async run(input: Parameters<WorkroomTrustedAcceptanceCheckRunnerPort['run']>[0]) {
    if (input.criterion.kind !== 'deterministic') throw new Error('Judgment criterion cannot use a typed Check Runner');
    const check = this.#checks.get(input.criterion.id);
    if (!check) throw new Error(`Typed check ${input.criterion.id} is unavailable`);
    const result = await check.run(deepFreeze(structuredClone(input)));
    return deepFreeze({
      id: `acceptance-check:${input.candidateHash}:${encodeURIComponent(check.id)}:${digest(result)}`,
      criterionId: input.criterion.id,
      status: enumValue(result.status, ['passed', 'failed', 'error', 'expired'], 'Typed check status'),
      candidateHash: input.candidateHash,
      runner: required(check.runner, 'Typed check runner'),
      runnerVersion: required(check.version, 'Typed check runner version'),
      evidenceRefs: unique(result.evidenceRefs, 'Typed check evidence refs'),
    });
  }
}

export class CatalogWorkroomAcceptancePrincipalRegistry
implements WorkroomAcceptancePrincipalRegistryPort {
  constructor(readonly options: {
    readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
    readonly catalog: Pick<WorkroomCatalog, 'read'>;
  }) {}

  async resolve(input: Parameters<WorkroomAcceptancePrincipalRegistryPort['resolve']>[0]) {
    const [profile, catalog] = await Promise.all([
      this.options.profiles.read(input.projectId),
      this.options.catalog.read(),
    ]);
    const pin = exactRunProfile(profile, input.runId);
    const definition = exactCatalogProject(catalog.definitions[input.projectId], input.projectId);
    const roles: Array<'reviewer' | 'sponsor' | 'executor' | 'orchestrator' | 'integration'> = [];
    if (definition.sponsors?.includes(input.principalId)) roles.push('sponsor');
    const member = definition.members.find(candidate => candidate.agent === input.principalId);
    const profileAgent = profile.revisions[pin.profileRevisionId]?.compiledProfile.agents
      .find(candidate => candidate.id === input.principalId);
    if (member && profileAgent && member.role === profileAgent.role) {
      roles.push(member.role);
    }
    if (roles.length === 0) return null;
    const projectDigest = digest(definition);
    return deepFreeze({
      principalId: input.principalId,
      roles: [...roles].sort(),
      profileRef: `profile:${input.projectId}:${pin.profileRevisionId}`,
      profileDigest: pin.profileDigest,
      revision: pin.activationRegistryRevision + 1,
      issuer: `catalog:${catalog.revision}:${projectDigest}`,
      catalogRevision: catalog.revision,
      projectDigest,
    });
  }
}

export class EffectLedgerWorkroomAcceptanceState implements WorkroomAcceptanceEffectStatePort {
  constructor(readonly options: { readonly journal: WorkroomEffectJournal }) {}

  async resolve(input: Parameters<WorkroomAcceptanceEffectStatePort['resolve']>[0]): Promise<WorkroomAcceptanceEffectStateFacts | null> {
    const states = Object.values(replayWorkroomEffectLedger(
      input.projectId,
      await this.options.journal.read(input.projectId),
    )).filter(state => state.intent.runId === input.runId
      && state.intent.taskKey === input.taskKey
      && state.intent.taskRevision === input.taskRevision
      && state.intent.candidateHash === input.candidateHash);
    if (states.length > 1) throw new Error('Multiple Effect Intents target one Acceptance candidate');
    const state = states[0];
    if (!state) return null;
    return effectAcceptanceState(state);
  }
}

export interface WorkroomContextReleaseConsumerPort {
  /** Must reconcile/replay the same operationId; plain model or message callbacks are invalid. */
  release(request: WorkroomContextReleaseRequest): Promise<Readonly<{
    status: 'released' | 'outcome_unknown';
    receiptRef: string;
  }>>;
}

/** Durable idempotency boundary around the concrete execution-context disposer. */
export class DurableWorkroomContextReleaseConsumer implements WorkroomExecutionContextReleasePort {
  readonly #store: DurableFileStore;

  constructor(readonly options: {
    readonly directory: string;
    readonly consumer: WorkroomContextReleaseConsumerPort;
  }) {
    this.#store = new DurableFileStore(options.directory);
  }

  async release(request: WorkroomContextReleaseRequest): Promise<WorkroomContextReleaseReceipt> {
    const canonical = normalizeReleaseRequest(request);
    await this.#store.ensureDurableLeaf('Workroom Context Release consumer');
    const key = digest(canonical.operationId).slice('sha256:'.length);
    const intentTarget = join(this.options.directory, `${key}.intent.json`);
    await this.#store.publishCreateOnly({
      target: intentTarget,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const existing = JSON.parse(await readFile(intentTarget, 'utf8')) as unknown;
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(canonical)) {
          throw new Error('Workroom Context Release operation identity drift');
        }
        return canonical;
      },
    });
    const receiptTarget = join(this.options.directory, `${key}.released.json`);
    const replay = await readOptionalReleaseReceipt(receiptTarget, canonical.operationId);
    if (replay) return replay;
    const outcome = await this.options.consumer.release(canonical);
    const receiptBody = deepFreeze({
      status: enumValue(outcome.status, ['released', 'outcome_unknown'], 'Context Release status'),
      operationId: canonical.operationId,
      receiptRef: required(outcome.receiptRef, 'Context Release receipt ref'),
    });
    const receipt = deepFreeze({ ...receiptBody, digest: digest(receiptBody) });
    if (receipt.status === 'outcome_unknown') return receipt;
    const publication = await this.#store.publishCreateOnly({
      target: receiptTarget,
      content: canonicalWorkroomJson(receipt),
      createdValue: receipt,
      onConflict: async () => {
        const existing = await readOptionalReleaseReceipt(receiptTarget, canonical.operationId);
        if (!existing) throw new Error('Workroom Context Release durable receipt disappeared');
        return existing;
      },
    });
    await this.#store.syncLeafAndParent();
    return publication.value;
  }
}

function exactRunProfile(profile: ProjectProfileRegistrySnapshot, runId: string) {
  const pin = profile.runPins[runId];
  if (!pin) throw new Error('Acceptance requires an exact Run Profile pin');
  const revision = profile.revisions[pin.profileRevisionId];
  if (!revision
    || revision.projectId !== profile.projectId
    || revision.compiledDigest !== pin.profileDigest
    || revision.compiledProfile.digest !== pin.profileDigest
    || revision.compiledProfile.revisionId !== pin.profileRevisionId) {
    throw new Error('Acceptance Run Profile pin does not resolve an exact governed revision');
  }
  return pin;
}

function exactCatalogProject(definition: WorkroomDefinition | undefined, projectId: string): WorkroomDefinition {
  if (!definition || definition.enabled === false) {
    throw new Error(`Persistent Catalog Project ${projectId} is unavailable`);
  }
  return definition;
}

function assertPrincipals(
  task: WorkroomGovernedAcceptanceTaskPolicy,
  definition: WorkroomDefinition,
  profileAgents: ProjectProfileRegistrySnapshot['revisions'][string]['compiledProfile']['agents'],
): void {
  const reviewer = definition.members.find(member =>
    member.agent === task.reviewerPrincipalId && member.role === 'reviewer');
  const profileReviewer = profileAgents.find(agent =>
    agent.id === task.reviewerPrincipalId && agent.role === 'reviewer');
  if (!reviewer || !profileReviewer) {
    throw new Error('Acceptance Reviewer is outside the persistent Catalog/pinned Profile intersection');
  }
  if (!definition.sponsors?.includes(task.sponsorPrincipalId)) {
    throw new Error('Acceptance Sponsor is outside the persistent Catalog');
  }
}

function validateRiskHeader(
  value: WorkroomKernelRiskHeader,
  request: Parameters<WorkroomKernelRiskHeaderPort['resolve']>[0],
): WorkroomKernelRiskHeader {
  const canonical = createWorkroomKernelRiskHeader(value);
  if (canonical.digest !== value.digest) throw new Error('Kernel Risk header digest mismatch');
  if (canonical.scope.projectId !== request.projectId
    || canonical.scope.runId !== request.runId
    || canonical.scope.taskKey !== request.taskKey
    || canonical.scope.taskRevision !== request.taskRevision
    || canonical.scope.candidateHash !== request.candidateHash
    || canonical.policyRevision !== request.policyRevision) {
    throw new Error('Kernel Risk header scope/hash binding is stale');
  }
  return canonical;
}

function joinRisk(values: readonly WorkroomConservativeRiskDimensions[]): WorkroomConservativeRiskDimensions {
  if (values.length === 0) throw new Error('Kernel Risk dimensions are unavailable');
  return deepFreeze({
    sideEffect: maximum(values.map(value => value.sideEffect), ['none', 'local', 'external', 'unknown']),
    reversibility: maximum(values.map(value => value.reversibility), [
      'discard_only', 'compensatable', 'irreversible', 'unknown',
    ]),
    dataClass: maximum(values.map(value => value.dataClass), [
      'public', 'internal', 'confidential', 'restricted', 'unknown',
    ]),
    blastRadius: maximum(values.map(value => value.blastRadius), [
      'single_artifact', 'project', 'organization', 'external', 'unknown',
    ]),
    capabilityTags: unique(values.flatMap(value => value.capabilityTags), 'Kernel Risk capability tags'),
    uncertainty: values.some(value => value.uncertainty === 'unknown') ? 'unknown' : 'known',
  });
}

function normalizeDimensions(value: WorkroomConservativeRiskDimensions): WorkroomConservativeRiskDimensions {
  return deepFreeze({
    sideEffect: enumValue(value.sideEffect, ['none', 'local', 'external', 'unknown'], 'Risk side effect'),
    reversibility: enumValue(value.reversibility, [
      'discard_only', 'compensatable', 'irreversible', 'unknown',
    ], 'Risk reversibility'),
    dataClass: enumValue(value.dataClass, [
      'public', 'internal', 'confidential', 'restricted', 'unknown',
    ], 'Risk data class'),
    blastRadius: enumValue(value.blastRadius, [
      'single_artifact', 'project', 'organization', 'external', 'unknown',
    ], 'Risk blast radius'),
    capabilityTags: unique(value.capabilityTags, 'Risk capability tags'),
    uncertainty: enumValue(value.uncertainty, ['known', 'unknown'], 'Risk uncertainty'),
  });
}

function effectAcceptanceState(state: WorkroomEffectState): WorkroomAcceptanceEffectStateFacts {
  const mapped = state.status === 'executing' ? 'authorized' : state.status;
  return deepFreeze({
    projectId: state.projectId,
    runId: state.intent.runId,
    taskKey: state.intent.taskKey,
    taskRevision: state.intent.taskRevision,
    candidateHash: state.intent.candidateHash,
    intentRef: state.intent.id,
    intentDigest: state.intent.digest,
    state: mapped,
    ...(state.authorization ? { authorizationDigest: state.authorization.authorizationDigest } : {}),
    ...(state.receipt ? { receiptDigest: state.receipt.remoteDigest } : {}),
  });
}

function normalizeReleaseRequest(request: WorkroomContextReleaseRequest): WorkroomContextReleaseRequest {
  const eligibility = request.eligibility;
  if (eligibility.eligible !== true) throw new Error('Context Release eligibility is invalid');
  const canonical = deepFreeze({
    operationId: required(request.operationId, 'Context Release operation id'),
    eligibility: {
      eligible: true as const,
      ref: required(eligibility.ref, 'Context Release eligibility ref'),
      projectId: required(eligibility.projectId, 'Context Release Project id'),
      runId: required(eligibility.runId, 'Context Release Run id'),
      taskKey: required(eligibility.taskKey, 'Context Release Task key'),
      sourceAcceptanceId: required(eligibility.sourceAcceptanceId, 'Context Release Acceptance id'),
      sourceHash: requiredDigest(eligibility.sourceHash, 'Context Release source hash'),
      taskMemoryId: required(eligibility.taskMemoryId, 'Context Release Task Memory id'),
      statePatchId: required(eligibility.statePatchId, 'Context Release State Patch id'),
      stateRevision: positive(eligibility.stateRevision, 'Context Release state revision'),
    },
  });
  const expected = `context-release-operation:${digest(canonical.eligibility)}`;
  if (canonical.operationId !== expected) throw new Error('Context Release operation id is not content-addressed');
  return canonical;
}

async function readOptionalReleaseReceipt(
  target: string,
  operationId: string,
): Promise<WorkroomContextReleaseReceipt | undefined> {
  let value: WorkroomContextReleaseReceipt;
  try {
    value = JSON.parse(await readFile(target, 'utf8')) as WorkroomContextReleaseReceipt;
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined;
    throw error;
  }
  const body = {
    status: value.status,
    operationId: value.operationId,
    receiptRef: value.receiptRef,
  };
  if (value.status !== 'released' || value.operationId !== operationId
    || value.digest !== digest(body)) {
    throw new Error('Workroom Context Release durable receipt is malformed');
  }
  return deepFreeze(value);
}

function maximum<T extends string>(values: readonly T[], order: readonly T[]): T {
  let selected = order[0];
  if (!selected) throw new Error('Risk dimension order is empty');
  for (const value of values) {
    const index = order.indexOf(value);
    if (index < 0) throw new Error('Risk dimension is invalid');
    if (index > order.indexOf(selected)) selected = value;
  }
  return selected;
}

function byId(left: Readonly<{ id: string }>, right: Readonly<{ id: string }>): number {
  return compareCanonicalWorkroomText(left.id, right.id);
}

function unique(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  const normalized = values.map(value => required(value, label));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze([...normalized].sort());
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
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
