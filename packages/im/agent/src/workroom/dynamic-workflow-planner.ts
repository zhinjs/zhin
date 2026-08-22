import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
} from './canonical-value.js';
import type { HumanIngressPlanningInput, HumanIngressPlanningPort } from './human-ingress-orchestrator.js';
import {
  WorkflowPlanBuilder,
  type WorkflowPlanProposal,
  type WorkflowStrategyReference,
  type WorkflowTaskCapabilityRequirement,
} from './workflow-plan-builder.js';
import type {
  WorkroomSchedulerPolicySnapshot,
  WorkroomSponsorLane,
  WorkroomTaskPreemptibility,
} from './workroom-scheduler.js';

export interface DynamicWorkflowPlanningProfileSnapshot {
  readonly revisionId: string;
  readonly digest: string;
  readonly strategies: readonly WorkflowStrategyReference[];
  readonly roles: readonly string[];
  readonly capabilities: Readonly<Required<WorkflowTaskCapabilityRequirement>>;
}

export interface DynamicWorkflowPlanningPolicySnapshot {
  readonly revisionId: string;
  readonly digest: string;
  readonly maxTasks: number;
  readonly maxTotalAttempts: number;
  readonly maxAttemptsPerTask: number;
  readonly allowOptionalTasks: boolean;
  readonly approvalRequiredAuthorities: readonly string[];
  readonly sponsorGate: Readonly<{
    owner: string;
    decisionTimeoutMs: number;
  }>;
  readonly schedulerPolicy: WorkroomSchedulerPolicySnapshot;
  readonly defaultSponsorLane: WorkroomSponsorLane;
  readonly defaultTaskDeadlineMs: number;
  readonly defaultPreemptibility: WorkroomTaskPreemptibility;
}

/** Trusted, exact Project/Profile/Orchestrator authority resolved outside the model. */
export interface DynamicWorkflowPlanningAuthority {
  readonly version: 1;
  readonly projectId: string;
  readonly projectRevision: string;
  readonly projectDigest: string;
  readonly orchestratorAgentDefinitionId: string;
  readonly orchestratorAuthorityDigest: string;
  readonly profile: DynamicWorkflowPlanningProfileSnapshot;
  readonly policy: DynamicWorkflowPlanningPolicySnapshot;
}

export interface DynamicWorkflowDagCandidateTask {
  readonly key: string;
  readonly title: string;
  readonly role: string;
  readonly required: boolean;
  readonly maxAttempts: number;
  readonly localRank: number;
  readonly dependsOn: readonly string[];
  readonly requires: Readonly<Required<WorkflowTaskCapabilityRequirement>>;
  readonly approval: 'none' | 'sponsor_required';
}

/** This entire value is untrusted, even when produced with model structured output. */
export interface DynamicWorkflowDagCandidate {
  readonly version: 1;
  readonly strategy: WorkflowStrategyReference;
  readonly tasks: readonly DynamicWorkflowDagCandidateTask[];
}

export interface DynamicWorkflowPlanningRequest {
  readonly version: 1;
  readonly operationId: string;
  readonly principalId: string;
  readonly authority: DynamicWorkflowPlanningAuthority;
  readonly source: Readonly<{
    ref: string;
    digest: string;
    sequence: number;
    conversationKey: string;
    text: string;
  }>;
}

export interface UntrustedWorkflowDagPlannerPort {
  propose(input: DynamicWorkflowPlanningRequest): unknown | Promise<unknown>;
}

export interface DynamicWorkflowPlanningPortOptions {
  readonly resolveAuthority: (
    input: HumanIngressPlanningInput,
  ) => DynamicWorkflowPlanningAuthority | Promise<DynamicWorkflowPlanningAuthority>;
  readonly planner: UntrustedWorkflowDagPlannerPort;
}

/**
 * Production planning boundary. A model/strategy can only return an untrusted
 * DAG candidate. Identity, Profile, policy, budget and approval authority are
 * supplied by trusted ports and re-materialized by WorkflowPlanBuilder.
 */
export class DynamicWorkflowPlanningPort implements HumanIngressPlanningPort {
  constructor(readonly options: DynamicWorkflowPlanningPortOptions) {}

  async propose(input: HumanIngressPlanningInput): Promise<WorkflowPlanProposal> {
    const authority = validateAuthority(await this.options.resolveAuthority(input), input);
    const request = deepFreeze<DynamicWorkflowPlanningRequest>({
      version: 1,
      operationId: input.operationId,
      principalId: input.principalId,
      authority,
      source: {
        ref: input.source.ref,
        digest: input.source.digest,
        sequence: input.source.sequence,
        conversationKey: input.source.conversationKey,
        text: input.source.text,
      },
    });
    const candidate = parseCandidate(await this.options.planner.propose(request));
    const strategy = authority.profile.strategies.find(item =>
      canonicalWorkroomJson(item) === canonicalWorkroomJson(candidate.strategy));
    if (!strategy) throw new Error('Dynamic Workflow strategy is not authorized by the exact Profile');
    if (candidate.tasks.length > authority.policy.maxTasks) {
      throw new Error('Dynamic Workflow candidate exceeds the authorized Task budget');
    }
    let builder = WorkflowPlanBuilder.create({
      proposalId: input.operationId,
      projectId: input.projectId,
      strategy,
      parameterDigest: input.source.digest,
      authority: {
        projectRevision: authority.projectRevision,
        projectDigest: authority.projectDigest,
        profileRevisionId: authority.profile.revisionId,
        profileDigest: authority.profile.digest,
        planningPolicyRevisionId: authority.policy.revisionId,
        planningPolicyDigest: authority.policy.digest,
        orchestratorAgentDefinitionId: authority.orchestratorAgentDefinitionId,
        orchestratorAuthorityDigest: authority.orchestratorAuthorityDigest,
      },
      budget: {
        maxTasks: authority.policy.maxTasks,
        maxTotalAttempts: authority.policy.maxTotalAttempts,
      },
      schedulerPolicy: authority.policy.schedulerPolicy,
    });
    for (const task of candidate.tasks) {
      assertTaskAuthorized(task, authority);
      builder = builder.addTask({
        key: task.key,
        title: task.title,
        role: task.role,
        required: task.required,
        maxAttempts: task.maxAttempts,
        dependsOn: task.dependsOn,
        requires: task.requires,
        scheduler: {
          sponsorLane: authority.policy.defaultSponsorLane,
          localRank: task.localRank,
          enqueuedAt: input.source.event.timestamp,
          deadline: input.source.event.timestamp + authority.policy.defaultTaskDeadlineMs,
          preemptibility: authority.policy.defaultPreemptibility,
        },
        ...(task.approval === 'sponsor_required'
          ? {
              approvalGate: {
                id: `approval:${task.key}`,
                kind: 'sponsor' as const,
                owner: authority.policy.sponsorGate.owner,
                decisionTimeoutMs: authority.policy.sponsorGate.decisionTimeoutMs,
                deadline: input.source.event.timestamp + authority.policy.sponsorGate.decisionTimeoutMs,
                policyRevisionId: authority.policy.revisionId,
                policyDigest: authority.policy.digest,
              },
            }
          : {}),
      });
    }
    return builder.build();
  }
}

function validateAuthority(
  value: DynamicWorkflowPlanningAuthority,
  input: HumanIngressPlanningInput,
): DynamicWorkflowPlanningAuthority {
  if (!value || typeof value !== 'object' || value.version !== 1) {
    throw new Error('Dynamic Workflow planning authority is invalid');
  }
  if (value.projectId !== input.projectId
    || value.projectRevision !== input.projectRevision
    || value.projectDigest !== input.projectDigest
    || value.orchestratorAgentDefinitionId !== input.orchestratorAgentDefinitionId
    || value.orchestratorAuthorityDigest !== input.orchestratorAuthorityDigest) {
    throw new Error('Dynamic Workflow planning authority drifted from the canonical Project/Orchestrator input');
  }
  text(value.profile.revisionId, 'Profile revision');
  digest(value.profile.digest, 'Profile digest');
  if (!Array.isArray(value.profile.strategies) || value.profile.strategies.length === 0) {
    throw new Error('Dynamic Workflow Profile has no authorized Strategy');
  }
  for (const strategy of value.profile.strategies) {
    text(strategy.id, 'Strategy id'); text(strategy.version, 'Strategy version'); digest(strategy.digest, 'Strategy digest');
  }
  canonicalNames(value.profile.roles, 'Profile roles');
  canonicalRequirements(value.profile.capabilities, 'Profile capabilities');
  text(value.policy.revisionId, 'Planning policy revision');
  digest(value.policy.digest, 'Planning policy digest');
  positive(value.policy.maxTasks, 'Planning policy maxTasks');
  positive(value.policy.maxTotalAttempts, 'Planning policy maxTotalAttempts');
  positive(value.policy.maxAttemptsPerTask, 'Planning policy maxAttemptsPerTask');
  if (typeof value.policy.allowOptionalTasks !== 'boolean') {
    throw new Error('Planning policy allowOptionalTasks must be boolean');
  }
  canonicalNames(value.policy.approvalRequiredAuthorities, 'Planning policy approval authorities');
  text(value.policy.sponsorGate.owner, 'Planning policy Sponsor Gate owner');
  positive(value.policy.sponsorGate.decisionTimeoutMs, 'Planning policy Sponsor Gate timeout');
  if (!['urgent', 'high', 'normal', 'low'].includes(value.policy.defaultSponsorLane)) {
    throw new Error('Planning policy default Sponsor lane is invalid');
  }
  positive(value.policy.defaultTaskDeadlineMs, 'Planning policy default Task deadline');
  if (!['checkpointable', 'atomic'].includes(value.policy.defaultPreemptibility)) {
    throw new Error('Planning policy default preemptibility is invalid');
  }
  return deepFreeze(structuredClone(value));
}

function parseCandidate(value: unknown): DynamicWorkflowDagCandidate {
  record(value, 'Dynamic Workflow candidate');
  exactKeys(value, ['version', 'strategy', 'tasks'], 'Dynamic Workflow candidate');
  if (value.version !== 1) throw new Error('Dynamic Workflow candidate version is unsupported');
  record(value.strategy, 'Dynamic Workflow strategy');
  exactKeys(value.strategy, ['id', 'version', 'digest'], 'Dynamic Workflow strategy');
  text(value.strategy.id, 'Dynamic Workflow strategy id');
  text(value.strategy.version, 'Dynamic Workflow strategy version');
  digest(value.strategy.digest, 'Dynamic Workflow strategy digest');
  if (!Array.isArray(value.tasks)) throw new Error('Dynamic Workflow candidate tasks must be an array');
  const tasks = value.tasks.map((item, index) => parseTask(item, index));
  return deepFreeze({
    version: 1,
    strategy: {
      id: value.strategy.id,
      version: value.strategy.version,
      digest: value.strategy.digest,
    },
    tasks,
  });
}

function parseTask(value: unknown, index: number): DynamicWorkflowDagCandidateTask {
  const label = `Dynamic Workflow candidate task ${index}`;
  record(value, label);
  exactKeys(value, [
    'key', 'title', 'role', 'required', 'maxAttempts', 'localRank', 'dependsOn', 'requires', 'approval',
  ], label);
  text(value.key, `${label} key`); text(value.title, `${label} title`); text(value.role, `${label} role`);
  if (typeof value.required !== 'boolean') throw new Error(`${label} required must be boolean`);
  positive(value.maxAttempts, `${label} maxAttempts`);
  if (typeof value.localRank !== 'number' || !Number.isSafeInteger(value.localRank) || value.localRank < 0) {
    throw new Error(`${label} localRank must be a non-negative safe integer`);
  }
  const localRank = value.localRank;
  const dependsOn = canonicalNames(value.dependsOn, `${label} dependencies`, false);
  record(value.requires, `${label} requirements`);
  exactKeys(value.requires, ['tools', 'skills', 'integrations', 'authorities'], `${label} requirements`);
  const requires = canonicalRequirements(value.requires as unknown as Required<WorkflowTaskCapabilityRequirement>, `${label} requirements`, false);
  if (value.approval !== 'none' && value.approval !== 'sponsor_required') {
    throw new Error(`${label} approval is invalid`);
  }
  return deepFreeze({
    key: value.key,
    title: value.title,
    role: value.role,
    required: value.required,
    maxAttempts: value.maxAttempts,
    localRank,
    dependsOn,
    requires,
    approval: value.approval,
  });
}

function assertTaskAuthorized(
  task: DynamicWorkflowDagCandidateTask,
  authority: DynamicWorkflowPlanningAuthority,
): void {
  if (!authority.profile.roles.includes(task.role)) {
    throw new Error(`Dynamic Workflow Task ${task.key} role is outside the exact Profile`);
  }
  if (!task.required && !authority.policy.allowOptionalTasks) {
    throw new Error(`Dynamic Workflow Task ${task.key} is optional but the planning policy forbids optional Tasks`);
  }
  if (task.maxAttempts > authority.policy.maxAttemptsPerTask) {
    throw new Error(`Dynamic Workflow Task ${task.key} exceeds the per-Task attempt budget`);
  }
  for (const kind of ['tools', 'skills', 'integrations', 'authorities'] as const) {
    for (const name of task.requires[kind]) {
      if (!authority.profile.capabilities[kind].includes(name)) {
        throw new Error(`Dynamic Workflow Task ${task.key} ${kind} requirement ${name} is outside the exact Profile`);
      }
    }
  }
  const requiresApproval = task.requires.authorities.some(item =>
    authority.policy.approvalRequiredAuthorities.includes(item));
  if (requiresApproval && task.approval !== 'sponsor_required') {
    throw new Error(`Dynamic Workflow Task ${task.key} requires a Sponsor approval gate`);
  }
}

function canonicalRequirements(
  value: Required<WorkflowTaskCapabilityRequirement>,
  label: string,
  requireCanonical = true,
): Readonly<Required<WorkflowTaskCapabilityRequirement>> {
  return deepFreeze({
    tools: canonicalNames(value.tools, `${label}.tools`, requireCanonical),
    skills: canonicalNames(value.skills, `${label}.skills`, requireCanonical),
    integrations: canonicalNames(value.integrations, `${label}.integrations`, requireCanonical),
    authorities: canonicalNames(value.authorities, `${label}.authorities`, requireCanonical),
  });
}

function canonicalNames(value: unknown, label: string, requireCanonical = true): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const item of value) text(item, label);
  const names = [...new Set(value as string[])].sort((left, right) => compareCanonicalWorkroomText(left, right));
  if (requireCanonical && canonicalWorkroomJson(value) !== canonicalWorkroomJson(names)) {
    throw new Error(`${label} must be sorted and unique`);
  }
  return Object.freeze(names);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unexpected field ${key}`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${label} is missing field ${key}`);
  }
}

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
}

function positive(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive safe integer`);
}
