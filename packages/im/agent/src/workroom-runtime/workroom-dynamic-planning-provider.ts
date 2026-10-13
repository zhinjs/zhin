import { createHash } from 'node:crypto';
import { createToken } from '@zhin.js/plugin-runtime';
import type {
  DataCategoryRegistrySnapshot,
  DisclosureDecisionInput,
} from '../data-governance/data-governance.js';
import {
  materializeDisclosureManifest,
  type MaterializedDisclosureManifest,
  type PayloadVaultObjectHandle,
  type PayloadVaultPort,
  type TrustedDisclosureTransformPort,
} from '../data-governance/disclosure-manifest.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import { digestWorkroomCatalogProjectBinding } from '../workroom/catalog-definition.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import {
  DynamicWorkflowPlanningPort,
  type DynamicWorkflowPlanningAuthority,
  type DynamicWorkflowPlanningPolicySnapshot,
  type DynamicWorkflowPlanningProfileSnapshot,
  type DynamicWorkflowPlanningRequest,
  type UntrustedWorkflowDagPlannerPort,
} from '../workroom/dynamic-workflow-planner.js';
import {
  WorkroomPlanningClarificationError,
  type HumanIngressPlanningInput,
  type HumanIngressPlanningPort,
} from '../workroom/human-ingress-orchestrator.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';

export interface WorkroomDynamicPlanningGenerationSnapshot {
  readonly version: 1;
  readonly generation: number;
  readonly digest: string;
}

export function createWorkroomDynamicPlanningGenerationSnapshot(
  generation: number,
): WorkroomDynamicPlanningGenerationSnapshot {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('Dynamic planning generation must be a positive safe integer');
  }
  const body = deepFreeze({ version: 1 as const, generation });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface WorkroomPlanningDisclosureRequest {
  readonly version: 1;
  readonly generation: WorkroomDynamicPlanningGenerationSnapshot;
  readonly input: HumanIngressPlanningInput;
  readonly source: WorkroomPlanningDisclosureSourceBinding;
  readonly destinationKind: 'model_provider';
  readonly purpose: 'orchestration';
}

export interface WorkroomPlanningDisclosureSourceBinding {
  readonly ref: string;
  readonly digest: string;
  readonly sequence: number;
  readonly conversationKeyDigest: string;
}

export interface WorkroomPlanningDisclosure {
  readonly version: 1;
  readonly source: WorkroomPlanningDisclosureSourceBinding;
  readonly manifest: MaterializedDisclosureManifest;
  /** Exact UTF-8 body read from the manifest output handle. */
  readonly text: string;
  readonly digest: string;
}

export function createWorkroomPlanningDisclosureSourceBinding(
  source: HumanIngressPlanningInput['source'],
): WorkroomPlanningDisclosureSourceBinding {
  return deepFreeze({
    ref: source.ref,
    digest: source.digest,
    sequence: source.sequence,
    conversationKeyDigest: digest({ conversationKey: source.conversationKey }),
  });
}

export function createWorkroomPlanningDisclosure(input: Readonly<{
  source: WorkroomPlanningDisclosureSourceBinding;
  manifest: MaterializedDisclosureManifest;
  text: string;
}>): WorkroomPlanningDisclosure {
  const body = deepFreeze({
    version: 1 as const,
    source: structuredClone(input.source),
    manifest: structuredClone(input.manifest),
    text: input.text,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

/** P12 authority/materialization boundary. There is deliberately no permissive default. */
export interface WorkroomPlanningDisclosurePort {
  materialize(
    input: WorkroomPlanningDisclosureRequest,
    signal: AbortSignal,
  ): WorkroomPlanningDisclosure | Promise<WorkroomPlanningDisclosure>;
}

export const workroomPlanningDisclosureToken = createToken<WorkroomPlanningDisclosurePort>(
  'zhin.agent.workroom-planning-disclosure',
  'P12 governed source disclosure for dynamic Workroom planning',
);

export interface WorkroomPlanningDisclosureAuthorityInput {
  readonly version: 1;
  readonly decisionInput: DisclosureDecisionInput;
  readonly categoryRegistry: DataCategoryRegistrySnapshot;
  readonly source: PayloadVaultObjectHandle;
  /** Exact canonical ingress event whose Vault object/descriptor was classified. */
  readonly sourceEvent: WorkroomPlanningDisclosureSourceBinding;
}

export interface WorkroomPlanningDisclosureAuthority
extends WorkroomPlanningDisclosureAuthorityInput {
  /** Binds Descriptor/Vault handle and canonical ingress lineage as one authority. */
  readonly digest: string;
}

export function createWorkroomPlanningDisclosureAuthority(
  input: WorkroomPlanningDisclosureAuthorityInput,
): WorkroomPlanningDisclosureAuthority {
  const body = deepFreeze(structuredClone(input));
  return deepFreeze({ ...body, digest: digest(body) });
}

/**
 * Concrete adapter over P12's decision + materialized manifest seam. The model
 * body is read only from the governed output handle, never from source.text.
 */
export function createMaterializedWorkroomPlanningDisclosurePort(options: Readonly<{
  resolveAuthority(
    input: WorkroomPlanningDisclosureRequest,
  ): WorkroomPlanningDisclosureAuthority | undefined | Promise<WorkroomPlanningDisclosureAuthority | undefined>;
  vault: PayloadVaultPort;
  transforms?: TrustedDisclosureTransformPort;
}>): WorkroomPlanningDisclosurePort {
  return Object.freeze({
    async materialize(
      input: WorkroomPlanningDisclosureRequest,
      signal: AbortSignal,
    ): Promise<WorkroomPlanningDisclosure> {
      const authority = await options.resolveAuthority(input);
      if (!authority) {
        throw new WorkroomPlanningClarificationError('planning_disclosure_unavailable');
      }
      if (!authority.decisionInput?.policy
        || !authority.decisionInput?.context?.destination) {
        throw new WorkroomPlanningClarificationError('planning_disclosure_unavailable');
      }
      const { digest: authorityDigest, ...authorityBody } = authority;
      const expectedAuthority = createWorkroomPlanningDisclosureAuthority(authorityBody);
      if (authorityDigest !== expectedAuthority.digest
        || canonicalWorkroomJson(authority) !== canonicalWorkroomJson(expectedAuthority)) {
        throw new Error('Planning disclosure authority digest does not bind Vault/Descriptor/source lineage');
      }
      if (canonicalWorkroomJson(authority.sourceEvent) !== canonicalWorkroomJson(input.source)) {
        throw new Error('Planning disclosure Vault authority targets another canonical source event');
      }
      if (authority.decisionInput.policy.projectId !== input.input.projectId
        || authority.decisionInput.context.principal.projectId !== input.input.projectId
        || authority.decisionInput.context.principal.principalId !== input.input.principalId
        || authority.decisionInput.context.channel !== 'model_provider'
        || authority.decisionInput.context.purpose !== 'orchestration') {
        throw new Error('Planning disclosure authority is outside the exact Project/principal/purpose scope');
      }
      const manifest = await materializeDisclosureManifest({
        ...authority,
        vault: options.vault,
        ...(options.transforms ? { transforms: options.transforms } : {}),
        signal,
      });
      if (manifest.source.handle.projectId !== input.input.projectId
        || manifest.output.handle.projectId !== input.input.projectId
        || manifest.principal.principalId !== input.input.principalId
        || manifest.channel !== 'model_provider'
        || manifest.purpose !== 'orchestration') {
        throw new Error('Materialized planning Disclosure Manifest drifted from the exact operation scope');
      }
      const payload = await options.vault.readExact(deepFreeze({
        handle: structuredClone(manifest.output.handle),
        requestDigest: manifest.requestDigest,
        purpose: manifest.purpose,
        principalId: manifest.principal.principalId,
        destinationId: manifest.destination.id,
      }), signal);
      const payloadHash = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
      if (payloadHash !== manifest.output.payloadHash) {
        throw new Error('Planning Disclosure Manifest output body hash mismatch');
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
      } catch (error) {
        throw new Error('Planning Disclosure Manifest output is not valid UTF-8 text', { cause: error });
      }
      return createWorkroomPlanningDisclosure({ source: input.source, manifest, text });
    },
  });
}

export interface WorkroomStructuredDagModelInput {
  readonly version: 1;
  /** Used by the trusted adapter to select a pinned binding; omit from the model prompt. */
  readonly binding: Readonly<{
    agentDefinitionId: string;
    generation: number;
  }>;
  /** This is the complete model-visible value. */
  readonly prompt: Readonly<{
    objective: string;
    disclosure: Readonly<{ manifestId: string; manifestDigest: string; expiresAt: number }>;
    strategies: DynamicWorkflowPlanningAuthority['profile']['strategies'];
    roles: readonly string[];
    capabilities: DynamicWorkflowPlanningAuthority['profile']['capabilities'];
    constraints: Readonly<{
      maxTasks: number;
      maxTotalAttempts: number;
      maxAttemptsPerTask: number;
      allowOptionalTasks: boolean;
    }>;
  }>;
}

/** Narrow model port. Its return value remains wholly untrusted. */
export interface WorkroomStructuredDagModelPort {
  generate(input: WorkroomStructuredDagModelInput, signal: AbortSignal): unknown | Promise<unknown>;
}

export interface WorkroomDynamicPlanningPolicyAuthorityInput {
  readonly version: 1;
  readonly generation: WorkroomDynamicPlanningGenerationSnapshot;
  readonly projectId: string;
  readonly catalogRevision: string;
  readonly projectDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly policy: DynamicWorkflowPlanningPolicySnapshot;
}

export type WorkroomDynamicPlanningPolicySnapshotInput = Omit<
DynamicWorkflowPlanningPolicySnapshot,
'digest'
>;

export function createWorkroomDynamicPlanningPolicySnapshot(
  input: WorkroomDynamicPlanningPolicySnapshotInput,
): DynamicWorkflowPlanningPolicySnapshot {
  const body = deepFreeze(structuredClone(input));
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface WorkroomDynamicPlanningPolicyAuthority
extends WorkroomDynamicPlanningPolicyAuthorityInput {
  readonly digest: string;
}

export function createWorkroomDynamicPlanningPolicyAuthority(
  input: WorkroomDynamicPlanningPolicyAuthorityInput,
): WorkroomDynamicPlanningPolicyAuthority {
  const { digest: suppliedPolicyDigest, ...policyBody } = input.policy;
  const policy = createWorkroomDynamicPlanningPolicySnapshot(policyBody);
  if (suppliedPolicyDigest !== policy.digest) {
    throw new Error('Dynamic planning Policy digest does not cover its canonical persistent content');
  }
  const body = deepFreeze({ ...structuredClone(input), policy });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface WorkroomDynamicPlanningPolicyRequest {
  readonly version: 1;
  readonly generation: WorkroomDynamicPlanningGenerationSnapshot;
  readonly projectId: string;
  readonly catalogRevision: string;
  readonly projectDigest: string;
  readonly profile: DynamicWorkflowPlanningProfileSnapshot;
}

/** Persistent Project/Profile policy projection. There is deliberately no baseline default. */
export interface WorkroomDynamicPlanningPolicyPort {
  resolve(
    input: WorkroomDynamicPlanningPolicyRequest,
  ): WorkroomDynamicPlanningPolicyAuthority | undefined
    | Promise<WorkroomDynamicPlanningPolicyAuthority | undefined>;
}

export const workroomDynamicPlanningPolicyToken = createToken<WorkroomDynamicPlanningPolicyPort>(
  'zhin.agent.workroom-dynamic-planning-policy',
  'Exact persistent Project/Profile dynamic planning and Scheduler policy projection',
);

export interface GenerationOwnedDynamicPlanningProviderOptions {
  readonly generation: WorkroomDynamicPlanningGenerationSnapshot;
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly resolvePolicy: () => WorkroomDynamicPlanningPolicyPort | undefined;
  readonly resolveDisclosure: () => WorkroomPlanningDisclosurePort | undefined;
  readonly model: WorkroomStructuredDagModelPort;
  readonly signal: AbortSignal;
}

/**
 * Production composition for one immutable Root generation. Catalog/Profile
 * authority is re-read for every operation; only disclosed text reaches the
 * model, and DynamicWorkflowPlanningPort re-validates its untrusted candidate.
 */
export function createGenerationOwnedDynamicPlanningProvider(
  options: GenerationOwnedDynamicPlanningProviderOptions,
): HumanIngressPlanningPort {
  const generation = assertGeneration(options.generation);
  return Object.freeze({
    async propose(input: HumanIngressPlanningInput) {
      options.signal.throwIfAborted();
      const authority = await resolvePlanningAuthority(options, generation, input);
      const disclosure = options.resolveDisclosure();
      if (!disclosure) {
        throw new WorkroomPlanningClarificationError('planning_disclosure_unavailable');
      }
      const disclosed = await disclosure.materialize(deepFreeze({
        version: 1 as const,
        generation,
        input: structuredClone(input),
        source: createWorkroomPlanningDisclosureSourceBinding(input.source),
        destinationKind: 'model_provider' as const,
        purpose: 'orchestration' as const,
      }), options.signal);
      assertPlanningDisclosure(disclosed, input);
      const planner: UntrustedWorkflowDagPlannerPort = Object.freeze({
        async propose(request: DynamicWorkflowPlanningRequest) {
          return await options.model.generate(deepFreeze({
            version: 1 as const,
            binding: {
              agentDefinitionId: request.authority.orchestratorAgentDefinitionId,
              generation: generation.generation,
            },
            prompt: {
              objective: request.source.text,
              disclosure: {
                manifestId: disclosed.manifest.id,
                manifestDigest: disclosed.manifest.digest,
                expiresAt: disclosed.manifest.expiresAt,
              },
              strategies: structuredClone(request.authority.profile.strategies),
              roles: [...request.authority.profile.roles],
              capabilities: structuredClone(request.authority.profile.capabilities),
              constraints: {
                maxTasks: request.authority.policy.maxTasks,
                maxTotalAttempts: request.authority.policy.maxTotalAttempts,
                maxAttemptsPerTask: request.authority.policy.maxAttemptsPerTask,
                allowOptionalTasks: request.authority.policy.allowOptionalTasks,
              },
            },
          }), options.signal);
        },
      });
      const governed = new DynamicWorkflowPlanningPort({
        resolveAuthority: async () => authority,
        planner,
      });
      return await governed.propose(deepFreeze({
        ...structuredClone(input),
        source: { ...structuredClone(input.source), text: disclosed.text },
      }));
    },
  });
}

async function resolvePlanningAuthority(
  options: GenerationOwnedDynamicPlanningProviderOptions,
  generation: WorkroomDynamicPlanningGenerationSnapshot,
  input: HumanIngressPlanningInput,
): Promise<DynamicWorkflowPlanningAuthority> {
  const catalog = await options.catalog.read();
  const definition = catalog.definitions[input.projectId];
  if (!definition || definition.enabled === false || !definition.conversation
    || catalog.revision !== input.projectRevision
    || digestWorkroomCatalogProjectBinding(definition) !== input.projectDigest
    || definition.conversation.agent !== input.orchestratorAgentDefinitionId
    || !definition.members.some(member => member.agent === input.orchestratorAgentDefinitionId
      && member.role === 'orchestrator')) {
    throw new WorkroomPlanningClarificationError('planning_unavailable');
  }
  const registry = await options.profiles.read(input.projectId);
  const active = registry.active;
  const revision = active ? registry.revisions[active.revisionId] : undefined;
  const profile = revision?.compiledProfile;
  if (!active || !revision || !profile
    || revision.projectId !== input.projectId
    || profile.projectId !== input.projectId
    || revision.revisionId !== active.revisionId
    || revision.compiledDigest !== active.compiledDigest
    || profile.digest !== active.compiledDigest
    || profile.revisionId !== active.revisionId
    || profile.workflows.length === 0
    || profile.agents.length === 0) {
    throw new WorkroomPlanningClarificationError('planning_unavailable');
  }
  const roles = sortedUnique(profile.agents.map(agent => agent.role));
  const tools = sortedUnique(profile.tools.map(tool => tool.id));
  const skills = sortedUnique(profile.skills.map(skill => skill.id));
  const strategies = Object.freeze(profile.workflows.map(workflow => deepFreeze({
    id: workflow.id,
    version: active.revisionId,
    digest: workflow.digest,
  })).sort((left, right) => compareCanonicalWorkroomText(left.id, right.id)));
  const profileAuthority = deepFreeze<DynamicWorkflowPlanningProfileSnapshot>({
    revisionId: active.revisionId,
    digest: active.compiledDigest,
    strategies,
    roles,
    capabilities: { tools, skills, integrations: [], authorities: [] },
  });
  const policyPort = options.resolvePolicy();
  if (!policyPort) throw new WorkroomPlanningClarificationError('planning_unavailable');
  const policyRequest = deepFreeze<WorkroomDynamicPlanningPolicyRequest>({
    version: 1,
    generation,
    projectId: input.projectId,
    catalogRevision: catalog.revision,
    projectDigest: input.projectDigest,
    profile: profileAuthority,
  });
  const policyAuthority = await policyPort.resolve(policyRequest);
  if (!policyAuthority) throw new WorkroomPlanningClarificationError('planning_unavailable');
  const expectedPolicyAuthority = createWorkroomDynamicPlanningPolicyAuthority({
    version: 1,
    generation,
    projectId: input.projectId,
    catalogRevision: catalog.revision,
    projectDigest: input.projectDigest,
    profileRevisionId: active.revisionId,
    profileDigest: active.compiledDigest,
    policy: policyAuthority.policy,
  });
  if (canonicalWorkroomJson(policyAuthority) !== canonicalWorkroomJson(expectedPolicyAuthority)) {
    throw new Error('Dynamic planning Policy authority drifted from the exact generation/Project/Profile');
  }
  return deepFreeze({
    version: 1 as const,
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    projectDigest: input.projectDigest,
    orchestratorAgentDefinitionId: input.orchestratorAgentDefinitionId,
    orchestratorAuthorityDigest: input.orchestratorAuthorityDigest,
    profile: profileAuthority,
    policy: structuredClone(policyAuthority.policy),
  });
}

function assertGeneration(
  value: WorkroomDynamicPlanningGenerationSnapshot,
): WorkroomDynamicPlanningGenerationSnapshot {
  const expected = createWorkroomDynamicPlanningGenerationSnapshot(value.generation);
  if (canonicalWorkroomJson(value) !== canonicalWorkroomJson(expected)) {
    throw new Error('Dynamic planning generation snapshot digest is invalid');
  }
  return expected;
}

function assertPlanningDisclosure(
  value: WorkroomPlanningDisclosure,
  input: HumanIngressPlanningInput,
): void {
  if (!value || value.version !== 1 || typeof value.text !== 'string' || !value.manifest
    || value.manifest.version !== 1
    || value.manifest.source.handle.projectId !== input.projectId
    || value.manifest.output.handle.projectId !== input.projectId
    || value.manifest.principal.principalId !== input.principalId
    || value.manifest.channel !== 'model_provider'
    || value.manifest.purpose !== 'orchestration'
    || value.manifest.expiresAt <= input.source.event.timestamp) {
    throw new Error('Planning disclosure is outside the exact operation scope');
  }
  const expectedSource = createWorkroomPlanningDisclosureSourceBinding(input.source);
  if (canonicalWorkroomJson(value.source) !== canonicalWorkroomJson(expectedSource)) {
    throw new Error('Planning disclosure targets another canonical source event');
  }
  const { id, digest: manifestDigest, ...projection } = value.manifest;
  const expectedDigest = digest(projection);
  const textHash = `sha256:${createHash('sha256').update(value.text).digest('hex')}`;
  if (manifestDigest !== expectedDigest
    || id !== `disclosure-manifest:${expectedDigest}`
    || value.manifest.output.payloadHash !== textHash
    || value.manifest.output.handle.payloadHash !== textHash) {
    throw new Error('Planning disclosure does not match its materialized Manifest/output body');
  }
  const expectedDisclosure = createWorkroomPlanningDisclosure({
    source: expectedSource,
    manifest: value.manifest,
    text: value.text,
  });
  if (canonicalWorkroomJson(value) !== canonicalWorkroomJson(expectedDisclosure)) {
    throw new Error('Planning disclosure lineage digest does not match its canonical source/Manifest/body');
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => compareCanonicalWorkroomText(left, right)));
}
