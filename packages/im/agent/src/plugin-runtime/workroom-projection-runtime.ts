import type { WorkroomCatalog, WorkroomCatalogSnapshot } from '../workroom/catalog.js';
import type { WorkroomDefinition } from '../workroom/catalog-definition.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import { digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import type {
  HumanIngressIntent,
  HumanIngressTargetResolutionRequest,
  HumanIngressTargetResolverPort,
} from '../workroom/human-ingress.js';
import {
  WorkroomProjectionDeliveryWorker,
  WorkroomProjectionTracer,
  resolveProjectionReplyTarget,
  workroomProjectionMessageKey,
  type WorkroomProjectionBinding,
  type WorkroomProjectionDeliveryPort,
  type WorkroomProjectionRepository,
  type WorkroomProjectionMessageRef,
  type WorkroomProjectionGovernancePort,
  type WorkroomProjectionReplyTargetDecision,
} from '../workroom/projection-outbox.js';

export interface WorkroomProjectionTickResult {
  readonly scannedRuns: number;
  readonly capturedRuns: number;
  readonly deliveries: number;
  readonly pending: boolean;
}

export interface WorkroomProjectionRuntimeOptions {
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly journal: WorkroomJournal;
  readonly repository: WorkroomProjectionRepository;
  readonly outbound: WorkroomProjectionDeliveryPort;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly maxRunsPerTick: number;
  readonly maxDeliveriesPerTick: number;
  readonly governance?: WorkroomProjectionGovernancePort;
}

/** Generation-owned bounded scanner; durable cursors/outbox remain the restart authority. */
export class WorkroomProjectionRuntime {
  readonly #tracer: WorkroomProjectionTracer;
  readonly #worker: WorkroomProjectionDeliveryWorker;
  #runOffset = 0;

  constructor(readonly options: WorkroomProjectionRuntimeOptions) {
    positive(options.maxRunsPerTick, 'maxRunsPerTick');
    positive(options.maxDeliveriesPerTick, 'maxDeliveriesPerTick');
    this.#tracer = new WorkroomProjectionTracer({
      journal: options.journal,
      repository: options.repository,
      governance: options.governance,
    });
    this.#worker = new WorkroomProjectionDeliveryWorker({
      repository: options.repository,
      outbound: options.outbound,
      workerId: options.workerId,
      leaseMs: options.leaseMs,
      governance: options.governance,
    });
  }

  async runOnce(signal: AbortSignal): Promise<WorkroomProjectionTickResult> {
    signal.throwIfAborted();
    const catalog = await this.options.catalog.read();
    const ids = [...await this.options.journal.listRunIds()].sort();
    const selected = rotate(ids, this.#runOffset, this.options.maxRunsPerTick);
    this.#runOffset = ids.length === 0 ? 0 : (this.#runOffset + selected.length) % ids.length;
    let capturedRuns = 0;
    for (const runId of selected) {
      signal.throwIfAborted();
      const events = await this.options.journal.read(runId);
      const projectId = String(events[0]?.payload.projectId ?? '');
      const definition = catalog.definitions[projectId];
      const binding = (await this.options.repository.read()).bindings[projectId];
      if (!definition || definition.enabled === false || !binding) continue;
      assertCatalogBinding(catalog, projectId, definition, binding);
      await this.#tracer.capture(binding, runId, signal);
      capturedRuns += 1;
    }
    let deliveries = 0;
    while (deliveries < this.options.maxDeliveriesPerTick) {
      signal.throwIfAborted();
      const result = await this.#worker.runOnce(Date.now(), signal);
      if (result.status === 'idle') break;
      deliveries += 1;
      if (result.status === 'failed') break;
    }
    const pending = Object.values((await this.options.repository.read()).items)
      .some(item => item.delivery.status === 'pending'
        || item.delivery.status === 'leased'
        || (item.delivery.status === 'failed' && item.delivery.retryable === true));
    return Object.freeze({
      scannedRuns: selected.length,
      capturedRuns,
      deliveries,
      pending,
    });
  }
}

export interface WorkroomProjectionRunStatePort {
  read(projectId: string, runId: string): Promise<Readonly<{
    assignments: Readonly<Record<string, Readonly<{
      id: string;
      taskKey: string;
      taskRevision: number;
      revision: number;
      status: string;
    }>>>;
  }>>;
}

export interface WorkroomProjectionReplyResolverOptions {
  readonly repository: Pick<WorkroomProjectionRepository, 'read'>;
  readonly runState: WorkroomProjectionRunStatePort;
}

/** Message Index targeting adapter; it reads state but owns no Kernel command. */
export class WorkroomProjectionReplyResolver {
  constructor(readonly options: WorkroomProjectionReplyResolverOptions) {}

  async resolve(input: Readonly<{
    projectId: string;
    bindingRevision: number;
    replyTo: WorkroomProjectionMessageRef;
    intent: 'discussion' | 'task_input';
  }>): Promise<WorkroomProjectionReplyTargetDecision> {
    const projection = await this.options.repository.read();
    const entry = projection.messageIndex[workroomProjectionMessageKey(input.replyTo)];
    let activeAssignments: Array<{
      projectId: string;
      runId: string;
      taskKey: string;
      taskRevision: number;
      assignmentId: string;
      assignmentRevision: number;
    }> = [];
    if (entry?.target.projectId === input.projectId) {
      const state = await this.options.runState.read(input.projectId, entry.target.runId);
      activeAssignments = Object.values(state.assignments)
        .filter(assignment => ['leased', 'running', 'cancel_requested'].includes(assignment.status))
        .map(assignment => ({
          projectId: input.projectId,
          runId: entry.target.runId,
          taskKey: assignment.taskKey,
          taskRevision: assignment.taskRevision,
          assignmentId: assignment.id,
          assignmentRevision: assignment.revision,
        }));
    }
    return resolveProjectionReplyTarget(projection, { ...input, activeAssignments });
  }
}

export function createProjectionHumanIngressTargetResolver(options: Readonly<{
  resolver: WorkroomProjectionReplyResolver;
  replyTo?: WorkroomProjectionMessageRef;
  intent: HumanIngressIntent;
}>): HumanIngressTargetResolverPort {
  return Object.freeze({
    async resolve(request: HumanIngressTargetResolutionRequest) {
      const resolverRef = 'projection-message-index:v1';
      if (!options.replyTo) {
        return Object.freeze({
          ...request,
          status: 'unaddressed' as const,
          intent: options.intent,
          resolverRef,
          resolverDigest: digest({ resolverRef, intent: options.intent, status: 'unaddressed' }),
        });
      }
      const decision = await options.resolver.resolve({
        projectId: request.decision.projectId,
        bindingRevision: request.decision.bindingRevision,
        replyTo: options.replyTo,
        intent: options.intent === 'discussion' ? 'discussion' : 'task_input',
      });
      const resolverDigest = digest({ resolverRef, intent: options.intent, decision });
      if (decision.status === 'clarification_required') {
        return Object.freeze({
          ...request,
          status: 'clarification_required' as const,
          intent: options.intent,
          resolverRef,
          resolverDigest,
          reason: decision.reason === 'cross_project_target'
            ? 'cross_project_target' as const
            : 'target_not_found' as const,
          candidateRefs: decision.candidateRefs,
        });
      }
      return Object.freeze({
        ...request,
        status: 'task_target' as const,
        intent: options.intent,
        resolverRef,
        resolverDigest,
        via: 'reply' as const,
        target: Object.freeze({
          projectId: decision.target.projectId,
          runId: decision.target.runId,
          taskKey: decision.target.taskKey,
          taskRevision: decision.target.taskRevision,
          assignmentId: decision.target.assignmentId,
          assignmentRevision: decision.target.assignmentRevision,
          agentDefinitionId: decision.target.agentDefinitionId,
          status: decision.target.status,
        }),
      });
    },
  });
}

export interface WorkroomProjectionSchedulerOptions {
  readonly runtime: Pick<WorkroomProjectionRuntime, 'runOnce'>;
  readonly intervalMs: number;
  readonly onError?: (error: unknown) => void;
}

/** One non-overlapping generation loop with abort-and-join disposal. */
export class WorkroomProjectionScheduler {
  readonly #controller = new AbortController();
  #timer?: ReturnType<typeof setTimeout>;
  #active?: Promise<void>;
  #started = false;

  constructor(readonly options: WorkroomProjectionSchedulerOptions) {
    positive(options.intervalMs, 'intervalMs');
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#schedule(0);
  }

  async dispose(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#controller.abort(new Error('Workroom Projection generation disposed'));
    await this.#active?.catch(error => {
      if (!this.#controller.signal.aborted) throw error;
    });
  }

  #schedule(delay: number): void {
    if (this.#controller.signal.aborted) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      const active = this.options.runtime.runOnce(this.#controller.signal).then(
        () => undefined,
        error => {
          if (!this.#controller.signal.aborted) this.options.onError?.(error);
        },
      ).finally(() => {
        if (this.#active === active) this.#active = undefined;
        this.#schedule(this.options.intervalMs);
      });
      this.#active = active;
    }, delay);
    this.#timer.unref?.();
  }
}

function assertCatalogBinding(
  catalog: WorkroomCatalogSnapshot,
  projectId: string,
  definition: WorkroomDefinition,
  binding: WorkroomProjectionBinding,
): void {
  if (binding.projectId !== projectId || !definition.conversation) {
    throw new Error('Workroom Projection binding does not match persistent Catalog Project');
  }
  if (binding.catalogBindingDigest !== workroomProjectionCatalogBindingDigest(definition)) {
    throw new Error('Workroom Projection binding targets a stale Catalog revision');
  }
  if (definition.conversation.kind === 'repository'
    || binding.conversation.kind !== definition.conversation.kind
    || binding.conversation.id !== definition.conversation.id) {
    throw new Error('Workroom Projection binding does not match persistent Catalog conversation');
  }
  const members = new Map(definition.members.map(member => [member.agent, member.role]));
  if (definition.conversation.agent !== binding.orchestrator.agentDefinitionId
    || members.get(binding.orchestrator.agentDefinitionId) !== 'orchestrator'
    || binding.agents.some(agent => members.get(agent.agentDefinitionId) !== agent.role)
    || definition.members.some(member => member.role !== 'orchestrator'
      && !binding.agents.some(agent => agent.agentDefinitionId === member.agent))) {
    throw new Error(`Workroom Projection binding is stale for Catalog ${catalog.revision}`);
  }
}

export function workroomProjectionCatalogBindingDigest(
  definition: WorkroomDefinition,
): string {
  return digest(definition);
}

function rotate<T>(values: readonly T[], offset: number, limit: number): readonly T[] {
  if (values.length <= limit) return values;
  return Array.from({ length: limit }, (_, index) => values[(offset + index) % values.length]!);
}

function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Workroom Projection ${label} must be a positive safe integer`);
  }
}
