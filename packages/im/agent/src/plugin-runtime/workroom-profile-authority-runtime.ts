import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import {
  DurableFileStore,
  nodeDurableFileSystem,
  type DurableFileSystem,
} from '../workroom/durable-file-store.js';
import {
  compileWorkroomProfile,
  type CapabilityDefinition,
  type CapabilityPack,
  type CapabilityPackRef,
  type GenerationCapabilitySupply,
  type ProfileAcceptancePolicyDefinition,
} from '../workroom/profile-compiler.js';
import {
  ProjectProfileRegistry,
  type ProfileRevisionSource,
  type ProfileGovernanceDecision,
  type ProjectProfileGovernanceAuthorizationDecision,
  type ProjectProfileGovernanceAuthorizationInput,
  type ProjectProfileJournal,
  type ProjectProfileRegistrySnapshot,
  type WorkroomRunProfilePin,
} from '../workroom/profile-registry.js';
import {
  createWorkroomDynamicPlanningPolicyAuthority,
  createWorkroomDynamicPlanningPolicySnapshot,
  type WorkroomDynamicPlanningGenerationSnapshot,
  type WorkroomDynamicPlanningPolicyAuthority,
  type WorkroomDynamicPlanningPolicyPort,
  type WorkroomDynamicPlanningPolicyRequest,
} from './workroom-dynamic-planning-provider.js';
import type { DynamicWorkflowPlanningPolicySnapshot } from '../workroom/dynamic-workflow-planner.js';
import { createWorkroomSchedulerPolicySnapshot } from '../workroom/workroom-scheduler.js';

export type CapabilityPackManifestInput = Omit<CapabilityPack, 'digest'>;

export function createCapabilityPackManifest(input: CapabilityPackManifestInput): CapabilityPack {
  assertKeys(input, [
    'id', 'version', 'kind', 'requires', 'tools', 'skills', 'agents', 'workflows', 'memories', 'glossaries',
    'acceptancePolicies',
  ], 'Pack');
  text(input.id, 'Pack id');
  text(input.version, 'Pack version');
  if (!['domain', 'competency', 'integration', 'policy'].includes(input.kind)) {
    throw new Error('Capability Pack kind is invalid');
  }
  const body = deepFreeze({
    id: input.id,
    version: input.version,
    kind: input.kind,
    ...(input.requires ? { requires: sortPackRefs(input.requires) } : {}),
    ...(input.tools ? { tools: sortDefinitions(input.tools) } : {}),
    ...(input.skills ? { skills: [...input.skills].map(value => ({
      id: requiredText(value.id, 'Skill id'),
      digest: requiredDigest(value.digest, 'Skill digest'),
      requiresTools: unique(value.requiresTools, 'Skill Tool requirement'),
    })).sort(byId) } : {}),
    ...(input.agents ? { agents: [...input.agents].map(value => ({
      id: requiredText(value.id, 'Agent id'),
      digest: requiredDigest(value.digest, 'Agent digest'),
      role: requiredText(value.role, 'Agent role'),
      allowedTools: unique(value.allowedTools, 'Agent Tool ceiling'),
      allowedSkills: unique(value.allowedSkills, 'Agent Skill ceiling'),
    })).sort(byId) } : {}),
    ...(input.workflows ? { workflows: [...input.workflows].map(value => ({
      id: requiredText(value.id, 'Workflow id'),
      digest: requiredDigest(value.digest, 'Workflow digest'),
      requiredByProfile: value.requiredByProfile === true,
      tasks: [...value.tasks].map(task => ({
        key: requiredText(task.key, 'Workflow Task key'),
        role: requiredText(task.role, 'Workflow Task role'),
        requires: {
          ...(task.requires.tools ? { tools: unique(task.requires.tools, 'Workflow Tool requirement') } : {}),
          ...(task.requires.skills ? { skills: unique(task.requires.skills, 'Workflow Skill requirement') } : {}),
        },
      })).sort((left, right) => compareCanonicalWorkroomText(left.key, right.key)),
    })).sort(byId) } : {}),
    ...(input.memories ? { memories: sortKnowledgeDefinitions(input.memories, 'Memory') } : {}),
    ...(input.glossaries ? { glossaries: sortKnowledgeDefinitions(input.glossaries, 'Glossary') } : {}),
    ...(input.acceptancePolicies
      ? { acceptancePolicies: [...input.acceptancePolicies].map(canonicalAcceptancePolicy).sort(byId) }
      : {}),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface WorkroomProfileOverlayInput {
  readonly version: 1;
  readonly projectId: string;
  readonly revisionId: string;
  readonly charterRevisionId: string;
  readonly parentRevisionId?: string;
  readonly packs: readonly CapabilityPackRef[];
  readonly enabledTools: readonly string[];
  readonly enabledSkills: readonly string[];
  readonly enabledAgents: readonly string[];
  readonly enabledWorkflows: readonly string[];
  readonly enabledMemories?: readonly string[];
  readonly enabledGlossaries?: readonly string[];
  readonly enabledAcceptancePolicies?: readonly string[];
}

export interface WorkroomProfileOverlay extends WorkroomProfileOverlayInput {
  readonly digest: string;
}

export function createWorkroomProfileOverlay(input: WorkroomProfileOverlayInput): WorkroomProfileOverlay {
  assertKeys(input, [
    'version', 'projectId', 'revisionId', 'charterRevisionId', 'parentRevisionId', 'packs',
    'enabledTools', 'enabledSkills', 'enabledAgents', 'enabledWorkflows', 'enabledMemories', 'enabledGlossaries',
    'enabledAcceptancePolicies',
  ], 'Profile Overlay');
  if (input.version !== 1) throw new Error('Profile Overlay version is invalid');
  const body = deepFreeze({
    version: 1 as const,
    projectId: requiredText(input.projectId, 'Overlay projectId'),
    revisionId: requiredText(input.revisionId, 'Overlay revisionId'),
    charterRevisionId: requiredText(input.charterRevisionId, 'Overlay charterRevisionId'),
    ...(input.parentRevisionId
      ? { parentRevisionId: requiredText(input.parentRevisionId, 'Overlay parentRevisionId') }
      : {}),
    packs: sortPackRefs(input.packs),
    enabledTools: unique(input.enabledTools, 'Overlay enabled Tool'),
    enabledSkills: unique(input.enabledSkills, 'Overlay enabled Skill'),
    enabledAgents: unique(input.enabledAgents, 'Overlay enabled Agent'),
    enabledWorkflows: unique(input.enabledWorkflows, 'Overlay enabled Workflow'),
    enabledMemories: unique(input.enabledMemories ?? [], 'Overlay enabled Memory'),
    enabledGlossaries: unique(input.enabledGlossaries ?? [], 'Overlay enabled Glossary'),
    enabledAcceptancePolicies: unique(
      input.enabledAcceptancePolicies ?? [],
      'Overlay enabled Acceptance Policy',
    ),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export type WorkroomProfileAuthorityAction =
  | 'publish_pack'
  | 'publish_profile'
  | 'publish_profile_rollback'
  | 'publish_planning_policy';

export interface WorkroomProfileAuthorityRequestInput {
  readonly version: 1;
  readonly action: WorkroomProfileAuthorityAction;
  readonly operationId: string;
  readonly authenticatedPrincipalId: string;
  readonly candidateDigest: string;
  readonly currentDigest?: string;
  readonly projectId?: string;
}

export interface WorkroomProfileAuthorityRequest extends WorkroomProfileAuthorityRequestInput {
  readonly digest: string;
}

export interface WorkroomProfileAuthorityDecision {
  readonly approved: true;
  readonly requestDigest: string;
  readonly decisionId: string;
  readonly decidedBy: string;
  readonly authorizedBy: 'trusted_pack_publisher' | 'sponsor';
  readonly decidedAt: number;
}

export type WorkroomProfileAuthorityResult = WorkroomProfileAuthorityDecision
  | Readonly<{ approved: false; requestDigest: string; reason: string }>;

/** Trusted Root authority. Commands never carry their own approval or Sponsor snapshot. */
export interface WorkroomProfilePublisherAuthorityPort {
  authorize(request: WorkroomProfileAuthorityRequest): Promise<WorkroomProfileAuthorityResult>;
  verify(
    request: WorkroomProfileAuthorityRequest,
    decision: WorkroomProfileAuthorityDecision,
  ): Promise<boolean>;
}

export interface CapabilityPackPublication {
  readonly version: 1;
  readonly pack: CapabilityPack;
  readonly authorityRequest: WorkroomProfileAuthorityRequest;
  readonly governance: WorkroomProfileAuthorityDecision;
  readonly digest: string;
}

export interface WorkroomPlanningPolicyRevision {
  readonly version: 1;
  readonly revision: number;
  readonly previousDigest?: string;
  readonly projectId: string;
  readonly catalogRevision: string;
  readonly projectDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly policy: DynamicWorkflowPlanningPolicySnapshot;
  readonly authorityRequest: WorkroomProfileAuthorityRequest;
  readonly governance: WorkroomProfileAuthorityDecision;
  readonly digest: string;
}

export interface ProjectProfilePublicationProof {
  readonly version: 1;
  readonly projectId: string;
  readonly revisionId: string;
  readonly governanceInput: ProjectProfileGovernanceAuthorizationInput;
  readonly authorityRequest: WorkroomProfileAuthorityRequest;
  readonly governance: WorkroomProfileAuthorityDecision;
  readonly digest: string;
}

export interface WorkroomProfileAuthorityRepository {
  readPack(ref: CapabilityPackRef): Promise<CapabilityPackPublication | undefined>;
  publishPack(publication: CapabilityPackPublication): Promise<CapabilityPackPublication>;
  readOverlay(projectId: string, revisionId: string): Promise<WorkroomProfileOverlay | undefined>;
  publishOverlay(overlay: WorkroomProfileOverlay): Promise<WorkroomProfileOverlay>;
  readProfileProof(projectId: string, revisionId: string): Promise<ProjectProfilePublicationProof | undefined>;
  publishProfileProof(proof: ProjectProfilePublicationProof): Promise<ProjectProfilePublicationProof>;
  readPlanningPolicy(projectId: string, profileRevisionId: string): Promise<WorkroomPlanningPolicyRevision | undefined>;
  appendPlanningPolicy(revision: WorkroomPlanningPolicyRevision): Promise<WorkroomPlanningPolicyRevision>;
}

/** Crash-durable File tracer. Parent `.zhin` must already exist. */
export class FileWorkroomProfileAuthorityRepository implements WorkroomProfileAuthorityRepository {
  readonly #root: DurableFileStore;
  readonly #packs: DurableFileStore;
  readonly #overlays: DurableFileStore;
  readonly #profileProofs: DurableFileStore;
  readonly #policies: DurableFileStore;
  #ready?: Promise<void>;

  constructor(
    readonly directory: string,
    readonly verification?: Pick<WorkroomProfilePublisherAuthorityPort, 'verify'>,
    fileSystem: DurableFileSystem = nodeDurableFileSystem,
  ) {
    this.#root = new DurableFileStore(directory, fileSystem);
    this.#packs = new DurableFileStore(join(directory, 'packs'), fileSystem);
    this.#overlays = new DurableFileStore(join(directory, 'overlays'), fileSystem);
    this.#profileProofs = new DurableFileStore(join(directory, 'profile-proofs'), fileSystem);
    this.#policies = new DurableFileStore(join(directory, 'planning-policies'), fileSystem);
  }

  async readPack(ref: CapabilityPackRef): Promise<CapabilityPackPublication | undefined> {
    assertPackRef(ref);
    const record = await readOptional(join(this.#packs.directory, `${keyHash(`${ref.id}@${ref.version}`)}.json`),
      parsePackPublication);
    if (!record || record.pack.digest !== ref.digest) return undefined;
    await this.#verify(record.authorityRequest, record.governance);
    return record;
  }

  async publishPack(publication: CapabilityPackPublication): Promise<CapabilityPackPublication> {
    const canonical = canonicalPackPublication(publication);
    await this.#verify(canonical.authorityRequest, canonical.governance);
    await this.#ensureReady();
    const target = join(this.#packs.directory, `${keyHash(`${canonical.pack.id}@${canonical.pack.version}`)}.json`);
    const result = await this.#packs.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const winner = await readRequired(target, parsePackPublication);
        if (canonicalWorkroomJson(winner.pack) !== canonicalWorkroomJson(canonical.pack)) {
          throw new Error(`Capability Pack ${canonical.pack.id}@${canonical.pack.version} identity payload drift`);
        }
        return winner;
      },
    });
    await this.#verify(result.value.authorityRequest, result.value.governance);
    await this.#root.syncLeafAndParent();
    return result.value;
  }

  async readOverlay(projectId: string, revisionId: string): Promise<WorkroomProfileOverlay | undefined> {
    text(projectId, 'Overlay projectId');
    text(revisionId, 'Overlay revisionId');
    return await readOptional(join(this.#overlays.directory, `${keyHash(`${projectId}:${revisionId}`)}.json`),
      parseOverlay);
  }

  async publishOverlay(overlay: WorkroomProfileOverlay): Promise<WorkroomProfileOverlay> {
    const canonical = canonicalOverlay(overlay);
    await this.#ensureReady();
    const target = join(this.#overlays.directory, `${keyHash(`${canonical.projectId}:${canonical.revisionId}`)}.json`);
    const result = await this.#overlays.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const winner = await readRequired(target, parseOverlay);
        if (winner.digest !== canonical.digest) throw new Error('Profile Overlay identity payload drift');
        return winner;
      },
    });
    await this.#root.syncLeafAndParent();
    return result.value;
  }

  async readProfileProof(
    projectId: string,
    revisionId: string,
  ): Promise<ProjectProfilePublicationProof | undefined> {
    text(projectId, 'Profile proof projectId');
    text(revisionId, 'Profile proof revisionId');
    const proof = await readOptional(
      join(this.#profileProofs.directory, `${keyHash(`${projectId}:${revisionId}`)}.json`),
      parseProfileProof,
    );
    if (proof) await this.#verify(proof.authorityRequest, proof.governance);
    return proof;
  }

  async publishProfileProof(proof: ProjectProfilePublicationProof): Promise<ProjectProfilePublicationProof> {
    const canonical = canonicalProfileProof(proof);
    await this.#verify(canonical.authorityRequest, canonical.governance);
    await this.#ensureReady();
    const target = join(
      this.#profileProofs.directory,
      `${keyHash(`${canonical.projectId}:${canonical.revisionId}`)}.json`,
    );
    const result = await this.#profileProofs.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const winner = await readRequired(target, parseProfileProof);
        if (canonicalWorkroomJson(winner) !== canonicalWorkroomJson(canonical)) {
          throw new Error('Project Profile publication proof identity payload drift');
        }
        return winner;
      },
    });
    await this.#verify(result.value.authorityRequest, result.value.governance);
    await this.#root.syncLeafAndParent();
    return result.value;
  }

  async readPlanningPolicy(
    projectId: string,
    profileRevisionId: string,
  ): Promise<WorkroomPlanningPolicyRevision | undefined> {
    text(projectId, 'Planning Policy projectId');
    text(profileRevisionId, 'Planning Policy Profile revisionId');
    const prefix = `${keyHash(`${projectId}:${profileRevisionId}`)}.`;
    let names: readonly string[];
    try {
      names = await readdir(this.#policies.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw error;
    }
    const records = await Promise.all(names.filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .sort().map(name => readRequired(join(this.#policies.directory, name), parsePlanningPolicy)));
    let previous: WorkroomPlanningPolicyRevision | undefined;
    for (const record of records) {
      if (record.projectId !== projectId || record.profileRevisionId !== profileRevisionId
        || record.revision !== (previous?.revision ?? 0) + 1
        || record.previousDigest !== previous?.digest) {
        throw new Error('Planning Policy revision chain is invalid');
      }
      await this.#verify(record.authorityRequest, record.governance);
      previous = record;
    }
    return previous;
  }

  async appendPlanningPolicy(revision: WorkroomPlanningPolicyRevision): Promise<WorkroomPlanningPolicyRevision> {
    const canonical = canonicalPlanningPolicy(revision);
    await this.#verify(canonical.authorityRequest, canonical.governance);
    const current = await this.readPlanningPolicy(canonical.projectId, canonical.profileRevisionId);
    if (canonical.revision !== (current?.revision ?? 0) + 1
      || canonical.previousDigest !== current?.digest) {
      throw new Error('Planning Policy previous digest/revision CAS mismatch');
    }
    await this.#ensureReady();
    const prefix = keyHash(`${canonical.projectId}:${canonical.profileRevisionId}`);
    const target = join(this.#policies.directory,
      `${prefix}.${String(canonical.revision).padStart(16, '0')}.json`);
    const result = await this.#policies.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const winner = await readRequired(target, parsePlanningPolicy);
        if (canonicalWorkroomJson(winner) !== canonicalWorkroomJson(canonical)) {
          throw new Error('Planning Policy revision identity payload drift');
        }
        return winner;
      },
    });
    await this.#verify(result.value.authorityRequest, result.value.governance);
    await this.#root.syncLeafAndParent();
    return result.value;
  }

  #ensureReady(): Promise<void> {
    this.#ready ??= (async () => {
      await this.#root.ensureDurableLeaf('Workroom Profile authority repository');
      await this.#packs.ensureDurableLeaf('Capability Pack publication repository');
      await this.#overlays.ensureDurableLeaf('Project Profile Overlay repository');
      await this.#profileProofs.ensureDurableLeaf('Project Profile publication proof repository');
      await this.#policies.ensureDurableLeaf('Planning Policy repository');
      await this.#root.syncLeafAndParent();
    })();
    return this.#ready;
  }

  async #verify(
    request: WorkroomProfileAuthorityRequest,
    decision: WorkroomProfileAuthorityDecision,
  ): Promise<void> {
    if (!this.verification || !await this.verification.verify(request, decision)) {
      throw new Error('Trusted Workroom Profile publisher authority verification is unavailable or denied');
    }
  }
}

export interface WorkroomProfileGenerationView {
  readonly generation: number;
  readonly digest: string;
  readonly tools: readonly CapabilityDefinition[];
  readonly skills: readonly CapabilityDefinition[];
  readonly agents: readonly CapabilityDefinition[];
}

export interface WorkroomProfileGenerationViewPort {
  withCurrent<TResult>(
    operation: Readonly<{ operationId: string; generation: number; signal: AbortSignal }>,
    use: (view: WorkroomProfileGenerationView) => TResult | Promise<TResult>,
  ): Promise<TResult>;
}

export interface PublishCapabilityPackCommand {
  readonly version: 1;
  readonly operationId: string;
  readonly authenticatedPrincipalId: string;
  readonly pack: CapabilityPackManifestInput;
}

export interface PublishProjectProfileCommand {
  readonly version: 1;
  readonly operationId: string;
  readonly authenticatedPrincipalId: string;
  readonly projectId: string;
  readonly expectedRegistryRevision: number;
  readonly overlay: WorkroomProfileOverlay;
  readonly source: ProfileRevisionSource;
  readonly activate: boolean;
}

export interface PublishProjectProfileRollbackCommand extends PublishProjectProfileCommand {
  readonly restoredFromRevisionId: string;
}

export interface PublishPlanningPolicyCommand {
  readonly version: 1;
  readonly operationId: string;
  readonly authenticatedPrincipalId: string;
  readonly projectId: string;
  readonly catalogRevision: string;
  readonly projectDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly revision: number;
  readonly expectedPreviousDigest?: string;
  readonly policy: DynamicWorkflowPlanningPolicySnapshot;
}

export interface WorkroomProfileControlPort {
  publishPack(command: PublishCapabilityPackCommand, signal: AbortSignal): Promise<CapabilityPackPublication>;
  publishProfile(command: PublishProjectProfileCommand, signal: AbortSignal): Promise<ProjectProfileRegistrySnapshot>;
  publishRollback(
    command: PublishProjectProfileRollbackCommand,
    signal: AbortSignal,
  ): Promise<ProjectProfileRegistrySnapshot>;
  publishPlanningPolicy(
    command: PublishPlanningPolicyCommand,
    signal: AbortSignal,
  ): Promise<WorkroomPlanningPolicyRevision>;
}

export interface WorkroomRunProfilePinRequest {
  readonly version: 1;
  readonly generation: number;
  readonly operationId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly planRevisionId: string;
  readonly planDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly runFactDigest: string;
  readonly expectedRegistryRevision: number;
  readonly digest: string;
}

export interface WorkroomRunProfilePinAuthority {
  readonly requestDigest: string;
  readonly authorityDigest: string;
}

export interface WorkroomRunProfilePinAuthorityPort {
  authorize(request: WorkroomRunProfilePinRequest): Promise<WorkroomRunProfilePinAuthority | undefined>;
  verify(request: WorkroomRunProfilePinRequest, authority: WorkroomRunProfilePinAuthority): Promise<boolean>;
}

export interface WorkroomRunProfilePinPort {
  pin(command: Omit<WorkroomRunProfilePinRequest, 'generation' | 'digest'>, signal: AbortSignal): Promise<WorkroomRunProfilePin>;
}

export interface WorkroomRunProfilePinProof {
  readonly version: 1;
  readonly request: WorkroomRunProfilePinRequest;
  readonly authority: WorkroomRunProfilePinAuthority;
  readonly pin: WorkroomRunProfilePin;
  readonly digest: string;
}

export interface WorkroomRunProfilePinProofRepository {
  read(projectId: string, runId: string): Promise<WorkroomRunProfilePinProof | undefined>;
  publish(proof: WorkroomRunProfilePinProof): Promise<WorkroomRunProfilePinProof>;
}

export class FileWorkroomRunProfilePinProofRepository implements WorkroomRunProfilePinProofRepository {
  readonly #store: DurableFileStore;
  #ready?: Promise<void>;

  constructor(
    readonly directory: string,
    readonly verification?: Pick<WorkroomRunProfilePinAuthorityPort, 'verify'>,
    fileSystem: DurableFileSystem = nodeDurableFileSystem,
  ) {
    this.#store = new DurableFileStore(directory, fileSystem);
  }

  async read(projectId: string, runId: string): Promise<WorkroomRunProfilePinProof | undefined> {
    text(projectId, 'Run pin proof projectId');
    text(runId, 'Run pin proof runId');
    const proof = await readOptional(
      join(this.directory, `${keyHash(`${projectId}:${runId}`)}.json`),
      parseRunPinProof,
    );
    if (proof) await this.#verify(proof);
    return proof;
  }

  async publish(proof: WorkroomRunProfilePinProof): Promise<WorkroomRunProfilePinProof> {
    const canonical = canonicalRunPinProof(proof);
    await this.#verify(canonical);
    await this.#ensureReady();
    const target = join(this.directory, `${keyHash(`${canonical.pin.projectId}:${canonical.pin.runId}`)}.json`);
    const result = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const winner = await readRequired(target, parseRunPinProof);
        if (!sameRunPinAuthorityScope(winner.request, canonical.request)
          || canonicalWorkroomJson(winner.pin) !== canonicalWorkroomJson(canonical.pin)) {
          throw new Error('Workroom Run Profile pin proof identity payload drift');
        }
        return winner;
      },
    });
    await this.#verify(result.value);
    await this.#store.syncLeafAndParent();
    return result.value;
  }

  #ensureReady(): Promise<void> {
    this.#ready ??= this.#store.ensureDurableLeaf('Workroom Run Profile pin proof repository');
    return this.#ready;
  }

  async #verify(proof: WorkroomRunProfilePinProof): Promise<void> {
    if (!this.verification || !await this.verification.verify(proof.request, proof.authority)) {
      throw new Error('Trusted Workroom Run Profile pin proof verification is unavailable or denied');
    }
  }
}

export interface WorkroomProfileAuthorityRuntimeOptions {
  readonly generation: WorkroomDynamicPlanningGenerationSnapshot;
  readonly repository: WorkroomProfileAuthorityRepository;
  readonly profileJournal: ProjectProfileJournal;
  readonly authority: WorkroomProfilePublisherAuthorityPort;
  readonly generationView: WorkroomProfileGenerationViewPort;
  readonly runPinAuthority?: WorkroomRunProfilePinAuthorityPort;
  readonly runPinProofs?: WorkroomRunProfilePinProofRepository;
}

export class WorkroomProfileAuthorityRuntime {
  readonly control: WorkroomProfileControlPort;
  readonly planningPolicy: WorkroomDynamicPlanningPolicyPort;
  readonly runPins: WorkroomRunProfilePinPort;
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;

  constructor(readonly options: WorkroomProfileAuthorityRuntimeOptions) {
    this.control = Object.freeze({
      publishPack: async (command: PublishCapabilityPackCommand, signal: AbortSignal) =>
        await this.#publishPack(command, signal),
      publishProfile: async (command: PublishProjectProfileCommand, signal: AbortSignal) =>
        await this.#publishProfile(command, signal, false),
      publishRollback: async (command: PublishProjectProfileRollbackCommand, signal: AbortSignal) =>
        await this.#publishProfile(command, signal, true),
      publishPlanningPolicy: async (command: PublishPlanningPolicyCommand, signal: AbortSignal) =>
        await this.#publishPolicy(command, signal),
    });
    this.planningPolicy = Object.freeze({
      resolve: async (request: WorkroomDynamicPlanningPolicyRequest) => await this.#resolvePolicy(request),
    });
    this.runPins = Object.freeze({
      pin: async (
        command: Omit<WorkroomRunProfilePinRequest, 'generation' | 'digest'>,
        signal: AbortSignal,
      ) => await this.#pinRun(command, signal),
    });
    this.profiles = Object.freeze({
      read: async (projectId: string) => await this.#readProfiles(projectId),
    });
  }

  async #publishPack(
    command: PublishCapabilityPackCommand,
    signal: AbortSignal,
  ): Promise<CapabilityPackPublication> {
    assertKeys(command, ['version', 'operationId', 'authenticatedPrincipalId', 'pack'], 'Pack command');
    commandHeader(command, signal);
    return await this.options.generationView.withCurrent(this.#operation(command.operationId, signal), async view => {
      assertView(view, this.options.generation.generation);
      const pack = createCapabilityPackManifest(command.pack);
      const existing = await this.options.repository.readPack(pack);
      if (existing) return existing;
      const authorized = await this.#authorize({
        version: 1, action: 'publish_pack', operationId: command.operationId,
        authenticatedPrincipalId: command.authenticatedPrincipalId, candidateDigest: pack.digest,
      }, 'trusted_pack_publisher');
      signal.throwIfAborted();
      const body = deepFreeze({
        version: 1 as const,
        pack,
        authorityRequest: authorized.request,
        governance: authorized.decision,
      });
      return await this.options.repository.publishPack(deepFreeze({ ...body, digest: digest(body) }));
    });
  }

  async #publishProfile(
    command: PublishProjectProfileCommand | PublishProjectProfileRollbackCommand,
    signal: AbortSignal,
    rollback: boolean,
  ): Promise<ProjectProfileRegistrySnapshot> {
    assertKeys(command, [
      'version', 'operationId', 'authenticatedPrincipalId', 'projectId', 'expectedRegistryRevision',
      'overlay', 'source', 'activate', ...(rollback ? ['restoredFromRevisionId'] : []),
    ], rollback ? 'Profile rollback command' : 'Profile command');
    commandHeader(command, signal);
    if (rollback) requiredText(
      (command as PublishProjectProfileRollbackCommand).restoredFromRevisionId,
      'Profile rollback restored revisionId',
    );
    if (command.projectId !== command.overlay.projectId) throw new Error('Profile command Project drift');
    const overlay = canonicalOverlay(command.overlay);
    return await this.options.generationView.withCurrent(this.#operation(command.operationId, signal), async view => {
      assertView(view, this.options.generation.generation);
      const packs = await Promise.all(overlay.packs.map(async ref => {
        const publication = await this.options.repository.readPack(ref);
        if (!publication) throw new Error(`Trusted Capability Pack ${ref.id}@${ref.version} is unavailable`);
        return publication.pack;
      }));
      const compiled = compileWorkroomProfile({
        revision: {
          id: overlay.revisionId,
          projectId: overlay.projectId,
          charterRevisionId: overlay.charterRevisionId,
          packs: overlay.packs,
          enabledTools: overlay.enabledTools,
          enabledSkills: overlay.enabledSkills,
          enabledAgents: overlay.enabledAgents,
          enabledWorkflows: overlay.enabledWorkflows,
          enabledMemories: overlay.enabledMemories,
          enabledGlossaries: overlay.enabledGlossaries,
          enabledAcceptancePolicies: overlay.enabledAcceptancePolicies,
        },
        packs,
        generationSupply: generationSupply(view),
      });
      if (!compiled.ok) {
        throw new Error(`Profile compilation failed: ${compiled.diagnostics.map(value => value.code).join(',')}`);
      }
      const existingState = rollback ? await this.#readProfiles(command.projectId) : undefined;
      const restoredFromRevisionId = rollback
        ? (command as PublishProjectProfileRollbackCommand).restoredFromRevisionId
        : undefined;
      const restored = restoredFromRevisionId
        ? existingState?.revisions[restoredFromRevisionId]
        : undefined;
      if (rollback && !restored) {
        throw new Error(`Restored Profile Revision ${restoredFromRevisionId} not found`);
      }
      await this.options.repository.publishOverlay(overlay);
      const governance = Object.freeze({
        authorize: async (input: ProjectProfileGovernanceAuthorizationInput): Promise<ProjectProfileGovernanceAuthorizationDecision> => {
          const authorized = await this.#authorize({
            version: 1,
            action: rollback ? 'publish_profile_rollback' : 'publish_profile',
            operationId: command.operationId,
            authenticatedPrincipalId: command.authenticatedPrincipalId,
            candidateDigest: digest(input),
            ...(input.currentActive ? { currentDigest: input.currentActive.compiledDigest } : {}),
            projectId: command.projectId,
          }, 'sponsor');
          signal.throwIfAborted();
          const proofBody = deepFreeze({
            version: 1 as const,
            projectId: command.projectId,
            revisionId: overlay.revisionId,
            governanceInput: structuredClone(input),
            authorityRequest: authorized.request,
            governance: authorized.decision,
          });
          await this.options.repository.publishProfileProof(deepFreeze({
            ...proofBody,
            digest: digest(proofBody),
          }));
          return deepFreeze({
            ...structuredClone(input),
            approved: true as const,
            decisionId: authorized.decision.decisionId,
            route: 'sponsor' as const,
            outcome: 'approved' as const,
            decidedBy: authorized.decision.decidedBy,
          });
        },
      });
      const profiles = new ProjectProfileRegistry(this.options.profileJournal, governance);
      const revision = {
        revisionId: overlay.revisionId,
        projectId: overlay.projectId,
        charterRevisionId: overlay.charterRevisionId,
        packRefs: overlay.packs,
        overlayDigest: restored?.overlayDigest ?? overlay.digest,
        compiledDigest: compiled.profile.digest,
        compiledProfile: compiled.profile,
        ...(overlay.parentRevisionId ? { parentRevisionId: overlay.parentRevisionId } : {}),
        ...(restoredFromRevisionId ? { restoredFromRevisionId } : {}),
        source: structuredClone(command.source),
      };
      let state = rollback
        ? await profiles.registerRollback({
            projectId: command.projectId,
            expectedRegistryRevision: command.expectedRegistryRevision,
            restoredFromRevisionId: restoredFromRevisionId!,
            revision,
          })
        : await profiles.registerRevision({
        projectId: command.projectId,
        expectedRegistryRevision: command.expectedRegistryRevision,
        revision,
      });
      if (command.activate) {
        state = await profiles.activateRevision({
          projectId: command.projectId,
          expectedRegistryRevision: state.registryRevision,
          revisionId: overlay.revisionId,
          compiledDigest: compiled.profile.digest,
        });
      }
      return await this.#readProfiles(command.projectId);
    });
  }

  async #publishPolicy(
    command: PublishPlanningPolicyCommand,
    signal: AbortSignal,
  ): Promise<WorkroomPlanningPolicyRevision> {
    assertKeys(command, [
      'version', 'operationId', 'authenticatedPrincipalId', 'projectId', 'catalogRevision',
      'projectDigest', 'profileRevisionId', 'profileDigest', 'revision', 'expectedPreviousDigest', 'policy',
    ], 'Planning Policy command');
    commandHeader(command, signal);
    return await this.options.generationView.withCurrent(this.#operation(command.operationId, signal), async view => {
      assertView(view, this.options.generation.generation);
      const profiles = await this.#readProfiles(command.projectId);
      const profile = profiles.revisions[command.profileRevisionId];
      if (!profile || profile.compiledDigest !== command.profileDigest) {
        throw new Error('Planning Policy Profile binding is unavailable or stale');
      }
      const policy = canonicalPolicy(command.policy);
      const current = await this.options.repository.readPlanningPolicy(command.projectId, command.profileRevisionId);
      if (current?.revision === command.revision) {
        const candidate = planningPolicyCandidate(
          command,
          policy,
          current.authorityRequest,
          current.governance,
        );
        if (canonicalWorkroomJson({ ...current, digest: undefined })
          === canonicalWorkroomJson({ ...candidate, digest: undefined })) return current;
      }
      if (command.revision !== (current?.revision ?? 0) + 1
        || command.expectedPreviousDigest !== current?.digest) {
        throw new Error('Planning Policy previous digest/revision CAS mismatch');
      }
      const candidateBody = planningPolicyBody(command, policy);
      const authorized = await this.#authorize({
        version: 1,
        action: 'publish_planning_policy',
        operationId: command.operationId,
        authenticatedPrincipalId: command.authenticatedPrincipalId,
        candidateDigest: digest(candidateBody),
        ...(current ? { currentDigest: current.digest } : {}),
        projectId: command.projectId,
      }, 'sponsor');
      signal.throwIfAborted();
      const body = deepFreeze({
        ...candidateBody,
        authorityRequest: authorized.request,
        governance: authorized.decision,
      });
      return await this.options.repository.appendPlanningPolicy(deepFreeze({ ...body, digest: digest(body) }));
    });
  }

  async #pinRun(
    command: Omit<WorkroomRunProfilePinRequest, 'generation' | 'digest'>,
    signal: AbortSignal,
  ): Promise<WorkroomRunProfilePin> {
    assertKeys(command, [
      'version', 'operationId', 'projectId', 'runId', 'planRevisionId', 'planDigest',
      'profileRevisionId', 'profileDigest', 'principalId', 'runFactDigest', 'expectedRegistryRevision',
    ], 'Run pin command');
    if (command.version !== 1) throw new Error('Run pin command version is invalid');
    text(command.operationId, 'Run pin operationId');
    text(command.principalId, 'Run pin principalId');
    text(command.projectId, 'Run pin projectId');
    text(command.runId, 'Run pin runId');
    text(command.planRevisionId, 'Run pin Plan revisionId');
    requiredDigest(command.planDigest, 'Run pin Plan digest');
    text(command.profileRevisionId, 'Run pin Profile revisionId');
    requiredDigest(command.profileDigest, 'Run pin Profile digest');
    requiredDigest(command.runFactDigest, 'Run pin fact digest');
    if (!Number.isSafeInteger(command.expectedRegistryRevision)
      || command.expectedRegistryRevision < -1) {
      throw new Error('Run pin expected Registry revision is invalid');
    }
    signal.throwIfAborted();
    const authority = this.options.runPinAuthority;
    const proofs = this.options.runPinProofs;
    if (!authority || !proofs) throw new Error('Workroom Run Profile pin authority/proof repository is unavailable');
    const requestBody = deepFreeze({
      ...structuredClone(command),
      generation: this.options.generation.generation,
    });
    const request = deepFreeze({ ...requestBody, digest: digest(requestBody) });
    const authorized = await authority.authorize(request);
    signal.throwIfAborted();
    if (!authorized || authorized.requestDigest !== request.digest) {
      throw new Error('Workroom Run Profile pin authority exact echo mismatch');
    }
    requiredDigest(authorized.authorityDigest, 'Run pin authority digest');
    const state = await this.#readProfiles(command.projectId);
    const existing = state.runPins[command.runId];
    if (existing) {
      const proof = await proofs.read(command.projectId, command.runId);
      if (!proof || !sameRunPinAuthorityScope(proof.request, request)
        || canonicalWorkroomJson(proof.pin) !== canonicalWorkroomJson(existing)) {
        throw new Error('Workroom Run Profile pin replay proof is unavailable or stale');
      }
      return existing;
    }
    if (!state.active || state.registryRevision !== command.expectedRegistryRevision
      || state.active.revisionId !== command.profileRevisionId
      || state.active.compiledDigest !== command.profileDigest) {
      throw new Error('Workroom Run Profile pin Registry position is stale');
    }
    const expectedPin = deepFreeze({
      projectId: command.projectId,
      runId: command.runId,
      profileRevisionId: command.profileRevisionId,
      profileDigest: command.profileDigest,
      activationRegistryRevision: state.active.activatedAtRegistryRevision,
      pinnedAtRegistryRevision: state.registryRevision + 1,
    });
    const proofBody = deepFreeze({
      version: 1 as const,
      request,
      authority: structuredClone(authorized),
      pin: expectedPin,
    });
    await proofs.publish(deepFreeze({ ...proofBody, digest: digest(proofBody) }));
    const pin = await new ProjectProfileRegistry(this.options.profileJournal).pinRun({
      projectId: command.projectId,
      runId: command.runId,
      expectedRegistryRevision: command.expectedRegistryRevision,
    });
    if (canonicalWorkroomJson(pin) !== canonicalWorkroomJson(expectedPin)) {
      throw new Error('Workroom Run Profile pin drifted from its authority proof');
    }
    return pin;
  }

  async #resolvePolicy(
    request: WorkroomDynamicPlanningPolicyRequest,
  ): Promise<WorkroomDynamicPlanningPolicyAuthority | undefined> {
    if (canonicalWorkroomJson(request.generation) !== canonicalWorkroomJson(this.options.generation)) return undefined;
    const record = await this.options.repository.readPlanningPolicy(request.projectId, request.profile.revisionId);
    if (!record
      || record.catalogRevision !== request.catalogRevision
      || record.projectDigest !== request.projectDigest
      || record.profileDigest !== request.profile.digest) return undefined;
    return createWorkroomDynamicPlanningPolicyAuthority({
      version: 1,
      generation: this.options.generation,
      projectId: record.projectId,
      catalogRevision: record.catalogRevision,
      projectDigest: record.projectDigest,
      profileRevisionId: record.profileRevisionId,
      profileDigest: record.profileDigest,
      policy: record.policy,
    });
  }

  async #readProfiles(projectId: string): Promise<ProjectProfileRegistrySnapshot> {
    const state = await new ProjectProfileRegistry(this.options.profileJournal).read(projectId);
    for (const revision of Object.values(state.revisions)) {
      const proof = await this.options.repository.readProfileProof(projectId, revision.revisionId);
      if (!proof) throw new Error(`Trusted Project Profile proof ${revision.revisionId} is unavailable`);
      const governanceInput = governanceInputFromDecision(revision.governanceDecision);
      if (canonicalWorkroomJson(proof.governanceInput) !== canonicalWorkroomJson(governanceInput)) {
        throw new Error(`Trusted Project Profile proof ${revision.revisionId} drifted from its Registry decision`);
      }
    }
    return state;
  }

  async #authorize(
    input: WorkroomProfileAuthorityRequestInput,
    requiredRole: WorkroomProfileAuthorityDecision['authorizedBy'],
  ): Promise<Readonly<{
    request: WorkroomProfileAuthorityRequest;
    decision: WorkroomProfileAuthorityDecision;
  }>> {
    const request = createRequest(input);
    const result = await this.options.authority.authorize(request);
    if (!result.approved) {
      if (result.requestDigest !== request.digest) throw new Error('Profile authority denial echo mismatch');
      throw new Error(`Profile authority denied: ${result.reason}`);
    }
    if (result.requestDigest !== request.digest
      || result.decidedBy !== request.authenticatedPrincipalId
      || result.authorizedBy !== requiredRole) {
      throw new Error('Profile authority exact decision echo mismatch');
    }
    text(result.decisionId, 'authority decisionId');
    nonNegative(result.decidedAt, 'authority decision timestamp');
    return deepFreeze({ request, decision: structuredClone(result) });
  }

  #operation(operationId: string, signal: AbortSignal) {
    return deepFreeze({ operationId, generation: this.options.generation.generation, signal });
  }
}

function createRequest(input: WorkroomProfileAuthorityRequestInput): WorkroomProfileAuthorityRequest {
  assertKeys(input, [
    'version', 'action', 'operationId', 'authenticatedPrincipalId', 'candidateDigest',
    'currentDigest', 'projectId',
  ], 'Profile publisher authority request');
  if (input.version !== 1
    || !['publish_pack', 'publish_profile', 'publish_profile_rollback', 'publish_planning_policy']
      .includes(input.action)) {
    throw new Error('Profile publisher authority request version/action is invalid');
  }
  text(input.operationId, 'Profile publisher operationId');
  text(input.authenticatedPrincipalId, 'Profile publisher principalId');
  requiredDigest(input.candidateDigest, 'Profile publisher candidate digest');
  if (input.currentDigest !== undefined) {
    requiredDigest(input.currentDigest, 'Profile publisher current digest');
  }
  if (input.projectId !== undefined) text(input.projectId, 'Profile publisher projectId');
  if ((input.action === 'publish_pack') !== (input.projectId === undefined)) {
    throw new Error('Profile publisher authority Project scope is invalid');
  }
  const body = deepFreeze(structuredClone(input));
  return deepFreeze({ ...body, digest: digest(body) });
}

function canonicalPackPublication(value: CapabilityPackPublication): CapabilityPackPublication {
  const { digest: packDigest, ...packInput } = value.pack;
  const pack = createCapabilityPackManifest(packInput);
  if (pack.digest !== packDigest) throw new Error('Capability Pack digest mismatch');
  const authorityRequest = canonicalRequest(value.authorityRequest);
  if (authorityRequest.action !== 'publish_pack'
    || authorityRequest.candidateDigest !== pack.digest
    || authorityRequest.currentDigest !== undefined
    || authorityRequest.projectId !== undefined) {
    throw new Error('Capability Pack publisher authority scope mismatch');
  }
  const governance = canonicalDecision(value.governance, 'trusted_pack_publisher', authorityRequest);
  const body = deepFreeze({ version: 1 as const, pack, authorityRequest, governance });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.version !== 1 || value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Capability Pack publication digest mismatch');
  }
  return canonical;
}

function parsePackPublication(value: unknown): CapabilityPackPublication {
  if (!isRecord(value) || !isRecord(value.pack)
    || !isRecord(value.authorityRequest) || !isRecord(value.governance)) {
    throw new Error('Capability Pack publication is malformed');
  }
  return canonicalPackPublication(value as unknown as CapabilityPackPublication);
}

function canonicalOverlay(value: WorkroomProfileOverlay): WorkroomProfileOverlay {
  const { digest: supplied, ...input } = value;
  const canonical = createWorkroomProfileOverlay(input);
  if (supplied !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Profile Overlay digest mismatch');
  }
  return canonical;
}

function parseOverlay(value: unknown): WorkroomProfileOverlay {
  if (!isRecord(value)) throw new Error('Profile Overlay is malformed');
  return canonicalOverlay(value as unknown as WorkroomProfileOverlay);
}

function canonicalProfileProof(value: ProjectProfilePublicationProof): ProjectProfilePublicationProof {
  if (!isRecord(value.governanceInput)) throw new Error('Project Profile publication proof is malformed');
  const governanceInput = deepFreeze(structuredClone(value.governanceInput));
  const authorityRequest = canonicalRequest(value.authorityRequest);
  const expectedAction = governanceInput.operation === 'register_rollback'
    ? 'publish_profile_rollback'
    : 'publish_profile';
  if (authorityRequest.action !== expectedAction
    || authorityRequest.projectId !== value.projectId
    || authorityRequest.candidateDigest !== digest(governanceInput)
    || authorityRequest.currentDigest !== governanceInput.currentActive?.compiledDigest
    || governanceInput.projectId !== value.projectId
    || governanceInput.revisionId !== value.revisionId) {
    throw new Error('Project Profile Sponsor authority scope mismatch');
  }
  const body = deepFreeze({
    version: 1 as const,
    projectId: requiredText(value.projectId, 'Profile proof projectId'),
    revisionId: requiredText(value.revisionId, 'Profile proof revisionId'),
    governanceInput,
    authorityRequest,
    governance: canonicalDecision(value.governance, 'sponsor', authorityRequest),
  });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.version !== 1 || value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Project Profile publication proof digest mismatch');
  }
  return canonical;
}

function parseProfileProof(value: unknown): ProjectProfilePublicationProof {
  if (!isRecord(value) || !isRecord(value.governanceInput)
    || !isRecord(value.authorityRequest) || !isRecord(value.governance)) {
    throw new Error('Project Profile publication proof is malformed');
  }
  return canonicalProfileProof(value as unknown as ProjectProfilePublicationProof);
}

function governanceInputFromDecision(
  decision: ProfileGovernanceDecision,
): ProjectProfileGovernanceAuthorizationInput {
  const {
    approved: _approved,
    decisionId: _decisionId,
    route: _route,
    outcome: _outcome,
    decidedBy: _decidedBy,
    ...input
  } = structuredClone(decision);
  return deepFreeze(input);
}

function canonicalRunPinProof(value: WorkroomRunProfilePinProof): WorkroomRunProfilePinProof {
  const request = canonicalRunPinRequest(value.request);
  const authority = canonicalRunPinAuthority(value.authority, request);
  const pin = deepFreeze(structuredClone(value.pin));
  text(pin.projectId, 'Run pin proof Project');
  text(pin.runId, 'Run pin proof Run');
  text(pin.profileRevisionId, 'Run pin proof Profile revision');
  requiredDigest(pin.profileDigest, 'Run pin proof Profile digest');
  positive(pin.activationRegistryRevision, 'Run pin proof activation revision');
  positive(pin.pinnedAtRegistryRevision, 'Run pin proof Registry revision');
  if (pin.projectId !== request.projectId || pin.runId !== request.runId) {
    throw new Error('Workroom Run Profile pin proof scope mismatch');
  }
  const body = deepFreeze({ version: 1 as const, request, authority, pin });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.version !== 1 || value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Workroom Run Profile pin proof digest mismatch');
  }
  return canonical;
}

function parseRunPinProof(value: unknown): WorkroomRunProfilePinProof {
  if (!isRecord(value) || !isRecord(value.request)
    || !isRecord(value.authority) || !isRecord(value.pin)) {
    throw new Error('Workroom Run Profile pin proof is malformed');
  }
  return canonicalRunPinProof(value as unknown as WorkroomRunProfilePinProof);
}

function canonicalRunPinRequest(value: WorkroomRunProfilePinRequest): WorkroomRunProfilePinRequest {
  assertKeys(value, [
    'version', 'generation', 'operationId', 'principalId', 'projectId', 'runId',
    'planRevisionId', 'planDigest', 'profileRevisionId', 'profileDigest',
    'runFactDigest', 'expectedRegistryRevision', 'digest',
  ], 'Run pin authority request');
  const { digest: supplied, ...input } = value;
  if (input.version !== 1 || !Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new Error('Run pin authority request version/generation is invalid');
  }
  text(input.operationId, 'Run pin authority operationId');
  text(input.principalId, 'Run pin authority principalId');
  text(input.projectId, 'Run pin authority projectId');
  text(input.runId, 'Run pin authority runId');
  text(input.planRevisionId, 'Run pin authority Plan revisionId');
  requiredDigest(input.planDigest, 'Run pin authority Plan digest');
  text(input.profileRevisionId, 'Run pin authority Profile revisionId');
  requiredDigest(input.profileDigest, 'Run pin authority Profile digest');
  requiredDigest(input.runFactDigest, 'Run pin authority fact digest');
  if (!Number.isSafeInteger(input.expectedRegistryRevision) || input.expectedRegistryRevision < -1) {
    throw new Error('Run pin authority expected Registry revision is invalid');
  }
  const canonical = deepFreeze({ ...structuredClone(input), digest: digest(input) });
  if (supplied !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Run pin authority request digest mismatch');
  }
  return canonical;
}

function canonicalRunPinAuthority(
  value: WorkroomRunProfilePinAuthority,
  request: WorkroomRunProfilePinRequest,
): WorkroomRunProfilePinAuthority {
  assertKeys(value, ['requestDigest', 'authorityDigest'], 'Run pin authority');
  requiredDigest(value.requestDigest, 'Run pin authority request digest');
  requiredDigest(value.authorityDigest, 'Run pin authority digest');
  if (value.requestDigest !== request.digest) throw new Error('Run pin authority exact echo mismatch');
  return deepFreeze(structuredClone(value));
}

function sameRunPinAuthorityScope(
  left: WorkroomRunProfilePinRequest,
  right: WorkroomRunProfilePinRequest,
): boolean {
  const semantic = (value: WorkroomRunProfilePinRequest) => ({
    version: value.version,
    generation: value.generation,
    principalId: value.principalId,
    projectId: value.projectId,
    runId: value.runId,
    planRevisionId: value.planRevisionId,
    planDigest: value.planDigest,
    profileRevisionId: value.profileRevisionId,
    profileDigest: value.profileDigest,
    runFactDigest: value.runFactDigest,
  });
  return canonicalWorkroomJson(semantic(left)) === canonicalWorkroomJson(semantic(right));
}

function planningPolicyBody(command: PublishPlanningPolicyCommand, policy: DynamicWorkflowPlanningPolicySnapshot) {
  return deepFreeze({
    version: 1 as const,
    revision: positive(command.revision, 'Planning Policy revision'),
    ...(command.expectedPreviousDigest
      ? { previousDigest: requiredDigest(command.expectedPreviousDigest, 'Planning Policy previous digest') }
      : {}),
    projectId: requiredText(command.projectId, 'Planning Policy projectId'),
    catalogRevision: requiredText(command.catalogRevision, 'Planning Policy Catalog revision'),
    projectDigest: requiredDigest(command.projectDigest, 'Planning Policy Project digest'),
    profileRevisionId: requiredText(command.profileRevisionId, 'Planning Policy Profile revisionId'),
    profileDigest: requiredDigest(command.profileDigest, 'Planning Policy Profile digest'),
    policy,
  });
}

function planningPolicyCandidate(
  command: PublishPlanningPolicyCommand,
  policy: DynamicWorkflowPlanningPolicySnapshot,
  authorityRequest: WorkroomProfileAuthorityRequest,
  governance: WorkroomProfileAuthorityDecision,
) {
  const body = deepFreeze({ ...planningPolicyBody(command, policy), authorityRequest, governance });
  return deepFreeze({ ...body, digest: digest(body) });
}

function canonicalPlanningPolicy(value: WorkroomPlanningPolicyRevision): WorkroomPlanningPolicyRevision {
  const policy = canonicalPolicy(value.policy);
  const candidateBody = deepFreeze({
    version: 1 as const,
    revision: positive(value.revision, 'Planning Policy revision'),
    ...(value.previousDigest
      ? { previousDigest: requiredDigest(value.previousDigest, 'Planning Policy previous digest') }
      : {}),
    projectId: requiredText(value.projectId, 'Planning Policy projectId'),
    catalogRevision: requiredText(value.catalogRevision, 'Planning Policy Catalog revision'),
    projectDigest: requiredDigest(value.projectDigest, 'Planning Policy Project digest'),
    profileRevisionId: requiredText(value.profileRevisionId, 'Planning Policy Profile revisionId'),
    profileDigest: requiredDigest(value.profileDigest, 'Planning Policy Profile digest'),
    policy,
  });
  const authorityRequest = canonicalRequest(value.authorityRequest);
  if (authorityRequest.action !== 'publish_planning_policy'
    || authorityRequest.projectId !== candidateBody.projectId
    || authorityRequest.candidateDigest !== digest(candidateBody)
    || authorityRequest.currentDigest !== candidateBody.previousDigest) {
    throw new Error('Planning Policy Sponsor authority scope mismatch');
  }
  const body = deepFreeze({
    ...candidateBody,
    authorityRequest,
    governance: canonicalDecision(value.governance, 'sponsor', authorityRequest),
  });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.version !== 1 || value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Planning Policy content digest mismatch');
  }
  return canonical;
}

function parsePlanningPolicy(value: unknown): WorkroomPlanningPolicyRevision {
  if (!isRecord(value) || !isRecord(value.policy)
    || !isRecord(value.authorityRequest) || !isRecord(value.governance)) {
    throw new Error('Planning Policy revision is malformed');
  }
  return canonicalPlanningPolicy(value as unknown as WorkroomPlanningPolicyRevision);
}

function canonicalPolicy(value: DynamicWorkflowPlanningPolicySnapshot): DynamicWorkflowPlanningPolicySnapshot {
  const { digest: supplied, ...input } = value;
  const policy = createWorkroomDynamicPlanningPolicySnapshot(input);
  if (supplied !== policy.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(policy)) {
    throw new Error('Dynamic planning Policy digest mismatch');
  }
  requiredText(policy.revisionId, 'Planning Policy revisionId');
  positive(policy.maxTasks, 'Planning Policy maxTasks');
  positive(policy.maxTotalAttempts, 'Planning Policy maxTotalAttempts');
  positive(policy.maxAttemptsPerTask, 'Planning Policy maxAttemptsPerTask');
  if (policy.maxAttemptsPerTask > policy.maxTotalAttempts || typeof policy.allowOptionalTasks !== 'boolean') {
    throw new Error('Dynamic planning Policy attempt/optional constraint is invalid');
  }
  unique(policy.approvalRequiredAuthorities, 'Planning Policy approval authority');
  requiredText(policy.sponsorGate.owner, 'Planning Policy Sponsor owner');
  positive(policy.sponsorGate.decisionTimeoutMs, 'Planning Policy Sponsor timeout');
  const { digest: schedulerDigest, ...schedulerInput } = policy.schedulerPolicy;
  const scheduler = createWorkroomSchedulerPolicySnapshot(schedulerInput);
  if (schedulerDigest !== scheduler.digest
    || canonicalWorkroomJson(policy.schedulerPolicy) !== canonicalWorkroomJson(scheduler)) {
    throw new Error('Dynamic planning Scheduler Policy digest mismatch');
  }
  if (!['urgent', 'high', 'normal', 'low'].includes(policy.defaultSponsorLane)
    || !['checkpointable', 'atomic'].includes(policy.defaultPreemptibility)) {
    throw new Error('Dynamic planning Policy default scheduling authority is invalid');
  }
  positive(policy.defaultTaskDeadlineMs, 'Planning Policy Task deadline');
  return policy;
}

function canonicalDecision(
  value: WorkroomProfileAuthorityDecision,
  role: WorkroomProfileAuthorityDecision['authorizedBy'],
  request: WorkroomProfileAuthorityRequest,
): WorkroomProfileAuthorityDecision {
  assertKeys(value, [
    'approved', 'requestDigest', 'decisionId', 'decidedBy', 'authorizedBy', 'decidedAt',
  ], 'Profile authority decision');
  if (!value || value.approved !== true || value.authorizedBy !== role) {
    throw new Error('Profile authority decision role is invalid');
  }
  requiredDigest(value.requestDigest, 'authority request digest');
  requiredText(value.decisionId, 'authority decisionId');
  requiredText(value.decidedBy, 'authority principal');
  nonNegative(value.decidedAt, 'authority decision timestamp');
  if (value.requestDigest !== request.digest || value.decidedBy !== request.authenticatedPrincipalId) {
    throw new Error('Profile authority decision exact echo mismatch');
  }
  return deepFreeze(structuredClone(value));
}

function canonicalRequest(value: WorkroomProfileAuthorityRequest): WorkroomProfileAuthorityRequest {
  const { digest: supplied, ...input } = value;
  const canonical = createRequest(input);
  if (supplied !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Profile publisher authority request digest mismatch');
  }
  return canonical;
}

function generationSupply(view: WorkroomProfileGenerationView): GenerationCapabilitySupply {
  return deepFreeze({
    tools: sortDefinitions(view.tools),
    skills: sortDefinitions(view.skills),
    agents: sortDefinitions(view.agents),
  });
}

function assertView(view: WorkroomProfileGenerationView, generation: number): void {
  if (view.generation !== generation) throw new Error('Profile publication generation view is stale');
  requiredDigest(view.digest, 'generation view digest');
}

function commandHeader(
  command: Readonly<{ version: 1; operationId: string; authenticatedPrincipalId: string }>,
  signal: AbortSignal,
): void {
  signal.throwIfAborted();
  if (command.version !== 1) throw new Error('Profile control command version is invalid');
  text(command.operationId, 'control operationId');
  text(command.authenticatedPrincipalId, 'authenticated principalId');
}

function sortPackRefs(values: readonly CapabilityPackRef[]): readonly CapabilityPackRef[] {
  if (!Array.isArray(values)) throw new Error('Capability Pack refs are invalid');
  return deepFreeze(values.map(value => {
    assertPackRef(value);
    return { id: value.id, version: value.version, digest: value.digest };
  }).sort((left, right) => compareCanonicalWorkroomText(`${left.id}@${left.version}#${left.digest}`, `${right.id}@${right.version}#${right.digest}`)));
}

function assertPackRef(value: CapabilityPackRef): void {
  text(value.id, 'Pack ref id');
  text(value.version, 'Pack ref version');
  requiredDigest(value.digest, 'Pack ref digest');
}

function sortDefinitions(values: readonly CapabilityDefinition[]): readonly CapabilityDefinition[] {
  if (!Array.isArray(values)) throw new Error('Capability definitions are invalid');
  return deepFreeze(values.map(value => ({
    id: requiredText(value.id, 'Capability id'),
    digest: requiredDigest(value.digest, 'Capability digest'),
  })).sort(byId));
}

function sortKnowledgeDefinitions(
  values: readonly Readonly<{
    id: string;
    digest: string;
    allowedRoles: readonly string[];
    taskKeys: readonly string[];
  }>[],
  label: 'Memory' | 'Glossary',
) {
  return deepFreeze([...values].map(value => ({
    id: requiredText(value.id, `${label} id`),
    digest: requiredDigest(value.digest, `${label} digest`),
    allowedRoles: unique(value.allowedRoles, `${label} allowed role`),
    taskKeys: unique(value.taskKeys, `${label} Task key`),
  })).sort(byId));
}

function canonicalAcceptancePolicy(
  value: ProfileAcceptancePolicyDefinition,
): ProfileAcceptancePolicyDefinition {
  requiredText(value.id, 'Acceptance Policy id');
  requiredDigest(value.digest, 'Acceptance Policy digest');
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    throw new Error('Acceptance Policy requires Tasks');
  }
  const tasks = [...value.tasks].map(task => {
    if (!['task_result', 'integration_candidate', 'effect_intent'].includes(task.kind)) {
      throw new Error('Acceptance Policy Task kind is invalid');
    }
    if (!['baseline', 'reviewer_required', 'sponsor_required', 'reviewer_then_sponsor']
      .includes(task.minimumRoute)) {
      throw new Error('Acceptance Policy minimum route is invalid');
    }
    if (!Array.isArray(task.criteria) || task.criteria.length === 0) {
      throw new Error('Acceptance Policy Task requires criteria');
    }
    return {
      taskKey: requiredText(task.taskKey, 'Acceptance Policy Task key'),
      kind: task.kind,
      criteria: [...task.criteria].map(criterion => {
        if (!['deterministic', 'judgment'].includes(criterion.kind)) {
          throw new Error('Acceptance criterion kind is invalid');
        }
        return {
          id: requiredText(criterion.id, 'Acceptance criterion id'),
          kind: criterion.kind,
          description: requiredText(criterion.description, 'Acceptance criterion description'),
        };
      }).sort(byId),
      requiredEvidence: unique(task.requiredEvidence, 'Acceptance required Evidence'),
      minimumRoute: task.minimumRoute,
      reviewerPrincipalId: requiredText(task.reviewerPrincipalId, 'Acceptance Reviewer principal'),
      sponsorPrincipalId: requiredText(task.sponsorPrincipalId, 'Acceptance Sponsor principal'),
      reviewerTimeoutMs: positive(task.reviewerTimeoutMs, 'Acceptance Reviewer timeout'),
      sponsorTimeoutMs: positive(task.sponsorTimeoutMs, 'Acceptance Sponsor timeout'),
    };
  }).sort((left, right) => compareCanonicalWorkroomText(left.taskKey, right.taskKey));
  if (new Set(tasks.map(task => task.taskKey)).size !== tasks.length) {
    throw new Error('Acceptance Policy Task keys contain duplicates');
  }
  const memorySchema = value.memorySchema;
  if (!memorySchema || !Array.isArray(memorySchema.claimRules)) {
    throw new Error('Acceptance Memory schema is invalid');
  }
  const claimRules = [...memorySchema.claimRules].map(rule => {
    if (rule.valueType !== 'string' || typeof rule.allowSupersedes !== 'boolean') {
      throw new Error('Acceptance Memory claim rule is invalid');
    }
    const allowedStatuses = unique(rule.allowedStatuses, 'Acceptance Memory claim status');
    if (allowedStatuses.some(status => status !== 'verified' && status !== 'assumed')) {
      throw new Error('Acceptance Memory claim status is invalid');
    }
    return {
      key: requiredText(rule.key, 'Acceptance Memory claim key'),
      valueType: 'string' as const,
      allowedStatuses: allowedStatuses as readonly ('verified' | 'assumed')[],
      allowSupersedes: rule.allowSupersedes,
    };
  }).sort((left, right) => compareCanonicalWorkroomText(left.key, right.key));
  if (new Set(claimRules.map(rule => rule.key)).size !== claimRules.length) {
    throw new Error('Acceptance Memory claim keys contain duplicates');
  }
  return deepFreeze({
    id: value.id,
    digest: value.digest,
    tasks,
    memorySchema: {
      revision: positive(memorySchema.revision, 'Acceptance Memory schema revision'),
      claimRules,
    },
  });
}

function unique(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) throw new Error(`${label} list is invalid`);
  return deepFreeze([...new Set(values.map(value => requiredText(value, label)))].sort());
}

function byId(left: Readonly<{ id: string }>, right: Readonly<{ id: string }>): number {
  return compareCanonicalWorkroomText(left.id, right.id);
}

function assertKeys(value: object, allowed: readonly string[], label: string): void {
  const extras = Object.keys(value).filter(key => !allowed.includes(key));
  if (extras.length > 0) throw new Error(`${label} contains forbidden fields: ${extras.sort().join(',')}`);
}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
}

function requiredText(value: unknown, label: string): string {
  text(value, label);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  text(value, label);
  if (!/^sha256:[a-f\d]{64}$/u.test(value)) throw new Error(`${label} is not a canonical SHA-256 digest`);
  return value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}

function nonNegative(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}

function keyHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readOptional<T>(path: string, parse: (value: unknown) => T): Promise<T | undefined> {
  try {
    return parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

async function readRequired<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const value = await readOptional(path, parse);
  if (!value) throw new Error(`Required Workroom Profile authority record is absent: ${path}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
