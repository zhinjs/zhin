import { createHash } from 'node:crypto';
import type { Message } from '@zhin.js/core/runtime';
import {
  FileWorkroomProjectionRepository,
  WorkroomProjectionRevisionConflictError,
  validateWorkroomDefinitions,
  workroomProjectionBindingKey,
  workroomProjectionMessageKey,
  type WorkroomCatalog,
  type WorkroomCatalogSnapshot,
  type WorkroomDefinition,
  type WorkroomMemberRole,
  type WorkroomProjectionBinding,
  type WorkroomProjectionRepository,
  type HumanIngressTargetResolverPort,
  type HumanIngressTargetResolutionRequest,
} from '@zhin.js/agent';
import { workroomProjectionCatalogBindingDigest } from '@zhin.js/agent/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';

interface RuntimeEndpointIdentity {
  readonly id: string;
  readonly name: string;
  readonly adapter: string;
  readonly owner: string;
}

export function classifyWorkroomIngressSource(
  definition: WorkroomDefinition,
  input: Readonly<{
    adapter: string;
    endpoint: string;
    senderId: string;
    space: 'workroom' | 'sponsor_room';
    replySpeakerAgent?: string;
    replySpeakerRole?: WorkroomMemberRole;
    mentioned?: boolean;
    trustedSenderIsBot?: boolean;
  }>,
): 'accept' | 'bot_principal' | 'non_owner_endpoint' {
  const botEndpoints = [
    definition.conversation,
    definition.sponsorConversation,
    ...definition.members.map(member => member.messageRoute),
  ].filter((route): route is NonNullable<typeof route> => route != null);
  // Adapter endpoint names and sender principals live in different namespaces.
  // Numeric IM adapters (ICQQ/OneBot) conventionally use the Bot UIN as both;
  // other adapters may provide a typed trusted claim from their Endpoint boundary;
  // generic Message.metadata is never promoted into this field.
  if (input.trustedSenderIsBot || (/^\d+$/u.test(input.senderId) && botEndpoints.some(route =>
    route.adapter === input.adapter && route.endpoint === input.senderId))) {
    return 'bot_principal';
  }

  if (input.space !== 'workroom') return 'accept';
  const primary = definition.conversation?.adapter === input.adapter
    && definition.conversation.endpoint === input.endpoint;
  const routedMember = definition.members.find(member =>
    member.messageRoute?.adapter === input.adapter
    && member.messageRoute.endpoint === input.endpoint);
  if (input.replySpeakerAgent) {
    const speaker = definition.members.find(member =>
      member.agent === input.replySpeakerAgent
      && (input.replySpeakerRole == null || member.role === input.replySpeakerRole));
    const expectedRoute = speaker?.messageRoute ?? definition.conversation;
    return expectedRoute?.adapter === input.adapter && expectedRoute.endpoint === input.endpoint
      ? 'accept'
      : 'non_owner_endpoint';
  }
  return primary || (input.mentioned === true && routedMember != null)
    ? 'accept'
    : 'non_owner_endpoint';
}

/** Resolves reply provenance across Bot Endpoints that share one room. */
export function resolveIndexedProjectionReply<
  T extends Readonly<{ message: NonNullable<Message['message']> }>,
>(
  message: Pick<Message, 'conversation' | 'replyTo'>,
  messageIndex: Readonly<Record<string, T>>,
): T | undefined {
  if (!message.replyTo) return undefined;
  const exact = messageIndex[workroomProjectionMessageKey({
    conversation: message.conversation,
    id: message.replyTo.id,
  })];
  if (exact) return exact;
  const roomMatches = Object.values(messageIndex).filter(entry =>
    entry.message.id === message.replyTo!.id
    && entry.message.conversation.endpoint.adapter === message.conversation.endpoint.adapter
    && entry.message.conversation.kind === message.conversation.kind
    && entry.message.conversation.id === message.conversation.id);
  return roomMatches.length === 1 ? roomMatches[0] : undefined;
}

export async function assertWorkroomCatalogMatchesGeneration(
  catalog: Pick<WorkroomCatalog, 'read'>,
  agentNames: readonly string[],
  endpointKeys?: ReadonlySet<string>,
): Promise<void> {
  const snapshot = await catalog.read();
  // Endpoint keys come from the candidate config document. ImRuntime still
  // exposes the previously committed Adapter projection during root install.
  const errors = validateWorkroomDefinitions(snapshot.definitions, agentNames, endpointKeys);
  if (errors.length > 0) {
    throw new Error(`Persisted Workroom Catalog is incompatible with this Agent generation: ${errors.join('; ')}`);
  }
}

/** Catalog supplies role identity; authenticated ingress supplies the canonical EndpointRef. */
export function createCatalogWorkroomProjectionBinding(
  catalog: WorkroomCatalogSnapshot,
  projectId: string,
  conversation: ConversationRef,
  bindingRevision: number,
  endpoints: readonly RuntimeEndpointIdentity[] = [],
): WorkroomProjectionBinding {
  return createCatalogProjectionBinding(
    catalog, projectId, conversation, bindingRevision, 'workroom', endpoints,
  );
}

export async function ensureCatalogWorkroomProjectionBinding(options: Readonly<{
  repository: Pick<WorkroomProjectionRepository, 'read' | 'bind'>;
  catalog: WorkroomCatalogSnapshot;
  projectId: string;
  conversation: ConversationRef;
  interactionBindingRevision: number;
  endpoints?: readonly RuntimeEndpointIdentity[];
}>): Promise<WorkroomProjectionBinding> {
  for (let conflict = 0; conflict < 8; conflict += 1) {
    const state = await options.repository.read();
    const current = state.bindings[workroomProjectionBindingKey(options.projectId, 'workroom')];
    const desiredRevision = current
      ? Math.max(current.bindingRevision, options.interactionBindingRevision)
      : options.interactionBindingRevision;
    let exact = createCatalogWorkroomProjectionBinding(
      options.catalog,
      options.projectId,
      options.conversation,
      desiredRevision,
      options.endpoints,
    );
    if (current && digestProjectionValue(current) === digestProjectionValue(exact)) return current;
    if (current) {
      exact = createCatalogWorkroomProjectionBinding(
        options.catalog,
        options.projectId,
        options.conversation,
        Math.max(current.bindingRevision + 1, options.interactionBindingRevision),
        options.endpoints,
      );
    }
    try {
      const next = await options.repository.bind(state.revision, exact);
      return next.bindings[workroomProjectionBindingKey(options.projectId, 'workroom')]!;
    } catch (error) {
      if (!(error instanceof WorkroomProjectionRevisionConflictError) || conflict === 7) throw error;
    }
  }
  throw new Error('Workroom Projection binding CAS retries exhausted');
}

export function createCatalogSponsorRoomProjectionBinding(
  catalog: WorkroomCatalogSnapshot,
  projectId: string,
  conversation: ConversationRef,
  bindingRevision: number,
): WorkroomProjectionBinding {
  return createCatalogProjectionBinding(catalog, projectId, conversation, bindingRevision, 'sponsor_room');
}

/** Resolves a persisted Sponsor Room to one exact current Endpoint capability. */
export function resolveCatalogSponsorProjectionConversation(
  definition: WorkroomDefinition,
  endpoints: readonly RuntimeEndpointIdentity[],
): WorkroomProjectionBinding['conversation'] | undefined {
  return resolveCatalogProjectionConversation(definition.sponsorConversation, endpoints);
}

/** Resolves a persisted Workroom conversation to one exact current Endpoint capability. */
export function resolveCatalogWorkroomProjectionConversation(
  definition: WorkroomDefinition,
  endpoints: readonly RuntimeEndpointIdentity[],
): WorkroomProjectionBinding['conversation'] | undefined {
  return resolveCatalogProjectionConversation(definition.conversation, endpoints);
}

function resolveCatalogProjectionConversation(
  configured: WorkroomDefinition['conversation'] | WorkroomDefinition['sponsorConversation'],
  endpoints: readonly RuntimeEndpointIdentity[],
): WorkroomProjectionBinding['conversation'] | undefined {
  if (!configured || configured.kind === 'repository') return undefined;
  const matches = endpoints.filter(endpoint =>
    endpoint.adapter === configured.adapter && endpoint.name === configured.endpoint);
  if (matches.length !== 1) return undefined;
  const endpoint = matches[0]!;
  return Object.freeze({
    endpoint: Object.freeze({ id: endpoint.id, adapter: endpoint.owner }),
    kind: configured.kind,
    id: configured.id,
  });
}

function createCatalogProjectionBinding(
  catalog: WorkroomCatalogSnapshot,
  projectId: string,
  conversation: ConversationRef,
  bindingRevision: number,
  audience: 'workroom' | 'sponsor_room',
  endpoints: readonly RuntimeEndpointIdentity[] = [],
): WorkroomProjectionBinding {
  const definition = catalog.definitions[projectId];
  const configured = audience === 'workroom'
    ? definition?.conversation
    : definition?.sponsorConversation;
  if (!definition || !configured || definition.enabled === false) {
    throw new Error(`Workroom Projection requires an enabled Catalog binding for ${projectId}`);
  }
  if (configured.kind === 'repository'
    || configured.kind !== conversation.kind
    || configured.id !== conversation.id) {
    throw new Error(`Workroom Projection canonical conversation does not match Catalog ${projectId}`);
  }
  const orchestratorMember = definition.members.find(member =>
    member.agent === configured.agent && member.role === 'orchestrator');
  if (!orchestratorMember) {
    throw new Error(`Workroom Projection Catalog ${projectId} has no exact Orchestrator`);
  }
  const resolveMessageEndpoint = (member: (typeof definition.members)[number]) => {
    if (audience !== 'workroom' || !member.messageRoute) return undefined;
    const matches = endpoints.filter(endpoint => endpoint.adapter === member.messageRoute!.adapter
      && endpoint.name === member.messageRoute!.endpoint);
    if (matches.length !== 1) {
      throw new Error(
        `Workroom Projection member ${member.agent} messageRoute is not one exact Endpoint`,
      );
    }
    return Object.freeze({ id: matches[0]!.id, adapter: matches[0]!.owner });
  };
  const identity = (member: (typeof definition.members)[number]) => {
    const messageEndpoint = resolveMessageEndpoint(member);
    return Object.freeze({
      principalId: member.agent,
      agentDefinitionId: member.agent,
      displayName: member.agent,
      role: member.role,
      ...(messageEndpoint ? { messageEndpoint } : {}),
    });
  };
  const primaryEndpoint = audience === 'workroom' && endpoints.length > 0
    ? endpoints.filter(endpoint => endpoint.adapter === configured.adapter
      && endpoint.name === configured.endpoint)
    : [];
  if (audience === 'workroom' && endpoints.length > 0 && primaryEndpoint.length !== 1) {
    throw new Error(`Workroom Projection Catalog ${projectId} primary Endpoint is unavailable`);
  }
  const projectionConversation = primaryEndpoint.length === 1
    ? Object.freeze({
        ...structuredClone(conversation),
        endpoint: Object.freeze({
          id: primaryEndpoint[0]!.id,
          adapter: primaryEndpoint[0]!.owner,
        }),
      })
    : Object.freeze(structuredClone(conversation));
  return Object.freeze({
    version: 1,
    audience,
    projectId,
    catalogBindingDigest: workroomProjectionCatalogBindingDigest(definition),
    bindingRevision,
    projectionPolicyRevision: 1,
    conversation: projectionConversation,
    orchestrator: identity(orchestratorMember) as WorkroomProjectionBinding['orchestrator'],
    agents: Object.freeze(definition.members
      .filter(member => member !== orchestratorMember)
      .map(identity)) as WorkroomProjectionBinding['agents'],
  });
}

/** Portfolio Sponsor Rooms require the Project to be explicit in typed control text. */
export function sponsorRoomProjectId(content: string): string | undefined {
  const text = content.trim();
  const lifecycle = /^\/control\s+data-lifecycle\s+project\s+([a-z0-9][a-z0-9_-]{0,63})(?:\s|$)/iu.exec(text);
  if (lifecycle?.[1]) return lifecycle[1].toLowerCase();
  const portfolio = /^\/control\s+portfolio\s+\S+\s+project\s+([a-z0-9][a-z0-9_-]{0,63})(?:\s|$)/iu.exec(text);
  return portfolio?.[1]?.toLowerCase();
}

export function catalogSpaceSourceDigest(
  projectId: string,
  space: 'workroom' | 'sponsor_room',
  configured: Readonly<{
    adapter: string;
    endpoint: string;
    kind: 'group' | 'channel' | 'repository';
    id: string;
    agent: string;
  }>,
): string {
  const binding = [
    projectId,
    configured.adapter,
    configured.endpoint,
    configured.kind,
    configured.id,
    configured.agent,
  ];
  return `sha256:${createHash('sha256').update(JSON.stringify(
    space === 'workroom' ? binding : [projectId, space, ...binding.slice(1)],
  )).digest('hex')}`;
}

export function createSponsorProjectionControlTargetResolver(options: Readonly<{
  projectionRepository: Pick<FileWorkroomProjectionRepository, 'read'>;
  message: Message;
  intent: 'control';
}>): HumanIngressTargetResolverPort {
  return Object.freeze({
    async resolve(request: HumanIngressTargetResolutionRequest) {
      const resolverRef = 'sponsor-projection-message-index:v1';
      if (!options.message.replyTo) {
        return Object.freeze({
          ...request,
          status: 'unaddressed' as const,
          intent: options.intent,
          resolverRef,
          resolverDigest: digestProjectionValue({
            resolverRef,
            intent: options.intent,
            status: 'unaddressed',
          }),
        });
      }
      const messageKey = workroomProjectionMessageKey({
        conversation: options.message.conversation,
        id: options.message.replyTo.id,
      });
      const state = await options.projectionRepository.read();
      const entry = state.messageIndex[messageKey];
      if (!entry || entry.target.projectId !== request.decision.projectId
        || entry.bindingRevision !== request.decision.bindingRevision) {
        const candidateRefs = entry ? [entry.projectionId] : [];
        return Object.freeze({
          ...request,
          status: 'clarification_required' as const,
          intent: options.intent,
          resolverRef,
          resolverDigest: digestProjectionValue({
            resolverRef,
            intent: options.intent,
            status: 'clarification_required',
            messageKey,
            candidateRefs,
          }),
          reason: entry && entry.target.projectId !== request.decision.projectId
            ? 'cross_project_target' as const
            : 'target_not_found' as const,
          candidateRefs: Object.freeze(candidateRefs),
        });
      }
      const projectionReply = Object.freeze({
        version: 1 as const,
        projectionId: entry.projectionId,
        projectId: entry.target.projectId,
        bindingRevision: entry.bindingRevision,
        messageKey,
        targetDigest: digestProjectionValue(entry.target),
      });
      return Object.freeze({
        ...request,
        status: 'unaddressed' as const,
        intent: options.intent,
        resolverRef,
        resolverDigest: digestProjectionValue({
          resolverRef,
          intent: options.intent,
          status: 'unaddressed',
          projectionReply,
        }),
        projectionReply,
      });
    },
  });
}

function digestProjectionValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
