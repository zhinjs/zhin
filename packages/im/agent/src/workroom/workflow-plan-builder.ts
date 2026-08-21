import { createHash } from 'node:crypto';

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

export interface WorkflowPlanTaskInput {
  readonly key: string;
  readonly title: string;
  readonly role: string;
  readonly required: boolean;
  readonly maxAttempts: number;
  readonly dependsOn: readonly string[];
  readonly requires: WorkflowTaskCapabilityRequirement;
}

export interface WorkflowPlanTaskProposal extends Omit<WorkflowPlanTaskInput, 'requires'> {
  readonly requires: Readonly<Required<WorkflowTaskCapabilityRequirement>>;
}

export interface WorkflowPlanProposalMetadata {
  readonly proposalId: string;
  readonly projectId: string;
  readonly strategy: WorkflowStrategyReference;
  readonly parameterDigest: string;
}

export interface WorkflowPlanProposal extends WorkflowPlanProposalMetadata {
  readonly version: 1;
  readonly tasks: readonly WorkflowPlanTaskProposal[];
  readonly digest: string;
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
    return new WorkflowPlanBuilder(deepFreeze({
      ...metadata,
      strategy: { ...metadata.strategy },
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
    assertDependencyGraph(tasks);
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
  });
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
