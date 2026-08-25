import { createHash } from 'node:crypto';
import type { Message } from '@zhin.js/core/runtime';
import {
  HumanIngressProposalSequenceConflictError,
  HumanIngressProposalReplayConflictError,
  HumanIngressProposalService,
  InteractionSpaceBindingService,
  digestHumanIngressConversationEvent,
  humanIngressConversationEventRef,
  type HumanIngressIntent,
  type HumanIngressSpaceDecision,
  type HumanIngressApplicationService,
  type HumanIngressProposalRepository,
  type HumanIngressTargetResolverPort,
  type HumanPrincipalSnapshot,
  type InteractionSpace,
  type InteractionSpaceBindingRepository,
  type InteractionSpaceRouter,
} from '@zhin.js/agent';
import {
  conversationRefKey,
  messageRefKey,
  type ConversationEventStore,
} from '@zhin.js/im-contract';

export interface CatalogWorkroomSpaceInput {
  readonly projectId: string;
  readonly agentDefinitionId: string;
  readonly space: Exclude<InteractionSpace, 'chat'>;
  readonly sourceRef: string;
  readonly sourceDigest: string;
  readonly bindingRevision?: number;
}

export type CatalogWorkroomSpace = Readonly<CatalogWorkroomSpaceInput>;
export interface WorkroomAgentTurnContinuation {
  readonly projectId: string;
  readonly agentDefinitionId: string;
  readonly space: 'workroom' | 'sponsor_room';
  readonly intent: 'discussion';
  readonly proposalId: string;
}
export type CatalogWorkroomSpaceResolution = CatalogWorkroomSpace | Readonly<{
  status: 'rejected';
  reason: 'project_required' | 'project_conflict' | 'binding_unavailable' | 'stale_binding';
}> | Readonly<{
  status: 'ignored';
  reason: 'bot_principal' | 'non_owner_endpoint';
}> | null;

export interface WorkroomHumanIngressPreRouteOptions {
  readonly bindings: InteractionSpaceBindingRepository;
  readonly bindingRouter: InteractionSpaceRouter;
  readonly proposals: HumanIngressProposalRepository;
  readonly application: Pick<HumanIngressApplicationService, 'drain'>;
  /** Required by production composition; omitted only by isolated contract embedders. */
  readonly sourceEvents?: ConversationEventStore | (() => ConversationEventStore);
  readonly resolveCatalogSpace: (message: Message) => CatalogWorkroomSpaceResolution | Promise<CatalogWorkroomSpaceResolution>;
  readonly resolveIntent?: (message: Message) => HumanIngressIntent;
  readonly createTargetResolver?: (
    message: Message,
    intent: HumanIngressIntent,
    decision: HumanIngressSpaceDecision,
  ) => HumanIngressTargetResolverPort | undefined;
  readonly onWorkroomResolved?: (
    message: Message,
    decision: HumanIngressSpaceDecision & Readonly<{ space: 'workroom' }>,
  ) => void | Promise<void>;
  readonly principalOwner: string;
}

/**
 * Product-owned boundary between ordinary chat and durable Workroom human input.
 * Entering a configured Workroom is anchored immediately before the current
 * event so its first request reaches Project Inbox. Removal is anchored at the
 * current sequence and consumed, preventing a Workroom event from being
 * reinterpreted as ordinary chat.
 */
export class WorkroomHumanIngressPreRoute {
  readonly #agentTurnContinuations = new WeakMap<Message, WorkroomAgentTurnContinuation>();

  constructor(readonly options: WorkroomHumanIngressPreRouteOptions) {}

  /** One-shot handoff from durable Workroom ingress into the Orchestrator turn. */
  hasAgentTurn(message: Message): boolean {
    return this.#agentTurnContinuations.has(message);
  }

  /** One-shot handoff from durable Workroom ingress into the Orchestrator turn. */
  takeAgentTurn(message: Message): WorkroomAgentTurnContinuation | undefined {
    const continuation = this.#agentTurnContinuations.get(message);
    this.#agentTurnContinuations.delete(message);
    return continuation;
  }

  async preRoute(message: Message, conversationSequence: number | undefined): Promise<boolean> {
    const resolution = await this.options.resolveCatalogSpace(message);
    if (resolution && 'status' in resolution) {
      if (resolution.status === 'ignored') return true;
      await message.$reply(resolution.reason === 'project_conflict'
        ? 'Sponsor Room 的显式 Project 与回复卡片不一致；请确认目标 Project 后重试。'
        : resolution.reason === 'stale_binding'
          ? '这张 Sponsor Room 卡片已经过期；请回复当前 Project 卡片后重试。'
          : resolution.reason === 'binding_unavailable'
            ? 'Sponsor Room 当前 Endpoint 尚不可用；请稍后重试。'
            : '这个 Sponsor Room 服务多个 Project；请显式指定 Project，或回复对应 Project 卡片。');
      return true;
    }
    const configured = resolution;
    const conversationKey = conversationRefKey(message.conversation);
    if (configured?.space === 'sponsor_room') {
      if (!Number.isSafeInteger(conversationSequence) || (conversationSequence as number) <= 0) {
        throw new Error('Workroom human ingress requires a durable conversation sequence');
      }
      const sequence = conversationSequence as number;
      return await this.#propose(message, sequence, Object.freeze({
        status: 'resolved' as const,
        conversationKey,
        conversationSequence: sequence,
        source: 'binding' as const,
        space: 'sponsor_room' as const,
        bindingRevision: configured.bindingRevision ?? 1,
        bindingDigest: configured.sourceDigest,
        projectId: configured.projectId,
      }), configured);
    }
    const history = await this.options.bindings.read(conversationKey);
    const active = history.at(-1);
    if (!configured && !active) return false;
    if (!Number.isSafeInteger(conversationSequence) || (conversationSequence as number) <= 0) {
      throw new Error('Workroom human ingress requires a durable conversation sequence');
    }
    const sequence = conversationSequence as number;
    const desired = configured ?? createCatalogChatSpace(active?.sourceDigest, sequence);
    const alreadyActive = configured === null
      ? active?.space === 'chat'
      : active?.space === desired.space
        && active.projectId === desired.projectId
        && active.sourceDigest === desired.sourceDigest;
    if (!alreadyActive) {
      const entersConfiguredWorkroom = configured !== null;
      await this.#bind(message, desired, entersConfiguredWorkroom ? sequence - 1 : sequence);
      if (!entersConfiguredWorkroom) return true;
    }
    const decision = await this.options.bindingRouter.resolve({
      conversation: message.conversation,
      conversationSequence: sequence,
    });
    if (decision.status !== 'resolved') return true;
    if (decision.space === 'chat') return false;
    if (decision.source !== 'binding' || !decision.projectId) {
      throw new Error('Workroom human ingress requires an exact non-chat binding');
    }
    const boundSpace = decision.space;
    if (boundSpace !== 'workroom' && boundSpace !== 'sponsor_room') {
      throw new Error('Workroom human ingress resolved an unsupported non-chat space');
    }
    if (boundSpace === 'workroom') {
      await this.options.onWorkroomResolved?.(
        message,
        Object.freeze({ ...decision, space: boundSpace, projectId: decision.projectId }),
      );
    }
    return await this.#propose(message, sequence, Object.freeze({
      ...decision, space: boundSpace, projectId: decision.projectId,
    }), configured);
  }

  async #propose(
    message: Message,
    sequence: number,
    decision: HumanIngressSpaceDecision,
    configured: CatalogWorkroomSpace | null,
  ): Promise<boolean> {
    if (!message.message || !message.sender?.id) {
      throw new Error('Workroom human ingress requires durable message and human principal identity');
    }

    const sourceStore = typeof this.options.sourceEvents === 'function'
      ? this.options.sourceEvents()
      : this.options.sourceEvents;
    const sourceEvent = sourceStore
      ? (await sourceStore.listBetween(
          message.conversation,
          sequence - 1,
          sequence,
          1,
        ))[0]
      : createEmbeddedSourceEvent(message, sequence);
    if (!sourceEvent || sourceEvent.sequence !== sequence
      || sourceEvent.event.type !== 'message.created'
      || messageRefKey(sourceEvent.event.message.ref) !== messageRefKey(message.message)) {
      throw new Error('Workroom human ingress canonical source event is unavailable');
    }

    const input = Object.freeze({
      decision,
      sourceEvent: Object.freeze({
        version: 1 as const,
        ref: humanIngressConversationEventRef(sourceEvent.event),
        digest: digestHumanIngressConversationEvent(sequence, sourceEvent.event),
        sequence,
        conversation: message.conversation,
      }),
      principal: createHumanPrincipal(message, this.options.principalOwner),
      ...(configured?.agentDefinitionId
        ? { entryAgentDefinitionId: configured.agentDefinitionId }
        : {}),
    });
    const intent = this.options.resolveIntent?.(message) ?? 'discussion';
    const resolverRef = 'workroom-human-target-resolver:unaddressed:v1';
    const resolverDigest = digestParts(resolverRef, ['unaddressed', intent]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const service = new HumanIngressProposalService(
        this.options.proposals,
        this.options.createTargetResolver?.(message, intent, decision) ?? {
        resolve: request => Object.freeze({
          ...request,
          status: 'unaddressed' as const,
          intent,
          resolverRef,
          resolverDigest,
        }),
        },
      );
      try {
        const outcome = await service.propose(input);
        if (outcome.status === 'clarification_required') {
          await message.$reply(renderHumanIngressClarification(outcome.reason));
          return true;
        }
        const proposalId = outcome.event.proposal.id;
        // Correlate the live message with its own durable proposal before the
        // project-wide application drain. Another ingress may already own that
        // drain (or consume this proposal's result), which must not swallow the
        // current Orchestrator turn. Durable replay is deliberately excluded.
        let continueToOrdinaryChat = false;
        if (intent === 'discussion' && configured?.agentDefinitionId && !outcome.duplicate) {
          this.#agentTurnContinuations.set(message, Object.freeze({
            projectId: decision.projectId,
            agentDefinitionId: configured.agentDefinitionId,
            space: decision.space,
            intent: 'discussion',
            proposalId,
          }));
          continueToOrdinaryChat = true;
        }
        const applications = await this.options.application.drain(decision.projectId);
        for (const application of applications.filter(result =>
          'proposalId' in result && result.proposalId === proposalId)) {
          if (application.status === 'clarification_required') {
            this.#agentTurnContinuations.delete(message);
            continueToOrdinaryChat = false;
            await message.$reply(renderHumanIngressClarification(application.reason));
          } else if (application.status === 'applied') {
            if (application.kind !== 'discussion_recorded') {
              await message.$reply(renderHumanIngressReceipt(application.kind, decision.projectId));
            }
          }
        }
        return !continueToOrdinaryChat;
      } catch (error) {
        const concurrent = error instanceof HumanIngressProposalSequenceConflictError
          || error instanceof HumanIngressProposalReplayConflictError;
        if (!concurrent || attempt === 2) throw error;
        // A healthy reread distinguishes a concurrent winner from durable
        // corruption before retrying at the new expected sequence.
        await this.options.proposals.read(decision.projectId);
      }
    }
    return true;
  }

  async #bind(
    message: Message,
    desired: CatalogWorkroomSpace | CatalogChatSpace,
    effectiveAfterConversationSequence: number,
  ): Promise<void> {
    const conversationKey = conversationRefKey(message.conversation);
    const barrierRef = `conversation-barrier:${encodeURIComponent(conversationKey)}:${effectiveAfterConversationSequence}`;
    const service = new InteractionSpaceBindingService(
      this.options.bindings,
      {
        readBarrier: async () => Object.freeze({
          version: 1 as const,
          conversationKey,
          currentSequence: effectiveAfterConversationSequence,
          sourceRef: barrierRef,
          sourceDigest: digestParts(barrierRef, [conversationKey, effectiveAfterConversationSequence]),
        }),
      },
      {
        authorize: request => Object.freeze({
          ...request,
          authorized: true as const,
          authorizedBy: 'workroom-catalog-space-policy:v1',
        }),
      },
    );
    await service.bind({
      conversation: message.conversation,
      space: desired.space,
      ...(desired.projectId === undefined ? {} : { projectId: desired.projectId }),
      sourceRef: `${desired.sourceRef}:at:${effectiveAfterConversationSequence}`,
      sourceDigest: desired.sourceDigest,
    });
  }
}

function renderHumanIngressReceipt(
  kind: 'discussion_recorded' | 'plan_proposal_submitted' | 'control_proposal_submitted',
  projectId: string,
): string {
  if (kind === 'plan_proposal_submitted') {
    return `已收到，Workroom「${projectId}」已提交工作计划。`;
  }
  if (kind === 'control_proposal_submitted') {
    return `已收到，Workroom「${projectId}」已提交控制请求。`;
  }
  return `已收到，消息已进入 Workroom「${projectId}」项目收件箱。`;
}

function createEmbeddedSourceEvent(
  message: Message,
  sequence: number,
): import('@zhin.js/im-contract').SequencedConversationEvent {
  const ref = message.message!;
  const event = Object.freeze({
    eventId: `message:${messageRefKey(ref)}`,
    conversation: message.conversation,
    timestamp: sequence,
    type: 'message.created' as const,
    message: Object.freeze({
      ref,
      ...(message.sender ? { actor: Object.freeze({ id: message.sender.id }) } : {}),
      segments: Object.freeze(message.segments?.length
        ? [...message.segments]
        : [{ type: 'text' as const, data: Object.freeze({ text: message.content }) }]),
      timestamp: sequence,
    }),
  });
  return Object.freeze({ sequence, event });
}

/**
 * Conservative product intent syntax. Free text is discussion; only explicit
 * Workroom verbs can request planning or control authority.
 */
export function resolveWorkroomHumanIntent(message: Message): HumanIngressIntent {
  const content = typeof message.content === 'string' ? message.content.trimStart() : '';
  if (/^\/control(?:\s|$)/iu.test(content)) return 'control';
  if (/^\/(?:work|task)(?:\s|$)/iu.test(content)) return 'work_request';
  return 'discussion';
}

function renderHumanIngressClarification(reason: string): string {
  switch (reason) {
    case 'missing_work_scope':
      return '这条工作请求已进入项目收件箱，但还需要明确工作范围和验收目标。请补充后重新使用 /work 提交。';
    case 'planning_unavailable':
      return 'Workroom 编排配置尚未完成，请先配置规划能力后重新提交 /work。';
    case 'planning_disclosure_unavailable':
      return 'Workroom 编排披露配置尚未完成，请先配置披露能力后重新提交 /work。';
    case 'missing_control_target':
      return '这条控制请求已进入项目收件箱，但还需要明确 Run/Task 目标和具体动作。请补充后重新使用 /control 提交。';
    case 'unauthorized_control':
      return '这条控制请求需要具备相应权限的负责人确认。';
    case 'stale_target':
      return '目标任务已变化，请确认当前 Run/Task 后重新提交。';
    default:
      return '这条请求需要进一步澄清，请补充明确的目标、范围和期望结果。';
  }
}

interface CatalogChatSpace {
  readonly space: 'chat';
  readonly projectId?: undefined;
  readonly sourceRef: string;
  readonly sourceDigest: string;
}

export function createCatalogWorkroomSpace(
  input: CatalogWorkroomSpaceInput,
): CatalogWorkroomSpace {
  canonicalText(input.projectId, 'projectId');
  canonicalText(input.agentDefinitionId, 'agentDefinitionId');
  if (input.space !== 'workroom' && input.space !== 'sponsor_room') {
    throw new Error('Configured Workroom space must be workroom or sponsor_room');
  }
  canonicalText(input.sourceRef, 'sourceRef');
  sha256(input.sourceDigest, 'sourceDigest');
  return Object.freeze({ ...input });
}

function createCatalogChatSpace(
  priorSourceDigest: string | undefined,
  sequence: number,
): CatalogChatSpace {
  const sourceRef = 'workroom-catalog-space:removed:v1';
  return Object.freeze({
    space: 'chat',
    sourceRef,
    sourceDigest: digestParts(sourceRef, [priorSourceDigest ?? '', sequence]),
  });
}

function createHumanPrincipal(message: Message, owner: string): HumanPrincipalSnapshot {
  canonicalText(owner, 'principalOwner');
  const subjectId = message.sender!.id;
  canonicalText(subjectId, 'sender.id');
  const principalId = `${owner}:${subjectId}`;
  const ref = `im-principal:${encodeURIComponent(principalId)}:1`;
  return Object.freeze({
    version: 1,
    ref,
    revision: 1,
    digest: digestParts(ref, [principalId, subjectId, message.conversation.endpoint]),
    principalId,
    subjectId,
    kind: 'human',
  });
}

function digestParts(domain: string, parts: readonly unknown[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify([domain, ...parts])).digest('hex')}`;
}

function canonicalText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Workroom human ingress ${field} must be canonical text`);
  }
}

function sha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Workroom human ingress ${field} must be a canonical SHA-256 digest`);
  }
}
