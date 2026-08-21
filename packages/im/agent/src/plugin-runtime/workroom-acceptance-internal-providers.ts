import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomCatalog, WorkroomCatalogSnapshot } from '../workroom/catalog.js';
import type { WorkroomAcceptedReportReader } from '../workroom/accepted-source-memory-application.js';
import {
  replayWorkroomEffectLedger,
  type WorkroomEffectJournal,
  type WorkroomEffectState,
} from '../workroom/effect-ledger.js';
import type {
  ProjectProfileRegistry,
  ProjectProfileRegistrySnapshot,
  WorkroomRunProfilePin,
} from '../workroom/profile-registry.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import {
  createWorkroomKernelRiskHeader,
  createWorkroomGovernedAcceptanceProjection,
  type WorkroomKernelRiskHeaderPort,
} from './workroom-acceptance-provider-composition.js';
import {
  workroomAcceptanceProjectionSourceBindingDigest,
  type FileWorkroomAcceptanceProjectionRepository,
  type FileWorkroomKernelRiskHeaderRepository,
  type ImmutableWorkroomTypedCheckRegistry,
  type WorkroomAcceptanceProjectionAuthorityPort,
  type WorkroomAcceptanceProjectionCandidate,
  type WorkroomAcceptanceProjectionSourcePort,
  type WorkroomRiskHeaderProducerAuthorityPort,
  type WorkroomRiskHeaderPublication,
  type WorkroomEphemeralContextReleaseCapabilityPort,
  type WorkroomEphemeralContextRouteFact,
} from './workroom-acceptance-fact-providers.js';
import type { WorkroomAcceptanceProjectionSourceAuthorityPort } from './workroom-data-governance-runtime.js';

/**
 * P10 compiled Profile -> P7 governed Acceptance projection.
 * New publication follows only the active Profile; authorization follows every
 * immutable exact Run pin, so HMR cannot revoke a still-running old revision.
 */
export class PinnedProfileWorkroomAcceptanceProjectionSource
implements WorkroomAcceptanceProjectionSourcePort,
WorkroomAcceptanceProjectionAuthorityPort,
WorkroomAcceptanceProjectionSourceAuthorityPort {
  constructor(readonly options: Readonly<{
    profiles: Pick<ProjectProfileRegistry, 'read'>;
    catalog: Pick<WorkroomCatalog, 'read'>;
  }>) {}

  async list(projectId: string): Promise<readonly WorkroomAcceptanceProjectionCandidate[]> {
    const [profile, catalog] = await Promise.all([
      this.options.profiles.read(required(projectId, 'Acceptance source Project id')),
      this.options.catalog.read(),
    ]);
    const active = profile.active;
    if (!active) return Object.freeze([]);
    const pin = Object.values(profile.runPins).find(candidate =>
      candidate.profileRevisionId === active.revisionId
      && candidate.profileDigest === active.compiledDigest
      && candidate.activationRegistryRevision === active.activatedAtRegistryRevision);
    if (!pin) return Object.freeze([]);
    return Object.freeze([candidateForPin(profile, catalog, pin)]);
  }

  async authorize(candidate: WorkroomAcceptanceProjectionCandidate): Promise<boolean> {
    const candidates = await this.#pinnedCandidates(candidate.projection.projectId);
    return candidates.some(current => canonicalWorkroomJson(current) === canonicalWorkroomJson(candidate));
  }

  async resolve(
    input: Parameters<WorkroomAcceptanceProjectionSourceAuthorityPort['resolve']>[0],
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<WorkroomAcceptanceProjectionSourceAuthorityPort['resolve']>>> {
    signal.throwIfAborted();
    const candidates = await this.#pinnedCandidates(input.projectId);
    signal.throwIfAborted();
    const match = candidates.find(candidate => {
      const bindingDigest = workroomAcceptanceProjectionSourceBindingDigest(candidate);
      return candidate.projection.digest === input.projectionDigest
        && bindingDigest === input.source.bindingDigest
        && canonicalWorkroomJson(candidate.source)
          === canonicalWorkroomJson((({ bindingDigest: _binding, ...source }) => source)(input.source));
    });
    if (!match) return undefined;
    return deepFreeze({
      ...match.source,
      bindingDigest: input.source.bindingDigest,
      verification: 'verified' as const,
    });
  }

  async #pinnedCandidates(projectId: string): Promise<readonly WorkroomAcceptanceProjectionCandidate[]> {
    const [profile, catalog] = await Promise.all([
      this.options.profiles.read(required(projectId, 'Acceptance source Project id')),
      this.options.catalog.read(),
    ]);
    const pins = Object.values(profile.runPins)
      .filter(pin => pin.projectId === projectId)
      .sort((left, right) => left.runId.localeCompare(right.runId));
    const byRevision = new Map<string, WorkroomAcceptanceProjectionCandidate>();
    for (const pin of pins) {
      const candidate = candidateForPin(profile, catalog, pin);
      const key = `${pin.profileRevisionId}:${pin.profileDigest}`;
      const current = byRevision.get(key);
      if (current && canonicalWorkroomJson(current) !== canonicalWorkroomJson(candidate)) {
        throw new Error('Pinned Acceptance Profile source identity drift');
      }
      byRevision.set(key, candidate);
    }
    return Object.freeze([...byRevision.values()].sort((left, right) =>
      left.projection.profileRevisionId.localeCompare(right.projection.profileRevisionId)));
  }
}

export class WorkroomAcceptanceProfileProjectionRuntime {
  readonly #intervalMs: number;
  #timer?: ReturnType<typeof setInterval>;
  #draining?: Promise<number>;

  constructor(readonly options: Readonly<{
    source: PinnedProfileWorkroomAcceptanceProjectionSource;
    repository: FileWorkroomAcceptanceProjectionRepository;
    projects: Readonly<{ listProjectIds(): Promise<readonly string[]> }>;
    signal: AbortSignal;
    intervalMs?: number;
    onError?: (error: unknown) => void;
  }>) {
    this.#intervalMs = positive(options.intervalMs ?? 1_000, 'Acceptance Profile projector interval');
  }

  async drain(): Promise<number> {
    this.options.signal.throwIfAborted();
    if (this.#draining) return await this.#draining;
    const operation = this.#drain();
    this.#draining = operation;
    try {
      return await operation;
    } finally {
      if (this.#draining === operation) this.#draining = undefined;
    }
  }

  start(): void {
    this.options.signal.throwIfAborted();
    if (this.#timer) return;
    void this.#scheduledDrain();
    this.#timer = setInterval(() => void this.#scheduledDrain(), this.#intervalMs);
  }

  dispose(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #drain(): Promise<number> {
    let created = 0;
    const projects = unique(await this.options.projects.listProjectIds());
    for (const projectId of projects) {
      this.options.signal.throwIfAborted();
      for (const candidate of await this.options.source.list(projectId)) {
        if (await this.options.repository.publish(candidate) === 'created') created += 1;
      }
    }
    return created;
  }

  async #scheduledDrain(): Promise<void> {
    try {
      await this.drain();
    } catch (error) {
      if (!this.options.signal.aborted) this.options.onError?.(error);
    }
  }
}

export interface WorkroomArtifactRiskHeaderRequest {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly candidateHash: string;
  readonly reportRef: string;
  readonly reportDigest: string;
  readonly planRef: string;
  readonly planRevision: number;
  readonly artifactRefs: readonly string[];
  readonly policyRevision: number;
}

/**
 * P12 governed Report + P8 committed Git receipts -> content-free Artifact risk headers.
 * A Report is only a locator; it cannot assert risk or authorize its own artifacts.
 */
export class WorkroomAuthenticatedArtifactRiskProducer
implements WorkroomRiskHeaderProducerAuthorityPort {
  readonly #issuer = 'workroom-authenticated-git-artifact-risk';

  constructor(readonly options: Readonly<{
    generation: number;
    reports: WorkroomAcceptedReportReader;
    effectJournal: WorkroomEffectJournal;
  }>) {
    positive(options.generation, 'Artifact Risk producer generation');
  }

  async publications(input: WorkroomArtifactRiskHeaderRequest): Promise<readonly WorkroomRiskHeaderPublication[]> {
    const canonical = normalizeArtifactRiskRequest(input);
    const report = await this.options.reports.read({
      projectId: canonical.projectId,
      runId: canonical.runId,
      taskKey: canonical.taskKey,
      reportRef: canonical.reportRef,
      candidateHash: canonical.candidateHash,
      purpose: 'acceptance-evaluation',
    });
    if (!report || report.projectId !== canonical.projectId || report.runId !== canonical.runId
      || report.taskKey !== canonical.taskKey || report.taskRevision !== canonical.taskRevision
      || report.candidateHash !== canonical.candidateHash || report.ref !== canonical.reportRef
      || report.planRef !== canonical.planRef || report.planRevision !== canonical.planRevision
      || persistedReportDigest(report) !== canonical.reportDigest) {
      throw new Error('Artifact Risk requires an exact authenticated Report');
    }
    const reportedArtifacts = unique(
      report.claims.flatMap(claim => claim.artifactRefs),
    );
    for (const artifactRef of canonical.artifactRefs) {
      if (!reportedArtifacts.includes(artifactRef)) {
        throw new Error('Artifact Risk request is not bound to the authenticated Report');
      }
    }
    const effects = Object.values(replayWorkroomEffectLedger(
      canonical.projectId,
      await this.options.effectJournal.read(canonical.projectId),
    )).filter(state => committedGitState(state, canonical));
    if (effects.length === 0) throw new Error('Artifact Risk requires a committed Git Effect receipt');
    const receiptFacts = effects.map(effect => ({
      intentRef: effect.intent.id,
      intentDigest: effect.intent.digest,
      receiptRef: effect.receipt!.receiptId,
      receiptDigest: digest(effect.receipt),
      providerId: effect.receipt!.provider.id,
      providerDigest: effect.receipt!.provider.digest,
      authenticatedBy: effect.receipt!.authenticatedBy,
    })).sort((left, right) => left.intentRef.localeCompare(right.intentRef));
    const issuerDigest = digest({
      generation: this.options.generation,
      issuer: this.#issuer,
      reportRef: canonical.reportRef,
      reportDigest: canonical.reportDigest,
      receiptFacts,
    });
    return Object.freeze(canonical.artifactRefs.map(artifactRef => {
      const factDigest = digest({
        artifactRef,
        reportRef: canonical.reportRef,
        reportDigest: canonical.reportDigest,
        receiptFacts,
      });
      const header = createWorkroomKernelRiskHeader({
        version: 1,
        sourceType: 'artifact-header',
        sourceRef: artifactRef,
        sourceContentDigest: factDigest,
        issuer: this.#issuer,
        policyRevision: canonical.policyRevision,
        scope: {
          projectId: canonical.projectId,
          runId: canonical.runId,
          taskKey: canonical.taskKey,
          taskRevision: canonical.taskRevision,
          candidateHash: canonical.candidateHash,
        },
        dimensions: {
          sideEffect: 'external',
          reversibility: 'compensatable',
          dataClass: 'restricted',
          blastRadius: 'external',
          capabilityTags: ['authenticated_git_artifact'],
          uncertainty: 'unknown',
        },
      });
      return deepFreeze({
        producer: {
          generation: this.options.generation,
          kind: 'workspace-artifact' as const,
          issuer: this.#issuer,
          issuerDigest,
          factRef: artifactRef,
          factDigest,
          authorityRef: canonical.reportRef,
          authorityDigest: canonical.reportDigest,
        },
        header,
      });
    }));
  }

  async authorize(publication: WorkroomRiskHeaderPublication): Promise<boolean> {
    if (publication.producer.generation !== this.options.generation
      || publication.producer.kind !== 'workspace-artifact'
      || publication.producer.issuer !== this.#issuer
      || publication.producer.authorityRef === undefined
      || publication.producer.authorityDigest === undefined
      || publication.header.sourceType !== 'artifact-header') return false;
    try {
      const report = await this.options.reports.read({
        projectId: publication.header.scope.projectId,
        runId: publication.header.scope.runId,
        taskKey: publication.header.scope.taskKey,
        reportRef: publication.producer.authorityRef,
        candidateHash: publication.header.scope.candidateHash,
        purpose: 'acceptance-evaluation',
      });
      if (!report) return false;
      const expected = await this.publications({
        projectId: publication.header.scope.projectId,
        runId: publication.header.scope.runId,
        taskKey: publication.header.scope.taskKey,
        taskRevision: publication.header.scope.taskRevision,
        candidateHash: publication.header.scope.candidateHash,
        reportRef: publication.producer.authorityRef,
        reportDigest: publication.producer.authorityDigest,
        planRef: report.planRef,
        planRevision: report.planRevision,
        artifactRefs: [publication.header.sourceRef],
        policyRevision: publication.header.policyRevision,
      });
      return expected.some(candidate => canonicalWorkroomJson(candidate) === canonicalWorkroomJson(publication));
    } catch {
      return false;
    }
  }
}

function normalizeArtifactRiskRequest(
  input: WorkroomArtifactRiskHeaderRequest,
): WorkroomArtifactRiskHeaderRequest {
  return deepFreeze({
    projectId: required(input.projectId, 'Artifact Risk Project id'),
    runId: required(input.runId, 'Artifact Risk Run id'),
    taskKey: required(input.taskKey, 'Artifact Risk Task key'),
    taskRevision: positive(input.taskRevision, 'Artifact Risk Task revision'),
    candidateHash: requiredDigest(input.candidateHash, 'Artifact Risk candidate hash'),
    reportRef: required(input.reportRef, 'Artifact Risk Report ref'),
    reportDigest: requiredDigest(input.reportDigest, 'Artifact Risk Report digest'),
    planRef: required(input.planRef, 'Artifact Risk Plan ref'),
    planRevision: positive(input.planRevision, 'Artifact Risk Plan revision'),
    artifactRefs: unique(input.artifactRefs),
    policyRevision: positive(input.policyRevision, 'Artifact Risk policy revision'),
  });
}

function persistedReportDigest(report: Awaited<ReturnType<WorkroomAcceptedReportReader['read']>>): string {
  if (!report) throw new Error('Artifact Risk Report is unavailable');
  const value = report as typeof report & { readonly version?: unknown; readonly digest?: unknown };
  const { digest: declared, ...body } = value;
  const actual = digest(body);
  if (declared !== undefined && declared !== actual) throw new Error('Authenticated Report digest drift');
  return actual;
}

function committedGitState(
  state: WorkroomEffectState,
  request: WorkroomArtifactRiskHeaderRequest,
): boolean {
  return state.status === 'committed'
    && state.receipt?.outcome === 'committed'
    && (state.intent.operation.kind === 'git_push' || state.intent.operation.kind === 'git_open_pr')
    && state.intent.projectId === request.projectId
    && state.intent.runId === request.runId
    && state.intent.taskKey === request.taskKey
    && state.intent.taskRevision === request.taskRevision
    && state.intent.candidateHash === request.candidateHash;
}

export class WorkroomArtifactRiskHeaderResolver implements WorkroomKernelRiskHeaderPort {
  constructor(readonly options: Readonly<{
    repository: FileWorkroomKernelRiskHeaderRepository;
    producer: WorkroomAuthenticatedArtifactRiskProducer;
  }>) {}

  async resolve(input: WorkroomArtifactRiskHeaderRequest) {
    if (input.artifactRefs.length > 0) {
      for (const publication of await this.options.producer.publications(input)) {
        await this.options.repository.publish(publication);
      }
    }
    return await this.options.repository.resolve(input);
  }
}

/** A generation may provide typed checks, but the standard Host intentionally has no CI default. */
export const workroomTypedAcceptanceCheckRegistryToken = createToken<ImmutableWorkroomTypedCheckRegistry>(
  'zhin.agent.workroom-typed-acceptance-check-registry',
  'Generation-owned typed Acceptance Check provider registry',
);

export interface WorkroomAuthenticatedRemoteContextReleaseReceipt {
  readonly version: 1;
  readonly operationId: string;
  readonly eligibilityDigest: string;
  readonly routeRef: string;
  readonly routeDigest: string;
  readonly status: 'released' | 'outcome_unknown';
  readonly receiptRef: string;
  readonly authenticatedBy: string;
  readonly digest: string;
}

export interface WorkroomAuthenticatedRemoteContextReleasePort {
  release(input: Readonly<{
    request: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['release']>[0]['request'];
    route: WorkroomEphemeralContextRouteFact;
  }>, signal: AbortSignal): Promise<WorkroomAuthenticatedRemoteContextReleaseReceipt>;
  reconcile(input: Readonly<{
    request: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['release']>[0]['request'];
    route: WorkroomEphemeralContextRouteFact;
  }>, signal: AbortSignal): Promise<WorkroomAuthenticatedRemoteContextReleaseReceipt>;
}

export const workroomRemoteContextReleaseProviderToken =
  createToken<WorkroomAuthenticatedRemoteContextReleasePort>(
    'zhin.agent.workroom-remote-context-release-provider',
    'Generation-owned authenticated A2A remote Context release provider',
  );

/** Missing A2A support and unknown remote outcome remain durable blockers in the disposer. */
export function createGenerationRemoteContextReleaseCapability(
  resolve: () => WorkroomAuthenticatedRemoteContextReleasePort | undefined,
): WorkroomEphemeralContextReleaseCapabilityPort {
  const invoke = async (
    method: 'release' | 'reconcile',
    input: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['release']>[0],
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted();
    const provider = resolve();
    if (!provider) return deepFreeze({
      status: 'outcome_unknown' as const,
      receiptRef: `remote-context-provider-unavailable:${input.route.digest}`,
      authenticatedBy: `remote-context-route:${input.route.digest}`,
    });
    const receipt = await provider[method](input, signal);
    const body = {
      version: 1 as const,
      operationId: required(receipt.operationId, 'Remote Context receipt operation id'),
      eligibilityDigest: requiredDigest(
        receipt.eligibilityDigest,
        'Remote Context receipt eligibility digest',
      ),
      routeRef: required(receipt.routeRef, 'Remote Context receipt route ref'),
      routeDigest: requiredDigest(receipt.routeDigest, 'Remote Context receipt route digest'),
      status: receipt.status,
      receiptRef: required(receipt.receiptRef, 'Remote Context receipt ref'),
      authenticatedBy: required(receipt.authenticatedBy, 'Remote Context receipt authenticatedBy'),
    };
    if ((body.status !== 'released' && body.status !== 'outcome_unknown')
      || body.operationId !== input.request.operationId
      || body.eligibilityDigest !== digest(input.request.eligibility)
      || body.routeRef !== input.route.ref || body.routeDigest !== input.route.digest
      || receipt.digest !== digest(body)) {
      throw new Error('Remote Context receipt authority binding drift');
    }
    return deepFreeze({
      status: body.status,
      receiptRef: body.receiptRef,
      authenticatedBy: body.authenticatedBy,
    });
  };
  return Object.freeze({
    release: (
      input: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['release']>[0],
      signal: AbortSignal,
    ) => invoke('release', input, signal),
    reconcile: (
      input: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['reconcile']>[0],
      signal: AbortSignal,
    ) => invoke('reconcile', input, signal),
  });
}

function candidateForPin(
  profile: ProjectProfileRegistrySnapshot,
  catalog: WorkroomCatalogSnapshot,
  pin: WorkroomRunProfilePin,
): WorkroomAcceptanceProjectionCandidate {
  const revision = profile.revisions[pin.profileRevisionId];
  if (!revision || revision.projectId !== pin.projectId
    || revision.compiledDigest !== pin.profileDigest
    || revision.compiledProfile.digest !== pin.profileDigest
    || pin.activationRegistryRevision < 0) {
    throw new Error('Acceptance Profile source requires an exact immutable Run pin');
  }
  const definition = catalog.definitions[pin.projectId];
  if (!definition || definition.enabled === false) {
    throw new Error('Acceptance Profile source Project is unavailable in the persistent Catalog');
  }
  const policies = revision.compiledProfile.acceptancePolicies ?? [];
  if (policies.length !== 1) {
    throw new Error('Acceptance Profile source requires exactly one compiled Acceptance Policy');
  }
  const policy = policies[0]!;
  const projectDigest = digest(definition);
  const issuer = `profile-policy:${catalog.revision}:${projectDigest}`;
  const projection = createWorkroomGovernedAcceptanceProjection({
    version: 1,
    projectId: pin.projectId,
    profileRevisionId: pin.profileRevisionId,
    profileDigest: pin.profileDigest,
    revision: pin.activationRegistryRevision + 1,
    issuer,
    tasks: policy.tasks,
    memorySchema: policy.memorySchema,
  });
  const source = deepFreeze({
    kind: 'profile-policy' as const,
    ref: `profile-policy:${pin.projectId}:${pin.profileRevisionId}`,
    digest: digest({
      profileRevisionId: pin.profileRevisionId,
      profileDigest: pin.profileDigest,
      acceptancePolicy: policy,
    }),
    issuer,
    issuerDigest: digest({
      catalogRevision: catalog.revision,
      projectDigest,
      profileRevisionId: pin.profileRevisionId,
      profileDigest: pin.profileDigest,
      activationRegistryRevision: pin.activationRegistryRevision,
    }),
    revision: pin.activationRegistryRevision + 1,
  });
  return deepFreeze({ projection, source });
}

function required(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredDigest(value: string, label: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(required(value, label))) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid`);
  return value;
}

function unique(values: readonly string[]): readonly string[] {
  const normalized = values.map(value => required(value, 'Acceptance Profile Project id'));
  return Object.freeze([...new Set(normalized)].sort());
}
