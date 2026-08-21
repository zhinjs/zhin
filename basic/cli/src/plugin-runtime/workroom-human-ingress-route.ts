import { createHash } from 'node:crypto';
import type { Message } from '@zhin.js/core/runtime';
import {
  HumanIngressProposalSequenceConflictError,
  HumanIngressProposalService,
  InteractionSpaceBindingService,
  type HumanIngressIntent,
  type HumanIngressProposalRepository,
  type HumanPrincipalSnapshot,
  type InteractionSpace,
  type InteractionSpaceBindingRepository,
  type InteractionSpaceRouter,
} from '@zhin.js/agent';
import {
  conversationRefKey,
  messageRefKey,
} from '@zhin.js/im-contract';

export interface CatalogWorkroomSpaceInput {
  readonly projectId: string;
  readonly agentDefinitionId: string;
  readonly space: Exclude<InteractionSpace, 'chat'>;
  readonly sourceRef: string;
  readonly sourceDigest: string;
}

export type CatalogWorkroomSpace = Readonly<CatalogWorkroomSpaceInput>;

export interface WorkroomHumanIngressPreRouteOptions {
  readonly bindings: InteractionSpaceBindingRepository;
  readonly bindingRouter: InteractionSpaceRouter;
  readonly proposals: HumanIngressProposalRepository;
  readonly resolveCatalogSpace: (message: Message) => CatalogWorkroomSpace | null | Promise<CatalogWorkroomSpace | null>;
  readonly resolveIntent?: (message: Message) => HumanIngressIntent;
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
  constructor(readonly options: WorkroomHumanIngressPreRouteOptions) {}

  async preRoute(message: Message, conversationSequence: number | undefined): Promise<boolean> {
    const configured = await this.options.resolveCatalogSpace(message);
    const conversationKey = conversationRefKey(message.conversation);
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
    if (!message.message || !message.sender?.id) {
      throw new Error('Workroom human ingress requires durable message and human principal identity');
    }

    const input = Object.freeze({
      decision: Object.freeze({ ...decision, space: boundSpace, projectId: decision.projectId }),
      sourceEvent: Object.freeze({
        version: 1 as const,
        ref: `conversation-event:${messageRefKey(message.message)}`,
        digest: digestParts('workroom-human-source-v1', [
          messageRefKey(message.message),
          sequence,
          conversationKey,
        ]),
        sequence,
        conversation: message.conversation,
      }),
      principal: createHumanPrincipal(message, this.options.principalOwner),
      ...(configured?.agentDefinitionId
        ? { entryAgentDefinitionId: configured.agentDefinitionId }
        : {}),
    });
    const intent = this.options.resolveIntent?.(message) ?? 'work_request';
    const resolverRef = 'workroom-human-target-resolver:unaddressed:v1';
    const resolverDigest = digestParts(resolverRef, ['unaddressed', intent]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const service = new HumanIngressProposalService(this.options.proposals, {
        resolve: request => Object.freeze({
          ...request,
          status: 'unaddressed' as const,
          intent,
          resolverRef,
          resolverDigest,
        }),
      });
      try {
        await service.propose(input);
        return true;
      } catch (error) {
        const concurrent = error instanceof HumanIngressProposalSequenceConflictError
          || (error instanceof Error
            && error.message === 'Human ingress proposal repository replay payload drift');
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
