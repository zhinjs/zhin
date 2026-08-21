import { createHash } from 'node:crypto';
import {
  assertWorkroomSchedulerPolicySnapshot,
  type WorkroomSchedulerPolicySnapshot,
  type WorkroomSponsorLane,
  type WorkroomTaskPreemptibility,
} from './workroom-scheduler.js';

export interface WorkflowStrategyReference {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export interface WorkflowTaskCapabilityRequirement {
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
  readonly integrations?: readonly string[];
  readonly authorities?: readonly string[];
}

export interface WorkflowPlanAuthoritySnapshot {
  readonly projectRevision: string;
  readonly projectDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly planningPolicyRevisionId: string;
  readonly planningPolicyDigest: string;
  readonly orchestratorAgentDefinitionId: string;
  readonly orchestratorAuthorityDigest: string;
}

export interface WorkflowPlanBudget {
  readonly maxTasks: number;
  readonly maxTotalAttempts: number;
}

export interface WorkflowPlanApprovalGateInput {
  readonly id: string;
  readonly kind: 'sponsor';
  readonly owner: string;
  readonly decisionTimeoutMs: number;
  readonly deadline: number;
  readonly policyRevisionId: string;
  readonly policyDigest: string;
}

export interface WorkflowPlanApprovalGate extends WorkflowPlanApprovalGateInput {
  readonly allowedActions: readonly ['approve', 'reject', 'replan', 'cancel'];
}

export interface WorkflowPlanTaskSchedulerInput {
  readonly sponsorLane: WorkroomSponsorLane;
  readonly localRank: number;
  readonly deadline: number;
  readonly enqueuedAt: number;
  readonly preemptibility: WorkroomTaskPreemptibility;
}

export interface WorkflowPlanTaskInput {
  readonly key: string;
  readonly title: string;
  readonly role: string;
  readonly required: boolean;
  readonly maxAttempts: number;
  readonly dependsOn: readonly string[];
  readonly requires: WorkflowTaskCapabilityRequirement;
  readonly scheduler: WorkflowPlanTaskSchedulerInput;
  readonly approvalGate?: WorkflowPlanApprovalGateInput;
}

export interface WorkflowPlanTaskProposal extends Omit<WorkflowPlanTaskInput, 'requires' | 'approvalGate'> {
  readonly requires: Readonly<Required<WorkflowTaskCapabilityRequirement>>;
  readonly approvalGate?: WorkflowPlanApprovalGate;
}

export interface WorkflowPlanProposalMetadata {
  readonly proposalId: string;
  readonly projectId: string;
  readonly strategy: WorkflowStrategyReference;
  readonly parameterDigest: string;
  readonly authority: WorkflowPlanAuthoritySnapshot;
  readonly budget: WorkflowPlanBudget;
  readonly schedulerPolicy: WorkroomSchedulerPolicySnapshot;
}

export interface WorkflowPlanProposal extends WorkflowPlanProposalMetadata {
  readonly version: 1;
  readonly tasks: readonly WorkflowPlanTaskProposal[];
  readonly digest: string;
}

/** Revalidates untrusted planner output against the same canonical builder. */
export function assertWorkflowPlanProposal(value: WorkflowPlanProposal): void {
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.tasks)) {
    throw new Error('Workflow Plan proposal shape is invalid');
  }
  let builder = WorkflowPlanBuilder.create({
    proposalId: value.proposalId,
    projectId: value.projectId,
    strategy: value.strategy,
    parameterDigest: value.parameterDigest,
    authority: value.authority,
    budget: value.budget,
    schedulerPolicy: value.schedulerPolicy,
  });
  for (const task of value.tasks) builder = builder.addTask(task);
  const rebuilt = builder.build();
  if (stableJson(rebuilt) !== stableJson(value)) {
    throw new Error('Workflow Plan proposal is not canonical or its digest does not match');
  }
}

/**
 * Persistent, I/O-free graph builder. It can only produce a versioned proposal;
 * applying, scheduling and executing that proposal remain Kernel-owned concerns.
 */
export class WorkflowPlanBuilder {
  readonly #metadata: WorkflowPlanProposalMetadata;
  readonly #tasks: readonly WorkflowPlanTaskProposal[];

  private constructor(
    metadata: WorkflowPlanProposalMetadata,
    tasks: readonly WorkflowPlanTaskProposal[],
  ) {
    this.#metadata = metadata;
    this.#tasks = tasks;
    Object.freeze(this);
  }

  static create(metadata: WorkflowPlanProposalMetadata): WorkflowPlanBuilder {
    requireText(metadata.proposalId, 'proposalId');
    requireText(metadata.projectId, 'projectId');
    requireText(metadata.strategy.id, 'strategy.id');
    requireText(metadata.strategy.version, 'strategy.version');
    requireText(metadata.strategy.digest, 'strategy.digest');
    requireText(metadata.parameterDigest, 'parameterDigest');
    normalizeAuthority(metadata.authority);
    normalizeBudget(metadata.budget);
    assertWorkroomSchedulerPolicySnapshot(metadata.schedulerPolicy, 1);
    return new WorkflowPlanBuilder(deepFreeze({
      ...metadata,
      strategy: { ...metadata.strategy },
      authority: { ...metadata.authority },
      budget: { ...metadata.budget },
      schedulerPolicy: structuredClone(metadata.schedulerPolicy),
    }), Object.freeze([]));
  }

  addTask(input: WorkflowPlanTaskInput): WorkflowPlanBuilder {
    if (this.#tasks.some((task) => task.key === input.key)) {
      throw new Error(`Workflow Plan Task ${input.key} already exists`);
    }
    const task = normalizeTask(input);
    return new WorkflowPlanBuilder(
      this.#metadata,
      Object.freeze([...this.#tasks, task]),
    );
  }

  build(): WorkflowPlanProposal {
    if (this.#tasks.length === 0) throw new Error('Workflow Plan requires at least one Task');
    const tasks = [...this.#tasks].sort((left, right) => left.key.localeCompare(right.key));
    if (!tasks.some(task => task.required)) throw new Error('Workflow Plan requires at least one required Task');
    assertDependencyGraph(tasks);
    if (tasks.length > this.#metadata.budget.maxTasks) {
      throw new Error('Workflow Plan Task count exceeds the authorized budget');
    }
    if (tasks.reduce((total, task) => total + task.maxAttempts, 0) > this.#metadata.budget.maxTotalAttempts) {
      throw new Error('Workflow Plan total attempts exceed the authorized budget');
    }
    const projection = {
      version: 1 as const,
      ...this.#metadata,
      tasks,
    };
    return deepFreeze({ ...projection, digest: digest(projection) });
  }
}

function normalizeTask(input: WorkflowPlanTaskInput): WorkflowPlanTaskProposal {
  requireText(input.key, 'task.key');
  requireText(input.title, 'task.title');
  requireText(input.role, 'task.role');
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new Error('Workflow Plan Task maxAttempts must be a positive integer');
  }
  if (typeof input.required !== 'boolean') {
    throw new Error('Workflow Plan Task required must be a boolean');
  }
  const dependsOn = normalizeNames(input.dependsOn, 'task.dependsOn');
  if (dependsOn.includes(input.key)) throw new Error(`Workflow Plan Task ${input.key} cannot depend on itself`);
  const approvalGate = input.approvalGate ? normalizeApprovalGate(input.approvalGate, input.key) : undefined;
  return deepFreeze({
    key: input.key,
    title: input.title,
    role: input.role,
    required: input.required,
    maxAttempts: input.maxAttempts,
    dependsOn,
    requires: {
      tools: normalizeNames(input.requires.tools ?? [], 'task.requires.tools'),
      skills: normalizeNames(input.requires.skills ?? [], 'task.requires.skills'),
      integrations: normalizeNames(input.requires.integrations ?? [], 'task.requires.integrations'),
      authorities: normalizeNames(input.requires.authorities ?? [], 'task.requires.authorities'),
    },
    scheduler: normalizeTaskScheduler(input.scheduler, input.key),
    ...(approvalGate ? { approvalGate } : {}),
  });
}

function normalizeAuthority(input: WorkflowPlanAuthoritySnapshot): WorkflowPlanAuthoritySnapshot {
  requireText(input.projectRevision, 'authority.projectRevision');
  requireDigest(input.projectDigest, 'authority.projectDigest');
  requireText(input.profileRevisionId, 'authority.profileRevisionId');
  requireDigest(input.profileDigest, 'authority.profileDigest');
  requireText(input.planningPolicyRevisionId, 'authority.planningPolicyRevisionId');
  requireDigest(input.planningPolicyDigest, 'authority.planningPolicyDigest');
  requireText(input.orchestratorAgentDefinitionId, 'authority.orchestratorAgentDefinitionId');
  requireDigest(input.orchestratorAuthorityDigest, 'authority.orchestratorAuthorityDigest');
  return input;
}

function normalizeBudget(input: WorkflowPlanBudget): WorkflowPlanBudget {
  positiveInteger(input.maxTasks, 'budget.maxTasks');
  positiveInteger(input.maxTotalAttempts, 'budget.maxTotalAttempts');
  return input;
}

function normalizeApprovalGate(input: WorkflowPlanApprovalGateInput, taskKey: string): WorkflowPlanApprovalGate {
  requireText(input.id, 'task.approvalGate.id');
  if (input.id !== `approval:${taskKey}`) {
    throw new Error(`Workflow Plan Task ${taskKey} approval gate identity is not canonical`);
  }
  if (input.kind !== 'sponsor') throw new Error('Workflow Plan approval gate kind is invalid');
  requireText(input.owner, 'task.approvalGate.owner');
  positiveInteger(input.decisionTimeoutMs, 'task.approvalGate.decisionTimeoutMs');
  finiteTime(input.deadline, 'task.approvalGate.deadline');
  requireText(input.policyRevisionId, 'task.approvalGate.policyRevisionId');
  requireDigest(input.policyDigest, 'task.approvalGate.policyDigest');
  return deepFreeze({
    ...input,
    allowedActions: ['approve', 'reject', 'replan', 'cancel'] as const,
  });
}

function normalizeTaskScheduler(
  input: WorkflowPlanTaskSchedulerInput,
  taskKey: string,
): WorkflowPlanTaskSchedulerInput {
  if (!['urgent', 'high', 'normal', 'low'].includes(input.sponsorLane)) {
    throw new Error(`Workflow Plan Task ${taskKey} Sponsor lane is invalid`);
  }
  if (!Number.isSafeInteger(input.localRank) || input.localRank < 0) {
    throw new Error(`Workflow Plan Task ${taskKey} local rank must be a non-negative safe integer`);
  }
  finiteTime(input.enqueuedAt, `task.${taskKey}.scheduler.enqueuedAt`);
  finiteTime(input.deadline, `task.${taskKey}.scheduler.deadline`);
  if (input.deadline <= input.enqueuedAt) {
    throw new Error(`Workflow Plan Task ${taskKey} deadline must follow enqueue time`);
  }
  if (input.preemptibility !== 'checkpointable' && input.preemptibility !== 'atomic') {
    throw new Error(`Workflow Plan Task ${taskKey} preemptibility is invalid`);
  }
  return deepFreeze({ ...input });
}

function assertDependencyGraph(tasks: readonly WorkflowPlanTaskProposal[]): void {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!byKey.has(dependency)) {
        throw new Error(`Workflow Plan Task ${task.key} has unknown dependency ${dependency}`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error(`Workflow Plan contains a dependency cycle at ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOn ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const task of tasks) visit(task.key);
}

function normalizeNames(values: readonly string[], label: string): readonly string[] {
  for (const value of values) requireText(value, label);
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

function requireText(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} requires non-empty text`);
}

function requireDigest(value: string, label: string): void {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} requires a canonical SHA-256 digest`);
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
}

function finiteTime(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
