import type { WorkroomCatalog, WorkroomCatalogSnapshot } from '../workroom/catalog.js';
import type { WorkroomDefinition } from '../workroom/catalog-definition.js';
import type { PortfolioSponsorProjection } from '../portfolio/sponsor-projection.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import {
  compareCanonicalWorkroomText,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type {
  HumanIngressIntent,
  HumanIngressTargetResolutionRequest,
  HumanIngressTargetResolverPort,
} from '../workroom/human-ingress.js';
import {
  WorkroomProjectionDeliveryWorker,
  WorkroomProjectionRevisionConflictError,
  WorkroomProjectionTracer,
  projectionAudience,
  resolveProjectionReplyTarget,
  workroomProjectionBindingKey,
  workroomProjectionMessageKey,
  type WorkroomProjectionBinding,
  type WorkroomProjectionDeliveryPort,
  type WorkroomProjectionRepository,
  type WorkroomProjectionMessageRef,
  type WorkroomProjectionGovernancePort,
  type WorkroomLifecycleHoldOverdueSnapshot,
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
  /** Resolves a persistent Sponsor Room definition to the exact current Endpoint capability. */
  readonly resolveSponsorConversation?: (
    projectId: string,
    definition: WorkroomDefinition,
  ) => import('../workroom/projection-outbox.js').WorkroomProjectionConversation | undefined
    | Promise<import('../workroom/projection-outbox.js').WorkroomProjectionConversation | undefined>;
  /** Optional P12 content-free source; capture still uses the normal governed Projection outbox. */
  readonly lifecycleOverdue?: Readonly<{
    project(projectId: string, signal: AbortSignal): Promise<WorkroomLifecycleHoldOverdueSnapshot>;
  }>;
  readonly portfolioSponsor?: Readonly<{
    listPortfolioIds(): Promise<readonly string[]>;
    read(portfolioId: string): Promise<PortfolioSponsorProjection>;
  }>;
  readonly onCaptureError?: (error: unknown, projectId: string) => void;
}

/** Generation-owned bounded scanner; durable cursors/outbox remain the restart authority. */
export class WorkroomProjectionRuntime {
  readonly #tracer: WorkroomProjectionTracer;
  readonly #worker: WorkroomProjectionDeliveryWorker;
  #runOffset = 0;
  #lifecycleProjectOffset = 0;
  #portfolioOffset = 0;

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
      authority: Object.freeze({ authorize: item => this.#authorizeDelivery(item) }),
    });
  }

  async runOnce(signal: AbortSignal): Promise<WorkroomProjectionTickResult> {
    signal.throwIfAborted();
    const catalog = await this.options.catalog.read();
    if (this.options.lifecycleOverdue || this.options.portfolioSponsor) {
      await this.#ensureSponsorRoomBindings(catalog, signal);
    }
    let deliveries = 0;
    while (deliveries < this.options.maxDeliveriesPerTick) {
      signal.throwIfAborted();
      const result = await this.#worker.runOnce(Date.now(), signal);
      if (result.status === 'idle') break;
      deliveries += 1;
      if (result.status === 'failed') break;
    }
    const ids = [...await this.options.journal.listRunIds()].sort();
    const selected = rotate(ids, this.#runOffset, this.options.maxRunsPerTick);
    this.#runOffset = ids.length === 0 ? 0 : (this.#runOffset + selected.length) % ids.length;
    let capturedRuns = 0;
    const captureErrors: unknown[] = [];
    for (const runId of selected) {
      signal.throwIfAborted();
      let projectId = '';
      try {
        const events = await this.options.journal.read(runId);
        projectId = String(events[0]?.payload.projectId ?? '');
        const definition = catalog.definitions[projectId];
        const binding = (await this.options.repository.read()).bindings[
          workroomProjectionBindingKey(projectId, 'workroom')
        ];
        if (!definition || definition.enabled === false || !binding) continue;
        assertCatalogBinding(catalog, projectId, definition, binding, 'workroom');
        await this.#tracer.capture(binding, runId, signal);
        capturedRuns += 1;
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        captureErrors.push(error);
        this.options.onCaptureError?.(error, projectId);
      }
    }
    if (this.options.lifecycleOverdue) {
      const projectIds = Object.keys(catalog.definitions).sort();
      const selectedProjects = rotate(
        projectIds, this.#lifecycleProjectOffset, this.options.maxRunsPerTick,
      );
      this.#lifecycleProjectOffset = projectIds.length === 0
        ? 0
        : (this.#lifecycleProjectOffset + selectedProjects.length) % projectIds.length;
      for (const projectId of selectedProjects) {
        signal.throwIfAborted();
        try {
          const definition = catalog.definitions[projectId];
          const binding = (await this.options.repository.read()).bindings[
            workroomProjectionBindingKey(projectId, 'sponsor_room')
          ];
          if (!definition || definition.enabled === false || !binding) continue;
          assertCatalogBinding(catalog, projectId, definition, binding, 'sponsor_room');
          const snapshot = await this.options.lifecycleOverdue.project(projectId, signal);
          await this.#tracer.captureLifecycleOverdue(binding, snapshot, signal);
        } catch (error) {
          if (signal.aborted) throw signal.reason ?? error;
          captureErrors.push(error);
          this.options.onCaptureError?.(error, projectId);
        }
      }
    }
    if (this.options.portfolioSponsor) {
      const portfolioIds = [...await this.options.portfolioSponsor.listPortfolioIds()]
        .sort(compareCanonicalWorkroomText);
      const selectedPortfolios = rotate(
        portfolioIds, this.#portfolioOffset, this.options.maxRunsPerTick,
      );
      this.#portfolioOffset = portfolioIds.length === 0
        ? 0
        : (this.#portfolioOffset + selectedPortfolios.length) % portfolioIds.length;
      for (const portfolioId of selectedPortfolios) {
        signal.throwIfAborted();
        let projection: PortfolioSponsorProjection;
        try {
          projection = await this.options.portfolioSponsor.read(portfolioId);
        } catch (error) {
          if (signal.aborted) throw signal.reason ?? error;
          captureErrors.push(error);
          this.options.onCaptureError?.(error, portfolioId);
          continue;
        }
        for (const projectId of Object.keys(projection.projects).sort(compareCanonicalWorkroomText)) {
          try {
            const definition = catalog.definitions[projectId];
            const binding = (await this.options.repository.read()).bindings[
              workroomProjectionBindingKey(projectId, 'sponsor_room')
            ];
            if (!definition || definition.enabled === false || !binding) continue;
            assertCatalogBinding(catalog, projectId, definition, binding, 'sponsor_room');
            await this.#tracer.capturePortfolioSponsor(binding, projection, signal);
          } catch (error) {
            if (signal.aborted) throw signal.reason ?? error;
            captureErrors.push(error);
            this.options.onCaptureError?.(error, projectId);
          }
        }
      }
    }
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
    if (captureErrors.length > 0 && !this.options.onCaptureError) throw captureErrors[0];
    return Object.freeze({
      scannedRuns: selected.length,
      capturedRuns,
      deliveries,
      pending,
    });
  }

  async #authorizeDelivery(
    item: import('../workroom/projection-outbox.js').WorkroomProjectionOutboxItem,
  ): Promise<boolean> {
    const audience = projectionAudience(item);
    const catalog = await this.options.catalog.read();
    const definition = catalog.definitions[item.projectId];
    const state = await this.options.repository.read();
    const binding = state.bindings[workroomProjectionBindingKey(item.projectId, audience)];
    if (!definition || definition.enabled === false || !binding) return false;
    try {
      assertCatalogBinding(catalog, item.projectId, definition, binding, audience);
    } catch {
      return false;
    }
    if (audience === 'sponsor_room' && this.options.resolveSponsorConversation) {
      const currentConversation = await this.options.resolveSponsorConversation(item.projectId, definition);
      if (!currentConversation || digest(currentConversation) !== digest(binding.conversation)) return false;
    }
    return item.bindingRevision === binding.bindingRevision
      && digest(item.conversation) === digest(binding.conversation)
      && (item.speaker.agentDefinitionId === binding.orchestrator.agentDefinitionId
        || binding.agents.some(agent => agent.agentDefinitionId === item.speaker.agentDefinitionId
          && agent.role === item.speaker.role));
  }

  /**
   * Sponsor Rooms are persistent Catalog delivery views, not bindings learned from
   * the first inbound message. Materialize every enabled Project view at startup/tick
   * so a portfolio room can receive its first alert without prior human traffic.
   */
  async #ensureSponsorRoomBindings(
    catalog: WorkroomCatalogSnapshot,
    signal: AbortSignal,
  ): Promise<void> {
    for (const projectId of Object.keys(catalog.definitions).sort()) {
      signal.throwIfAborted();
      const definition = catalog.definitions[projectId];
      const configured = definition?.sponsorConversation;
      if (!definition || definition.enabled === false || !configured) continue;
      if (configured.kind === 'repository') {
        throw new Error('Sponsor Room Projection requires a group or channel conversation');
      }
      const resolvedConversation = this.options.resolveSponsorConversation
        ? await this.options.resolveSponsorConversation(projectId, definition)
        : undefined;
      if (this.options.resolveSponsorConversation && !resolvedConversation) continue;
      for (let conflict = 0; conflict < 8; conflict += 1) {
        const state = await this.options.repository.read();
        const current = state.bindings[workroomProjectionBindingKey(projectId, 'sponsor_room')];
        if (current) {
          try {
            assertCatalogBinding(catalog, projectId, definition, current, 'sponsor_room');
            if (!resolvedConversation
              || digest(current.conversation) === digest(resolvedConversation)) break;
          } catch {
            // A current Catalog change publishes a higher binding revision below.
          }
        }
        const orchestrator = definition.members.find(member =>
          member.agent === configured.agent && member.role === 'orchestrator');
        if (!orchestrator) throw new Error(`Sponsor Room ${projectId} has no exact Orchestrator`);
        const identity = (member: (typeof definition.members)[number]) => Object.freeze({
          principalId: member.agent,
          agentDefinitionId: member.agent,
          displayName: member.agent,
          role: member.role,
        });
        const exactConversation = resolvedConversation ?? Object.freeze({
              endpoint: Object.freeze({ id: configured.endpoint, adapter: configured.adapter }),
              kind: configured.kind,
              id: configured.id,
            });
        const candidate: WorkroomProjectionBinding = Object.freeze({
          version: 1,
          audience: 'sponsor_room',
          projectId,
          catalogBindingDigest: workroomProjectionCatalogBindingDigest(definition),
          bindingRevision: (current?.bindingRevision ?? 0) + 1,
          projectionPolicyRevision: 1,
          conversation: Object.freeze(structuredClone(exactConversation)),
          orchestrator: identity(orchestrator) as WorkroomProjectionBinding['orchestrator'],
          agents: Object.freeze(definition.members
            .filter(member => member !== orchestrator)
            .map(identity)) as WorkroomProjectionBinding['agents'],
        });
        try {
          await this.options.repository.bind(state.revision, candidate);
          break;
        } catch (error) {
          if (!(error instanceof WorkroomProjectionRevisionConflictError) || conflict === 7) throw error;
        }
      }
    }
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
    if (entry?.target.projectId === input.projectId
      && (!entry.target.taskKey || !entry.target.taskRevision
        || !entry.target.assignmentId || !entry.target.assignmentRevision)) {
      return resolveProjectionReplyTarget(projection, { ...input, activeAssignments: [] });
    }
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
  audience: 'workroom' | 'sponsor_room',
): void {
  const conversation = audience === 'workroom'
    ? definition.conversation
    : definition.sponsorConversation;
  if (binding.projectId !== projectId || projectionAudience(binding) !== audience || !conversation) {
    throw new Error('Workroom Projection binding does not match persistent Catalog Project');
  }
  if (binding.catalogBindingDigest !== workroomProjectionCatalogBindingDigest(definition)) {
    throw new Error('Workroom Projection binding targets a stale Catalog revision');
  }
  if (conversation.kind === 'repository'
    || binding.conversation.kind !== conversation.kind
    || binding.conversation.id !== conversation.id) {
    throw new Error('Workroom Projection binding does not match persistent Catalog conversation');
  }
  const hasCatalogMember = (agentDefinitionId: string, role: string) =>
    definition.members.some(member => member.agent === agentDefinitionId && member.role === role);
  if (conversation.agent !== binding.orchestrator.agentDefinitionId
    || !hasCatalogMember(binding.orchestrator.agentDefinitionId, 'orchestrator')
    || binding.agents.some(agent => !hasCatalogMember(agent.agentDefinitionId, agent.role))
    || definition.members.some(member => member.role !== 'orchestrator'
      && !binding.agents.some(agent => agent.agentDefinitionId === member.agent
        && agent.role === member.role))) {
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
