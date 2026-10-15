import {
  canonicalWorkroomJson as stableJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import type { CapabilityPackRef, CompiledWorkroomProfile } from './profile-compiler.js';

export type ProfileRevisionSourceKind =
  | 'acceptance_record'
  | 'accepted_task_memory'
  | 'sponsor_decision'
  | 'trusted_pack_publication';

export interface ProfileRevisionSource {
  readonly kind: ProfileRevisionSourceKind;
  readonly sourceId: string;
}

export type ProjectProfileGovernanceOperation = 'register_revision' | 'register_rollback';

export interface ProfileCompositionCapabilityRef {
  readonly id: string;
  readonly digest: string;
  readonly semanticDigest: string;
}

export interface ProjectProfileGovernanceComposition {
  readonly revisionId: string;
  readonly charterRevisionId: string;
  readonly compiledDigest: string;
  readonly overlayDigest: string;
  readonly packs: readonly CapabilityPackRef[];
  readonly tools: readonly ProfileCompositionCapabilityRef[];
  readonly skills: readonly ProfileCompositionCapabilityRef[];
  readonly agents: readonly ProfileCompositionCapabilityRef[];
  readonly workflows: readonly ProfileCompositionCapabilityRef[];
  readonly memories: readonly ProfileCompositionCapabilityRef[];
  readonly glossaries: readonly ProfileCompositionCapabilityRef[];
  readonly acceptancePolicies: readonly ProfileCompositionCapabilityRef[];
}

export interface ProfileSemanticCapabilityDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  readonly authorityExpansion: boolean;
}

export interface ProjectProfileSemanticDiff {
  readonly bootstrap: boolean;
  readonly charter: Readonly<{
    changed: boolean;
    authorityExpansion: boolean;
  }>;
  readonly tool: ProfileSemanticCapabilityDiff;
  readonly skill: ProfileSemanticCapabilityDiff;
  readonly agent: ProfileSemanticCapabilityDiff;
  readonly workflow: ProfileSemanticCapabilityDiff;
  readonly memory: ProfileSemanticCapabilityDiff;
  readonly glossary: ProfileSemanticCapabilityDiff;
  readonly acceptancePolicy: ProfileSemanticCapabilityDiff;
  /** Pack kind is absent from compiler output, so any Pack add/change is conservatively policy expansion. */
  readonly policy: ProfileSemanticCapabilityDiff;
  readonly overlay: Readonly<{
    changed: boolean;
    authorityExpansion: boolean;
  }>;
  readonly authorityExpansion: boolean;
}

export interface ProjectProfileGovernanceAuthorizationInput {
  readonly operation: ProjectProfileGovernanceOperation;
  readonly projectId: string;
  readonly expectedRegistryRevision: number;
  readonly revisionId: string;
  readonly compiledDigest: string;
  readonly overlayDigest: string;
  readonly source: ProfileRevisionSource;
  readonly currentActive?: ProjectProfileGovernanceComposition;
  readonly semanticDiff: ProjectProfileSemanticDiff;
  readonly parentRevisionId?: string;
  readonly restoredFromRevisionId?: string;
}

export interface ProfileGovernanceDecision extends ProjectProfileGovernanceAuthorizationInput {
  readonly approved: true;
  readonly decisionId: string;
  readonly route: 'policy' | 'sponsor';
  readonly outcome: 'approved';
  readonly decidedBy: string;
}

export type ProjectProfileGovernanceAuthorizationDecision =
  | ProfileGovernanceDecision
  | Readonly<{ approved: false; reason: string }>;

export interface ProjectProfileGovernancePort {
  authorize(
    input: ProjectProfileGovernanceAuthorizationInput,
  ): Promise<ProjectProfileGovernanceAuthorizationDecision>;
}

/** Immutable Project-local record of one compiler output and its authority. */
export interface ProjectProfileRevision {
  readonly revisionId: string;
  readonly projectId: string;
  readonly charterRevisionId: string;
  readonly packRefs: readonly CapabilityPackRef[];
  readonly overlayDigest: string;
  readonly compiledDigest: string;
  readonly compiledProfile: CompiledWorkroomProfile;
  readonly parentRevisionId?: string;
  readonly restoredFromRevisionId?: string;
  readonly source: ProfileRevisionSource;
  readonly governanceDecision: ProfileGovernanceDecision;
}

export type ProjectProfileRevisionCandidate = Omit<ProjectProfileRevision, 'governanceDecision'>;

export interface ActiveProjectProfile {
  readonly revisionId: string;
  readonly compiledDigest: string;
  readonly activatedAtRegistryRevision: number;
}

export interface WorkroomRunProfilePin {
  readonly projectId: string;
  readonly runId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly activationRegistryRevision: number;
  readonly pinnedAtRegistryRevision: number;
}

export interface ProjectProfileRegistrySnapshot {
  readonly projectId: string;
  readonly registryRevision: number;
  readonly revisions: Readonly<Record<string, ProjectProfileRevision>>;
  readonly active?: ActiveProjectProfile;
  readonly runPins: Readonly<Record<string, WorkroomRunProfilePin>>;
}

export class ProfileRegistrySequenceConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Project Profile Registry ${projectId} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'ProfileRegistrySequenceConflictError';
  }
}

export type ProjectProfileEvent = Readonly<{
  version: 1;
  projectId: string;
  sequence: number;
} & (
  | { type: 'profile.revision_registered'; payload: { revision: ProjectProfileRevision } }
  | { type: 'profile.revision_activated'; payload: ActiveProjectProfile }
  | { type: 'run.profile_pinned'; payload: WorkroomRunProfilePin }
)>;

export type ProjectProfileEventDraft =
  | { readonly type: 'profile.revision_registered'; readonly payload: { readonly revision: ProjectProfileRevision } }
  | { readonly type: 'profile.revision_activated'; readonly payload: ActiveProjectProfile }
  | { readonly type: 'run.profile_pinned'; readonly payload: WorkroomRunProfilePin };

export interface ProjectProfileJournal {
  read(projectId: string): Promise<readonly ProjectProfileEvent[]>;
  append(
    projectId: string,
    expectedRevision: number,
    drafts: readonly ProjectProfileEventDraft[],
  ): Promise<readonly ProjectProfileEvent[]>;
}

/** Contract fixture only. Production durability belongs in a journal adapter. */
export class MemoryProjectProfileJournal implements ProjectProfileJournal {
  readonly #projects = new Map<string, readonly ProjectProfileEvent[]>();

  async read(projectId: string): Promise<readonly ProjectProfileEvent[]> {
    return this.#projects.get(projectId) ?? [];
  }

  async append(
    projectId: string,
    expectedRevision: number,
    drafts: readonly ProjectProfileEventDraft[],
  ): Promise<readonly ProjectProfileEvent[]> {
    const current = this.#projects.get(projectId) ?? [];
    const actualRevision = current.at(-1)?.sequence ?? -1;
    if (actualRevision !== expectedRevision) {
      throw new ProfileRegistrySequenceConflictError(projectId, expectedRevision, actualRevision);
    }
    const events = drafts.map<ProjectProfileEvent>((draft, index) => deepFreeze({
      ...copyDraft(draft),
      version: 1 as const,
      projectId,
      sequence: expectedRevision + index + 1,
    } as ProjectProfileEvent));
    this.#projects.set(projectId, deepFreeze([...current, ...events]));
    return deepFreeze(events);
  }
}

export interface RegisterProjectProfileRevisionInput {
  readonly projectId: string;
  readonly expectedRegistryRevision: number;
  readonly revision: ProjectProfileRevisionCandidate;
}

export interface ActivateProjectProfileRevisionInput {
  readonly projectId: string;
  readonly expectedRegistryRevision: number;
  readonly revisionId: string;
  readonly compiledDigest: string;
}

export interface RegisterProjectProfileRollbackInput extends RegisterProjectProfileRevisionInput {
  readonly restoredFromRevisionId: string;
}

export interface PinWorkroomRunProfileInput {
  readonly projectId: string;
  readonly runId: string;
  readonly expectedRegistryRevision: number;
}

/** Project-scoped authority for immutable Profile history, activation, and Run pins. */
export class ProjectProfileRegistry {
  readonly #journal: ProjectProfileJournal;
  readonly #governance?: ProjectProfileGovernancePort;

  constructor(journal: ProjectProfileJournal, governance?: ProjectProfileGovernancePort) {
    this.#journal = journal;
    this.#governance = governance;
  }

  async read(projectId: string): Promise<ProjectProfileRegistrySnapshot> {
    assertId(projectId, 'projectId');
    return replayProjectProfileJournal(projectId, await this.#journal.read(projectId));
  }

  async registerRevision(input: RegisterProjectProfileRevisionInput): Promise<ProjectProfileRegistrySnapshot> {
    return this.#register(input, false);
  }

  async registerRollback(input: RegisterProjectProfileRollbackInput): Promise<ProjectProfileRegistrySnapshot> {
    const projectId = input.projectId;
    const expectedRegistryRevision = input.expectedRegistryRevision;
    const restoredFromRevisionId = input.restoredFromRevisionId;
    const candidate = copyRevisionCandidate(input.revision);
    assertInputPosition(projectId, expectedRegistryRevision);
    assertRevisionCandidate(candidate, projectId);
    const state = await this.read(projectId);
    const active = state.active;
    if (!active) throw new Error('Profile rollback requires an active Profile Revision');
    const restored = state.revisions[restoredFromRevisionId];
    if (!restored) throw new Error(`Restored Profile Revision ${restoredFromRevisionId} not found`);
    if (candidate.revisionId === restoredFromRevisionId) {
      throw new Error('Profile rollback must create a new Profile Revision identity');
    }
    if (candidate.parentRevisionId !== active.revisionId) {
      throw new Error(`Profile rollback parent must be active Revision ${active.revisionId}`);
    }
    if (candidate.restoredFromRevisionId !== restoredFromRevisionId) {
      throw new Error('Profile rollback restoredFromRevisionId binding mismatch');
    }
    if (candidate.overlayDigest !== restored.overlayDigest
      || profileComposition(candidate.compiledProfile) !== profileComposition(restored.compiledProfile)) {
      throw new Error(`Profile rollback ${candidate.revisionId} does not restore Revision ${restoredFromRevisionId}`);
    }
    return this.#register({ projectId, expectedRegistryRevision, revision: candidate }, true);
  }

  async activateRevision(input: ActivateProjectProfileRevisionInput): Promise<ProjectProfileRegistrySnapshot> {
    const { projectId, expectedRegistryRevision, revisionId, compiledDigest } = input;
    assertInputPosition(projectId, expectedRegistryRevision);
    assertId(revisionId, 'revisionId');
    assertDigest(compiledDigest, 'compiledDigest');
    const state = await this.read(projectId);
    const revision = state.revisions[revisionId];
    if (!revision) throw new Error(`Profile Revision ${revisionId} not found`);
    if (revision.compiledDigest !== compiledDigest) {
      throw new Error(`Profile Revision ${revisionId} compiled digest mismatch`);
    }
    if (state.active?.revisionId === revisionId) {
      if (state.active.compiledDigest !== compiledDigest) {
        throw new Error(`Active Profile Revision ${revisionId} digest drift`);
      }
      return state;
    }
    const previouslyActivated = (await this.#journal.read(projectId)).some(event =>
      event.type === 'profile.revision_activated' && event.payload.revisionId === revisionId);
    if (previouslyActivated) {
      throw new Error(`Profile Revision ${revisionId} was already active; create a rollback Revision`);
    }
    if (state.active && revision.parentRevisionId !== state.active.revisionId) {
      throw new Error(`Profile Revision ${revisionId} is stale; expected parent ${state.active.revisionId}`);
    }
    const activatedAtRegistryRevision = state.registryRevision + 1;
    await this.#journal.append(projectId, expectedRegistryRevision, [{
      type: 'profile.revision_activated',
      payload: {
        revisionId: revision.revisionId,
        compiledDigest: revision.compiledDigest,
        activatedAtRegistryRevision,
      },
    }]);
    return this.read(projectId);
  }

  async pinRun(input: PinWorkroomRunProfileInput): Promise<WorkroomRunProfilePin> {
    const { projectId, runId, expectedRegistryRevision } = input;
    assertInputPosition(projectId, expectedRegistryRevision);
    assertId(runId, 'runId');
    const state = await this.read(projectId);
    const existing = state.runPins[runId];
    if (existing) return existing;
    if (!state.active) throw new Error('Cannot pin a Run without an active Profile Revision');
    const pin = deepFreeze({
      projectId,
      runId,
      profileRevisionId: state.active.revisionId,
      profileDigest: state.active.compiledDigest,
      activationRegistryRevision: state.active.activatedAtRegistryRevision,
      pinnedAtRegistryRevision: state.registryRevision + 1,
    });
    await this.#journal.append(projectId, expectedRegistryRevision, [{
      type: 'run.profile_pinned',
      payload: pin,
    }]);
    const pinned = (await this.read(projectId)).runPins[runId];
    if (!pinned) throw new Error(`Workroom Run ${runId} Profile pin was not persisted`);
    return pinned;
  }

  async #register(
    input: RegisterProjectProfileRevisionInput,
    rollback: boolean,
  ): Promise<ProjectProfileRegistrySnapshot> {
    const candidate = copyRevisionCandidate(input.revision);
    const projectId = input.projectId;
    const expectedRegistryRevision = input.expectedRegistryRevision;
    assertInputPosition(projectId, expectedRegistryRevision);
    assertRevisionCandidate(candidate, projectId);
    const state = await this.read(projectId);
    const existing = state.revisions[candidate.revisionId];
    if (existing) {
      if (stableJson(copyRevisionCandidate(existing)) !== stableJson(candidate)) {
        throw new Error(`Profile Revision ${candidate.revisionId} identity payload drift`);
      }
      return state;
    }
    if (Boolean(candidate.restoredFromRevisionId) !== rollback) {
      throw new Error(rollback
        ? 'Profile rollback must bind restoredFromRevisionId'
        : 'restoredFromRevisionId is only valid through registerRollback');
    }
    const revisionIds = Object.keys(state.revisions);
    if (revisionIds.length === 0 && candidate.parentRevisionId) {
      throw new Error('Initial Profile Revision cannot have a parent');
    }
    if (revisionIds.length > 0) {
      if (!candidate.parentRevisionId) throw new Error('Profile Revision parentRevisionId is required');
      if (!state.revisions[candidate.parentRevisionId]) {
        throw new Error(`Parent Profile Revision ${candidate.parentRevisionId} not found`);
      }
    }
    const governanceDecision = await this.#authorize(
      candidate,
      rollback ? 'register_rollback' : 'register_revision',
      expectedRegistryRevision,
      state.active ? state.revisions[state.active.revisionId] : undefined,
    );
    const revision = deepFreeze({ ...candidate, governanceDecision });
    await this.#journal.append(projectId, expectedRegistryRevision, [{
      type: 'profile.revision_registered',
      payload: { revision },
    }]);
    return this.read(projectId);
  }

  async #authorize(
    candidate: ProjectProfileRevisionCandidate,
    operation: ProjectProfileGovernanceOperation,
    expectedRegistryRevision: number,
    currentActive: ProjectProfileRevision | undefined,
  ): Promise<ProfileGovernanceDecision> {
    const governance = this.#governance;
    if (!governance) throw new Error('Project Profile Governance Port is not installed');
    const input = createProjectProfileGovernanceAuthorizationInput(
      candidate,
      operation,
      expectedRegistryRevision,
      currentActive,
    );
    const decision = await governance.authorize(input);
    if (!decision.approved) {
      throw new Error(`Profile governance denied: ${decision.reason}`);
    }
    const canonicalDecision = copyGovernanceDecision(decision);
    assertGovernanceDecision(canonicalDecision, input);
    assertGovernanceFloor(canonicalDecision);
    return canonicalDecision;
  }
}

export function createProjectProfileGovernanceAuthorizationInput(
  candidate: ProjectProfileRevisionCandidate,
  operation: ProjectProfileGovernanceOperation,
  expectedRegistryRevision: number,
  currentActive: ProjectProfileRevision | undefined,
): ProjectProfileGovernanceAuthorizationInput {
  const activeComposition = currentActive ? profileGovernanceComposition(currentActive) : undefined;
  const candidateComposition = profileGovernanceComposition(candidate);
  const tool = semanticCapabilityDiff(activeComposition?.tools ?? [], candidateComposition.tools);
  const skill = semanticCapabilityDiff(activeComposition?.skills ?? [], candidateComposition.skills);
  const agent = semanticCapabilityDiff(activeComposition?.agents ?? [], candidateComposition.agents);
  const workflowChanges = semanticCapabilityDiff(
    activeComposition?.workflows ?? [],
    candidateComposition.workflows,
  );
  const workflow = deepFreeze({
    ...workflowChanges,
    // Removing a required safety/review step can widen effective authority.
    authorityExpansion: workflowChanges.added.length > 0
      || workflowChanges.removed.length > 0
      || workflowChanges.changed.length > 0,
  });
  const memoryChanges = semanticCapabilityDiff(
    activeComposition?.memories ?? [],
    candidateComposition.memories,
  );
  const memory = deepFreeze({
    ...memoryChanges,
    authorityExpansion: memoryChanges.added.length > 0
      || memoryChanges.removed.length > 0
      || memoryChanges.changed.length > 0,
  });
  const glossaryChanges = semanticCapabilityDiff(
    activeComposition?.glossaries ?? [],
    candidateComposition.glossaries,
  );
  const glossary = deepFreeze({
    ...glossaryChanges,
    authorityExpansion: glossaryChanges.added.length > 0
      || glossaryChanges.removed.length > 0
      || glossaryChanges.changed.length > 0,
  });
  const acceptancePolicyChanges = semanticCapabilityDiff(
    activeComposition?.acceptancePolicies ?? [],
    candidateComposition.acceptancePolicies,
  );
  const acceptancePolicy = deepFreeze({
    ...acceptancePolicyChanges,
    // Adding, changing or removing criteria/Memory rules can all relax a
    // previous acceptance floor, so the diff is conservatively privileged.
    authorityExpansion: acceptancePolicyChanges.added.length > 0
      || acceptancePolicyChanges.removed.length > 0
      || acceptancePolicyChanges.changed.length > 0,
  });
  const policyChanges = semanticCapabilityDiff(
    (activeComposition?.packs ?? []).map(packSemanticRef),
    candidateComposition.packs.map(packSemanticRef),
  );
  const policy = deepFreeze({
    ...policyChanges,
    // Pack kind/policy polarity is unavailable after compilation. Removal may
    // relax a deny floor, so every Pack change is an expansion until a richer
    // compiler projection can prove otherwise.
    authorityExpansion: policyChanges.added.length > 0
      || policyChanges.removed.length > 0
      || policyChanges.changed.length > 0,
  });
  const overlayChanged = activeComposition?.overlayDigest !== candidate.overlayDigest;
  const charterChanged = activeComposition?.charterRevisionId !== candidate.charterRevisionId;
  const bootstrap = !activeComposition;
  const semanticDiff = deepFreeze({
    bootstrap,
    charter: {
      changed: charterChanged,
      authorityExpansion: charterChanged,
    },
    tool,
    skill,
    agent,
    workflow,
    memory,
    glossary,
    acceptancePolicy,
    policy,
    overlay: {
      changed: overlayChanged,
      authorityExpansion: overlayChanged,
    },
    authorityExpansion: bootstrap
      || charterChanged
      || tool.authorityExpansion
      || skill.authorityExpansion
      || agent.authorityExpansion
      || workflow.authorityExpansion
      || memory.authorityExpansion
      || glossary.authorityExpansion
      || acceptancePolicy.authorityExpansion
      || policy.authorityExpansion
      || overlayChanged,
  });
  return deepFreeze({
    operation,
    projectId: candidate.projectId,
    expectedRegistryRevision,
    revisionId: candidate.revisionId,
    compiledDigest: candidate.compiledDigest,
    overlayDigest: candidate.overlayDigest,
    source: { ...candidate.source },
    ...(activeComposition ? { currentActive: activeComposition } : {}),
    semanticDiff,
    ...(candidate.parentRevisionId ? { parentRevisionId: candidate.parentRevisionId } : {}),
    ...(candidate.restoredFromRevisionId
      ? { restoredFromRevisionId: candidate.restoredFromRevisionId }
      : {}),
  });
}

export function replayProjectProfileJournal(
  projectId: string,
  events: readonly ProjectProfileEvent[],
): ProjectProfileRegistrySnapshot {
  assertId(projectId, 'projectId');
  const revisions: Record<string, ProjectProfileRevision> = {};
  const runPins: Record<string, WorkroomRunProfilePin> = {};
  const activatedRevisionIds = new Set<string>();
  let active: ActiveProjectProfile | undefined;
  let expectedSequence = 0;
  for (const event of events) {
    if (event.version !== 1 || event.projectId !== projectId || event.sequence !== expectedSequence) {
      throw new Error('Invalid Project Profile Journal event position');
    }
    if (event.type === 'profile.revision_registered') {
      const revision = copyRevision(event.payload.revision);
      const currentActive = active ? revisions[active.revisionId] : undefined;
      assertRevision(revision, projectId, event.sequence - 1, currentActive);
      const existing = revisions[revision.revisionId];
      if (existing && stableJson(existing) !== stableJson(revision)) {
        throw new Error(`Profile Revision ${revision.revisionId} identity payload drift`);
      }
      if (existing) throw new Error(`Duplicate Profile Revision ${revision.revisionId}`);
      const revisionCount = Object.keys(revisions).length;
      if (revisionCount === 0 && revision.parentRevisionId) {
        throw new Error('Initial Profile Revision cannot have a parent');
      }
      if (revisionCount > 0 && !revision.parentRevisionId) {
        throw new Error('Profile Revision parentRevisionId is required');
      }
      if (revision.parentRevisionId && !revisions[revision.parentRevisionId]) {
        throw new Error(`Parent Profile Revision ${revision.parentRevisionId} not found`);
      }
      if (revision.restoredFromRevisionId) {
        const restored = revisions[revision.restoredFromRevisionId];
        if (!restored) {
          throw new Error(`Restored Profile Revision ${revision.restoredFromRevisionId} not found`);
        }
        if (revision.revisionId === revision.restoredFromRevisionId) {
          throw new Error('Profile rollback must create a new Profile Revision identity');
        }
        if (!active || revision.parentRevisionId !== active.revisionId) {
          throw new Error('Profile rollback parent must be the active Profile Revision');
        }
        if (revision.overlayDigest !== restored.overlayDigest
          || profileComposition(revision.compiledProfile) !== profileComposition(restored.compiledProfile)) {
          throw new Error(`Profile rollback ${revision.revisionId} does not restore Revision ${revision.restoredFromRevisionId}`);
        }
      }
      revisions[revision.revisionId] = revision;
    } else if (event.type === 'profile.revision_activated') {
      const revision = revisions[event.payload.revisionId];
      if (!revision || revision.compiledDigest !== event.payload.compiledDigest
        || event.payload.activatedAtRegistryRevision !== event.sequence) {
        throw new Error('Invalid active Profile Revision binding');
      }
      if (active && revision.parentRevisionId !== active.revisionId) {
        throw new Error('Active Profile Revision does not descend from the current Revision');
      }
      if (activatedRevisionIds.has(revision.revisionId)) {
        throw new Error(`Profile Revision ${revision.revisionId} was activated more than once`);
      }
      assertGovernanceFloor(revision.governanceDecision);
      active = copyActive(event.payload);
      activatedRevisionIds.add(revision.revisionId);
    } else {
      const pin = copyPin(event.payload);
      if (!active || pin.projectId !== projectId || pin.profileRevisionId !== active.revisionId
        || pin.profileDigest !== active.compiledDigest
        || pin.activationRegistryRevision !== active.activatedAtRegistryRevision
        || pin.pinnedAtRegistryRevision !== event.sequence) {
        throw new Error('Invalid Workroom Run Profile pin binding');
      }
      const existing = runPins[pin.runId];
      if (existing && stableJson(existing) !== stableJson(pin)) {
        throw new Error(`Workroom Run ${pin.runId} Profile pin drift`);
      }
      if (existing) throw new Error(`Duplicate Workroom Run Profile pin ${pin.runId}`);
      runPins[pin.runId] = pin;
    }
    expectedSequence += 1;
  }
  return deepFreeze({
    projectId,
    registryRevision: events.at(-1)?.sequence ?? -1,
    revisions,
    active,
    runPins,
  });
}

function assertRevision(
  revision: ProjectProfileRevision,
  projectId: string,
  expectedRegistryRevision: number,
  currentActive: ProjectProfileRevision | undefined,
): void {
  assertRevisionCandidate(revision, projectId);
  const expected = createProjectProfileGovernanceAuthorizationInput(
    revision,
    revision.restoredFromRevisionId ? 'register_rollback' : 'register_revision',
    expectedRegistryRevision,
    currentActive,
  );
  assertGovernanceDecision(revision.governanceDecision, expected);
  assertGovernanceFloor(revision.governanceDecision);
}

function assertRevisionCandidate(
  revision: ProjectProfileRevisionCandidate,
  projectId: string,
): void {
  assertId(revision.revisionId, 'revisionId');
  if (revision.projectId !== projectId || revision.compiledProfile.projectId !== projectId) {
    throw new Error('Profile Revision Project binding mismatch');
  }
  assertId(revision.charterRevisionId, 'charterRevisionId');
  assertDigest(revision.overlayDigest, 'overlayDigest');
  assertDigest(revision.compiledDigest, 'compiledDigest');
  if (revision.charterRevisionId !== revision.compiledProfile.charterRevisionId
    || revision.revisionId !== revision.compiledProfile.revisionId
    || revision.compiledDigest !== revision.compiledProfile.digest
    || stableJson(revision.packRefs) !== stableJson(revision.compiledProfile.packRefs)) {
    throw new Error('Profile Revision compiler output binding mismatch');
  }
  const { digest: _digest, ...projection } = revision.compiledProfile;
  if (digest(projection) !== revision.compiledDigest) {
    throw new Error('Profile Revision compiled digest is invalid');
  }
  if (!['acceptance_record', 'accepted_task_memory', 'sponsor_decision', 'trusted_pack_publication']
    .includes(revision.source.kind)) {
    throw new Error('Invalid Profile Revision source kind');
  }
  assertId(revision.source.sourceId, 'sourceId');
  if (revision.parentRevisionId) assertId(revision.parentRevisionId, 'parentRevisionId');
  if (revision.restoredFromRevisionId) assertId(revision.restoredFromRevisionId, 'restoredFromRevisionId');
}

function assertGovernanceDecision(
  decision: ProfileGovernanceDecision,
  expected: ProjectProfileGovernanceAuthorizationInput,
): void {
  assertId(decision.decisionId, 'governance decisionId');
  assertId(decision.decidedBy, 'governance decidedBy');
  if (decision.approved !== true
    || decision.outcome !== 'approved'
    || !['policy', 'sponsor'].includes(decision.route)
    || decision.operation !== expected.operation
    || decision.projectId !== expected.projectId
    || decision.expectedRegistryRevision !== expected.expectedRegistryRevision
    || decision.revisionId !== expected.revisionId
    || decision.compiledDigest !== expected.compiledDigest
    || decision.overlayDigest !== expected.overlayDigest
    || stableJson(decision.source) !== stableJson(expected.source)
    || stableJson(decision.currentActive) !== stableJson(expected.currentActive)
    || stableJson(decision.semanticDiff) !== stableJson(expected.semanticDiff)
    || decision.parentRevisionId !== expected.parentRevisionId
    || decision.restoredFromRevisionId !== expected.restoredFromRevisionId) {
    throw new Error('Profile governance decision scope mismatch');
  }
}

function assertGovernanceFloor(decision: ProfileGovernanceDecision): void {
  if ((decision.semanticDiff.bootstrap || decision.semanticDiff.authorityExpansion)
    && decision.route !== 'sponsor') {
    throw new Error('Sponsor governance is required for Profile bootstrap or authority expansion');
  }
}

function assertInputPosition(projectId: string, expectedRevision: number): void {
  assertId(projectId, 'projectId');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < -1) {
    throw new Error('Invalid Project Profile Registry expected revision');
  }
}

function assertId(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Invalid Profile ${name}`);
  }
}

function assertDigest(value: string, name: string): void {
  assertId(value, name);
  if (!value.startsWith('sha256:')) throw new Error(`Invalid Profile ${name}`);
}

function copyRevision(value: ProjectProfileRevision): ProjectProfileRevision {
  return deepFreeze({
    ...copyRevisionCandidate(value),
    governanceDecision: copyGovernanceDecision(value.governanceDecision),
  });
}

function copyRevisionCandidate(
  value: ProjectProfileRevisionCandidate,
): ProjectProfileRevisionCandidate {
  return deepFreeze({
    revisionId: value.revisionId,
    projectId: value.projectId,
    charterRevisionId: value.charterRevisionId,
    packRefs: value.packRefs.map(copyPackRef),
    overlayDigest: value.overlayDigest,
    compiledDigest: value.compiledDigest,
    compiledProfile: copyCompiledProfile(value.compiledProfile),
    ...(value.parentRevisionId ? { parentRevisionId: value.parentRevisionId } : {}),
    ...(value.restoredFromRevisionId ? { restoredFromRevisionId: value.restoredFromRevisionId } : {}),
    source: { kind: value.source.kind, sourceId: value.source.sourceId },
  });
}

function copyGovernanceDecision(value: ProfileGovernanceDecision): ProfileGovernanceDecision {
  return deepFreeze({
    approved: true,
    operation: value.operation,
    projectId: value.projectId,
    expectedRegistryRevision: value.expectedRegistryRevision,
    revisionId: value.revisionId,
    compiledDigest: value.compiledDigest,
    overlayDigest: value.overlayDigest,
    source: { kind: value.source.kind, sourceId: value.source.sourceId },
    ...(value.currentActive ? { currentActive: copyGovernanceComposition(value.currentActive) } : {}),
    semanticDiff: copySemanticDiff(value.semanticDiff),
    ...(value.parentRevisionId ? { parentRevisionId: value.parentRevisionId } : {}),
    ...(value.restoredFromRevisionId ? { restoredFromRevisionId: value.restoredFromRevisionId } : {}),
    decisionId: value.decisionId,
    route: value.route,
    outcome: 'approved',
    decidedBy: value.decidedBy,
  });
}

function profileGovernanceComposition(
  value: ProjectProfileRevisionCandidate,
): ProjectProfileGovernanceComposition {
  return deepFreeze({
    revisionId: value.revisionId,
    charterRevisionId: value.charterRevisionId,
    compiledDigest: value.compiledDigest,
    overlayDigest: value.overlayDigest,
    packs: value.packRefs.map(copyPackRef),
    tools: value.compiledProfile.tools.map(semanticCompositionRef),
    skills: value.compiledProfile.skills.map(semanticCompositionRef),
    agents: value.compiledProfile.agents.map(semanticCompositionRef),
    workflows: value.compiledProfile.workflows.map(semanticCompositionRef),
    memories: value.compiledProfile.memories.map(semanticCompositionRef),
    glossaries: value.compiledProfile.glossaries.map(semanticCompositionRef),
    acceptancePolicies: (value.compiledProfile.acceptancePolicies ?? []).map(value => ({
      id: value.id,
      digest: value.digest,
      semanticDigest: digest(value),
    })),
  });
}

function semanticCapabilityDiff(
  current: readonly ProfileCompositionCapabilityRef[],
  candidate: readonly ProfileCompositionCapabilityRef[],
): ProfileSemanticCapabilityDiff {
  const currentById = new Map(current.map(value => [value.id, value.semanticDigest]));
  const candidateById = new Map(candidate.map(value => [value.id, value.semanticDigest]));
  const added = [...candidateById.keys()].filter(id => !currentById.has(id)).sort();
  const removed = [...currentById.keys()].filter(id => !candidateById.has(id)).sort();
  const changed = [...candidateById.entries()]
    .filter(([id, itemDigest]) => currentById.has(id) && currentById.get(id) !== itemDigest)
    .map(([id]) => id)
    .sort();
  return deepFreeze({
    added,
    removed,
    changed,
    authorityExpansion: added.length > 0 || changed.length > 0,
  });
}

function packSemanticRef(value: CapabilityPackRef): ProfileCompositionCapabilityRef {
  return {
    id: `${value.id}@${value.version}`,
    digest: value.digest,
    semanticDigest: digest(value),
  };
}

function semanticCompositionRef(
  value: Readonly<{ id: string; digest: string }>,
): ProfileCompositionCapabilityRef {
  return { id: value.id, digest: value.digest, semanticDigest: digest(value) };
}

function copyCompositionRef(value: ProfileCompositionCapabilityRef): ProfileCompositionCapabilityRef {
  return { id: value.id, digest: value.digest, semanticDigest: value.semanticDigest };
}

function copyGovernanceComposition(
  value: ProjectProfileGovernanceComposition,
): ProjectProfileGovernanceComposition {
  return deepFreeze({
    revisionId: value.revisionId,
    charterRevisionId: value.charterRevisionId,
    compiledDigest: value.compiledDigest,
    overlayDigest: value.overlayDigest,
    packs: value.packs.map(copyPackRef),
    tools: value.tools.map(copyCompositionRef),
    skills: value.skills.map(copyCompositionRef),
    agents: value.agents.map(copyCompositionRef),
    workflows: value.workflows.map(copyCompositionRef),
    memories: value.memories.map(copyCompositionRef),
    glossaries: value.glossaries.map(copyCompositionRef),
    acceptancePolicies: value.acceptancePolicies.map(copyCompositionRef),
  });
}

function copySemanticCapabilityDiff(
  value: ProfileSemanticCapabilityDiff,
): ProfileSemanticCapabilityDiff {
  return deepFreeze({
    added: [...value.added],
    removed: [...value.removed],
    changed: [...value.changed],
    authorityExpansion: value.authorityExpansion,
  });
}

function copySemanticDiff(value: ProjectProfileSemanticDiff): ProjectProfileSemanticDiff {
  return deepFreeze({
    bootstrap: value.bootstrap,
    charter: {
      changed: value.charter.changed,
      authorityExpansion: value.charter.authorityExpansion,
    },
    tool: copySemanticCapabilityDiff(value.tool),
    skill: copySemanticCapabilityDiff(value.skill),
    agent: copySemanticCapabilityDiff(value.agent),
    workflow: copySemanticCapabilityDiff(value.workflow),
    memory: copySemanticCapabilityDiff(value.memory),
    glossary: copySemanticCapabilityDiff(value.glossary),
    acceptancePolicy: copySemanticCapabilityDiff(value.acceptancePolicy),
    policy: copySemanticCapabilityDiff(value.policy),
    overlay: {
      changed: value.overlay.changed,
      authorityExpansion: value.overlay.authorityExpansion,
    },
    authorityExpansion: value.authorityExpansion,
  });
}

function copyCompiledProfile(value: CompiledWorkroomProfile): CompiledWorkroomProfile {
  return deepFreeze({
    revisionId: value.revisionId,
    projectId: value.projectId,
    charterRevisionId: value.charterRevisionId,
    packRefs: value.packRefs.map(copyPackRef),
    tools: value.tools.map(tool => ({ id: tool.id, digest: tool.digest })),
    skills: value.skills.map(skill => ({
      id: skill.id,
      digest: skill.digest,
      requiresTools: [...skill.requiresTools],
    })),
    agents: value.agents.map(agent => ({
      id: agent.id,
      digest: agent.digest,
      role: agent.role,
      allowedTools: [...agent.allowedTools],
      allowedSkills: [...agent.allowedSkills],
    })),
    workflows: value.workflows.map(workflow => ({
      id: workflow.id,
      digest: workflow.digest,
      requiredByProfile: workflow.requiredByProfile,
      tasks: workflow.tasks.map(task => ({
        key: task.key,
        role: task.role,
        requires: {
          tools: [...(task.requires.tools ?? [])],
          skills: [...(task.requires.skills ?? [])],
        },
      })),
    })),
    memories: value.memories.map(memory => ({
      id: memory.id,
      digest: memory.digest,
      allowedRoles: [...memory.allowedRoles],
      taskKeys: [...memory.taskKeys],
    })),
    glossaries: value.glossaries.map(glossary => ({
      id: glossary.id,
      digest: glossary.digest,
      allowedRoles: [...glossary.allowedRoles],
      taskKeys: [...glossary.taskKeys],
    })),
    acceptancePolicies: (value.acceptancePolicies ?? []).map(policy => ({
      id: policy.id,
      digest: policy.digest,
      tasks: policy.tasks.map(task => ({
        taskKey: task.taskKey,
        kind: task.kind,
        criteria: task.criteria.map(criterion => ({ ...criterion })),
        requiredEvidence: [...task.requiredEvidence],
        minimumRoute: task.minimumRoute,
        reviewerPrincipalId: task.reviewerPrincipalId,
        sponsorPrincipalId: task.sponsorPrincipalId,
        reviewerTimeoutMs: task.reviewerTimeoutMs,
        sponsorTimeoutMs: task.sponsorTimeoutMs,
      })),
      memorySchema: {
        revision: policy.memorySchema.revision,
        claimRules: policy.memorySchema.claimRules.map(rule => ({
          key: rule.key,
          valueType: rule.valueType,
          allowedStatuses: [...rule.allowedStatuses],
          allowSupersedes: rule.allowSupersedes,
        })),
      },
    })),
    digest: value.digest,
  });
}

function copyPackRef(value: CapabilityPackRef): CapabilityPackRef {
  return { id: value.id, version: value.version, digest: value.digest };
}

function copyActive(value: ActiveProjectProfile): ActiveProjectProfile {
  return deepFreeze({
    revisionId: value.revisionId,
    compiledDigest: value.compiledDigest,
    activatedAtRegistryRevision: value.activatedAtRegistryRevision,
  });
}

function copyPin(value: WorkroomRunProfilePin): WorkroomRunProfilePin {
  return deepFreeze({
    projectId: value.projectId,
    runId: value.runId,
    profileRevisionId: value.profileRevisionId,
    profileDigest: value.profileDigest,
    activationRegistryRevision: value.activationRegistryRevision,
    pinnedAtRegistryRevision: value.pinnedAtRegistryRevision,
  });
}

function copyDraft(value: ProjectProfileEventDraft): ProjectProfileEventDraft {
  if (value.type === 'profile.revision_registered') {
    return { type: value.type, payload: { revision: copyRevision(value.payload.revision) } };
  }
  if (value.type === 'profile.revision_activated') {
    return { type: value.type, payload: copyActive(value.payload) };
  }
  return { type: value.type, payload: copyPin(value.payload) };
}

function profileComposition(value: CompiledWorkroomProfile): string {
  const { revisionId: _revisionId, digest: _digest, ...composition } = value;
  return stableJson(composition);
}
