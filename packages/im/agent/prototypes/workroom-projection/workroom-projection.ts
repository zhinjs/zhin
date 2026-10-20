/**
 * PROTOTYPE — delete after decision-map ticket #5 is absorbed.
 *
 * Question: can canonical conversation bindings route chat/workroom/sponsor
 * before Agent trigger, while a deterministic outbox projects Kernel facts to
 * named-agent IM messages and a lossless Console timeline without making
 * delivery messages a second state authority?
 */

export type ConversationKind = 'private' | 'group' | 'channel';
export type InteractionSpace = 'chat' | 'workroom' | 'sponsor_room';
export type ProjectionSink = 'workroom_im' | 'sponsor_im' | 'console';

export interface ConversationAddress {
  readonly endpointOwner: string;
  readonly endpointId: string;
  readonly kind: ConversationKind;
  readonly id: string;
  readonly parentId?: string;
  readonly threadId?: string;
}

export interface SpaceBinding {
  readonly conversation: ConversationAddress;
  readonly space: InteractionSpace;
  readonly revision: number;
  readonly effectiveAfterConversationSequence: number;
  readonly projectId?: string;
  readonly sponsorRoomId?: string;
  readonly projectIds?: readonly string[];
}

export interface AgentProjectionIdentity {
  readonly agentDefinitionId: string;
  readonly displayName: string;
  readonly role: 'orchestrator' | 'executor' | 'reviewer';
  readonly aliases: readonly string[];
  readonly assignmentId?: string;
  readonly taskKey?: string;
  readonly taskRevision?: number;
}

export type ObservableFactType =
  | 'run.started'
  | 'task.started'
  | 'task.progress'
  | 'task.milestone'
  | 'task.blocked'
  | 'approval.requested'
  | 'task.report_submitted'
  | 'task.accepted'
  | 'task.rejected'
  | 'task.failed'
  | 'run.completed';

export interface ObservableKernelFact {
  readonly id: string;
  readonly sequence: number;
  readonly projectId: string;
  readonly runId: string;
  readonly type: ObservableFactType;
  readonly occurredAt: number;
  readonly text: string;
  readonly speaker: AgentProjectionIdentity;
  readonly taskKey?: string;
  readonly taskRevision?: number;
  readonly assignmentId?: string;
  readonly progress?: number;
  readonly disclosure: 'workroom' | 'sponsor' | 'both' | 'console_only';
}

export interface ProjectionTarget {
  readonly projectId: string;
  readonly runId?: string;
  readonly taskKey?: string;
  readonly taskRevision?: number;
  readonly assignmentId?: string;
  readonly agentDefinitionId?: string;
}

export interface ProjectionOutboxItem {
  readonly id: string;
  readonly sink: ProjectionSink;
  readonly bindingRevision?: number;
  readonly conversation?: ConversationAddress;
  readonly sourceFactIds: readonly string[];
  readonly sourceSequence: number;
  readonly speaker: AgentProjectionIdentity;
  readonly kind: 'status' | 'progress_digest' | 'attention' | 'conclusion' | 'portfolio_card';
  readonly content: string;
  readonly targets: readonly ProjectionTarget[];
  readonly deliveryStatus: 'pending' | 'sent' | 'failed';
  readonly attempts: number;
  readonly platformMessageId?: string;
  readonly failureCode?: string;
}

export interface ProjectionPolicy {
  readonly progressWindowSeconds: number;
}

export interface ProjectionState {
  readonly items: Readonly<Record<string, ProjectionOutboxItem>>;
  readonly messageIndex: Readonly<Record<string, ProjectionOutboxItem>>;
}

export interface InboundMessage {
  readonly conversation: ConversationAddress;
  readonly conversationSequence: number;
  readonly messageId: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly actorRoles: readonly string[];
  readonly text: string;
  readonly replyToMessageId?: string;
  readonly logicalMention?: string;
  readonly explicitProjectId?: string;
  readonly intent: 'discussion' | 'work_request' | 'control';
  readonly fromEndpointSelf?: boolean;
}

export type IngressDecision =
  | Readonly<{ route: 'chat'; reason: 'default_chat' }>
  | Readonly<{ route: 'ignored'; reason: 'projection_echo' | 'before_binding_anchor' }>
  | Readonly<{
      route: 'workroom_orchestrator';
      projectId: string;
      sourceMessageId: string;
      target: ProjectionTarget | Readonly<{ projectId: string; orchestrator: true }>;
      disposition: 'discussion' | 'accepted_context' | 'control_proposal';
      authority: 'sponsor' | 'participant';
      note: string;
    }>
  | Readonly<{
      route: 'sponsor_router';
      sourceMessageId: string;
      projectId?: string;
      disposition: 'read_query' | 'control_proposal' | 'rejected';
      note: string;
    }>
  | Readonly<{ route: 'needs_clarification'; sourceMessageId: string; candidates: readonly string[]; note: string }>;

const IMMEDIATE_WORKROOM = new Set<ObservableFactType>([
  'run.started',
  'task.started',
  'task.milestone',
  'task.blocked',
  'approval.requested',
  'task.report_submitted',
  'task.accepted',
  'task.rejected',
  'task.failed',
  'run.completed',
]);

const SPONSOR_VISIBLE = new Set<ObservableFactType>([
  'task.blocked',
  'approval.requested',
  'task.accepted',
  'task.failed',
  'run.completed',
]);

export function conversationKey(address: ConversationAddress): string {
  return [
    address.endpointOwner,
    address.endpointId,
    address.kind,
    address.id,
    address.parentId ?? '',
    address.threadId ?? '',
  ].join('\0');
}

export function validateBindings(bindings: readonly SpaceBinding[]): void {
  const seen = new Set<string>();
  for (const binding of bindings) {
    const key = conversationKey(binding.conversation);
    if (seen.has(key)) throw new Error(`conversation has more than one active Interaction Space: ${key}`);
    seen.add(key);
    if (binding.space === 'workroom' && !binding.projectId) throw new Error('workroom binding requires projectId');
    if (binding.space === 'sponsor_room' && (!binding.sponsorRoomId || !binding.projectIds?.length)) {
      throw new Error('sponsor_room binding requires sponsorRoomId and projectIds');
    }
  }
}

export function migrateBinding(
  bindings: readonly SpaceBinding[],
  conversation: ConversationAddress,
  next: Omit<SpaceBinding, 'conversation' | 'revision'>,
): readonly SpaceBinding[] {
  validateBindings(bindings);
  const key = conversationKey(conversation);
  const previous = bindings.find((binding) => conversationKey(binding.conversation) === key);
  const migrated = Object.freeze({
    ...next,
    conversation,
    revision: (previous?.revision ?? 0) + 1,
  });
  const result = Object.freeze([
    ...bindings.filter((binding) => conversationKey(binding.conversation) !== key),
    migrated,
  ]);
  validateBindings(result);
  return result;
}

export function projectObservableFacts(
  facts: readonly ObservableKernelFact[],
  bindings: readonly SpaceBinding[],
  policy: ProjectionPolicy,
  now: number,
): readonly ProjectionOutboxItem[] {
  validateBindings(bindings);
  const ordered = [...facts].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const items: ProjectionOutboxItem[] = ordered.map((fact) => consoleItem(fact));

  for (const binding of bindings.filter((candidate) => candidate.space === 'workroom')) {
    const projectFacts = ordered.filter((fact) => fact.projectId === binding.projectId);
    const immediate = projectFacts.filter((fact) => fact.type !== 'task.progress' && IMMEDIATE_WORKROOM.has(fact.type));
    for (const fact of immediate) {
      if (fact.disclosure === 'console_only' || fact.disclosure === 'sponsor') continue;
      items.push(imItem(binding, fact, [fact], kindForFact(fact.type)));
    }
    const progressGroups = new Map<string, ObservableKernelFact[]>();
    for (const fact of projectFacts.filter((candidate) => candidate.type === 'task.progress')) {
      if (fact.disclosure === 'console_only' || fact.disclosure === 'sponsor') continue;
      const bucket = Math.floor(fact.occurredAt / policy.progressWindowSeconds);
      const key = `${fact.runId}:${fact.taskKey ?? ''}:${fact.taskRevision ?? 0}:window:${bucket}`;
      const group = progressGroups.get(key) ?? [];
      group.push(fact);
      progressGroups.set(key, group);
    }
    for (const group of progressGroups.values()) {
      const latest = group.at(-1)!;
      const windowEnd = (Math.floor(latest.occurredAt / policy.progressWindowSeconds) + 1)
        * policy.progressWindowSeconds;
      const hasLaterAttention = immediate.some((fact) => sameTask(fact, latest) && fact.sequence > latest.sequence);
      if (hasLaterAttention || now < windowEnd) continue;
      items.push(imItem(binding, latest, group, 'progress_digest'));
    }
  }

  for (const binding of bindings.filter((candidate) => candidate.space === 'sponsor_room')) {
    for (const fact of ordered) {
      if (!binding.projectIds?.includes(fact.projectId) || !SPONSOR_VISIBLE.has(fact.type)) continue;
      if (fact.disclosure === 'console_only' || fact.disclosure === 'workroom') continue;
      items.push(imItem(binding, fact, [fact], 'portfolio_card'));
    }
  }
  return Object.freeze(items.sort((left, right) => left.sourceSequence - right.sourceSequence || left.id.localeCompare(right.id)));
}

export function initialiseProjectionState(items: readonly ProjectionOutboxItem[]): ProjectionState {
  return Object.freeze({
    items: Object.freeze(Object.fromEntries(items.map((item) => [item.id, item]))),
    messageIndex: Object.freeze({}),
  });
}

export function applyDeliveryResult(
  state: ProjectionState,
  itemId: string,
  result: Readonly<{ status: 'sent'; platformMessageId: string } | { status: 'failed'; code: string }>,
): ProjectionState {
  const current = state.items[itemId];
  if (!current) throw new Error(`unknown projection item: ${itemId}`);
  if (current.sink === 'console') throw new Error('Console timeline is a local read model, not an IM delivery');
  const nextItem: ProjectionOutboxItem = result.status === 'sent'
    ? { ...current, deliveryStatus: 'sent', attempts: current.attempts + 1, platformMessageId: result.platformMessageId }
    : { ...current, deliveryStatus: 'failed', attempts: current.attempts + 1, failureCode: result.code };
  const items = Object.freeze({ ...state.items, [itemId]: Object.freeze(nextItem) });
  const messageIndex = result.status === 'sent' && current.conversation
    ? Object.freeze({
        ...state.messageIndex,
        [messageIndexKey(current.conversation, result.platformMessageId)]: Object.freeze(nextItem),
      })
    : state.messageIndex;
  return Object.freeze({ items, messageIndex });
}

export function retryDelivery(state: ProjectionState, itemId: string): ProjectionState {
  const current = state.items[itemId];
  if (!current || current.deliveryStatus !== 'failed') throw new Error('only failed delivery can be retried');
  return Object.freeze({
    ...state,
    items: Object.freeze({
      ...state.items,
      [itemId]: Object.freeze({ ...current, deliveryStatus: 'pending', failureCode: undefined }),
    }),
  });
}

export function routeInbound(
  bindings: readonly SpaceBinding[],
  agentsByProject: Readonly<Record<string, readonly AgentProjectionIdentity[]>>,
  projection: ProjectionState,
  input: InboundMessage,
): IngressDecision {
  validateBindings(bindings);
  const binding = bindings.find((candidate) => conversationKey(candidate.conversation) === conversationKey(input.conversation));
  if (!binding) return Object.freeze({ route: 'chat', reason: 'default_chat' });
  if (input.conversationSequence <= binding.effectiveAfterConversationSequence) {
    return Object.freeze({ route: 'ignored', reason: 'before_binding_anchor' });
  }
  if (binding.space === 'chat') return Object.freeze({ route: 'chat', reason: 'default_chat' });
  const knownEcho = projection.messageIndex[messageIndexKey(input.conversation, input.messageId)];
  if (input.fromEndpointSelf || knownEcho) return Object.freeze({ route: 'ignored', reason: 'projection_echo' });
  if (binding.space === 'workroom') {
    return routeWorkroom(binding, agentsByProject[binding.projectId!] ?? [], projection, input);
  }
  return routeSponsor(binding, projection, input);
}

function routeWorkroom(
  binding: SpaceBinding,
  agents: readonly AgentProjectionIdentity[],
  projection: ProjectionState,
  input: InboundMessage,
): IngressDecision {
  const projectId = binding.projectId!;
  const replyItem = input.replyToMessageId
    ? projection.messageIndex[messageIndexKey(input.conversation, input.replyToMessageId)]
    : undefined;
  if (replyItem) {
    const candidates = uniqueTargets(replyItem.targets.filter((target) => target.projectId === projectId));
    if (candidates.length !== 1) {
      return clarification(input, candidates.map(targetLabel), 'reply points to an aggregate projection');
    }
    const target = candidates[0]!;
    const active = !target.assignmentId || agents.some((agent) =>
      agent.assignmentId === target.assignmentId
      && agent.taskKey === target.taskKey
      && agent.taskRevision === target.taskRevision);
    return workroomDecision(
      input,
      projectId,
      target,
      active
        ? 'reply provenance resolved an exact active Kernel target'
        : 'reply provenance resolved a historical target; Orchestrator must consider rework/new Task',
      active ? undefined : 'discussion',
    );
  }
  if (input.logicalMention) {
    const alias = normalizeAlias(input.logicalMention);
    const matches = agents.filter((agent) => [agent.agentDefinitionId, ...agent.aliases]
      .some((candidate) => normalizeAlias(candidate) === alias));
    if (matches.length !== 1) {
      return clarification(input, matches.map((agent) => agent.assignmentId ?? agent.agentDefinitionId),
        matches.length === 0 ? 'logical Agent alias was not found' : 'logical Agent alias is ambiguous');
    }
    const agent = matches[0]!;
    return workroomDecision(input, projectId, {
      projectId,
      ...(agent.taskKey ? { taskKey: agent.taskKey } : {}),
      ...(agent.taskRevision ? { taskRevision: agent.taskRevision } : {}),
      ...(agent.assignmentId ? { assignmentId: agent.assignmentId } : {}),
      agentDefinitionId: agent.agentDefinitionId,
    }, 'logical Agent alias resolved through the Project Agent Directory');
  }
  return workroomDecision(input, projectId, { projectId, orchestrator: true },
    'unaddressed Workroom input enters only the Orchestrator inbox');
}

function routeSponsor(
  binding: SpaceBinding,
  projection: ProjectionState,
  input: InboundMessage,
): IngressDecision {
  const replyItem = input.replyToMessageId
    ? projection.messageIndex[messageIndexKey(input.conversation, input.replyToMessageId)]
    : undefined;
  const replyProjects = uniqueStrings(replyItem?.targets.map((target) => target.projectId) ?? []);
  const explicit = input.explicitProjectId;
  if (explicit && !binding.projectIds?.includes(explicit)) {
    return Object.freeze({
      route: 'sponsor_router',
      sourceMessageId: input.messageId,
      disposition: 'rejected',
      note: 'explicit project is outside this Sponsor Room portfolio',
    });
  }
  if (explicit && replyProjects.length > 0 && !replyProjects.includes(explicit)) {
    return clarification(input, replyProjects, 'explicit project conflicts with replied projection');
  }
  const candidates = explicit ? [explicit] : replyProjects;
  if (input.intent === 'control' && candidates.length !== 1) {
    return clarification(input, candidates.length > 0 ? candidates : binding.projectIds ?? [],
      'Sponsor write requires exactly one explicit or reply-derived project');
  }
  const projectId = candidates.length === 1 ? candidates[0] : undefined;
  const isSponsor = input.actorRoles.includes('sponsor');
  return Object.freeze({
    route: 'sponsor_router',
    sourceMessageId: input.messageId,
    ...(projectId ? { projectId } : {}),
    disposition: input.intent === 'control'
      ? isSponsor ? 'control_proposal' : 'rejected'
      : 'read_query',
    note: input.intent === 'control'
      ? isSponsor ? 'authorized control is proposed to the target Project Kernel' : 'participant cannot control Project state'
      : 'Sponsor Room query reads portfolio projections only',
  });
}

function workroomDecision(
  input: InboundMessage,
  projectId: string,
  target: ProjectionTarget | Readonly<{ projectId: string; orchestrator: true }>,
  note: string,
  forcedDisposition?: 'discussion' | 'accepted_context' | 'control_proposal',
): IngressDecision {
  const authority = input.actorRoles.includes('sponsor') ? 'sponsor' : 'participant';
  return Object.freeze({
    route: 'workroom_orchestrator',
    projectId,
    sourceMessageId: input.messageId,
    target,
    disposition: forcedDisposition ?? (input.intent === 'control' && authority === 'sponsor'
      ? 'control_proposal'
      : 'assignmentId' in target ? 'accepted_context' : 'discussion'),
    authority,
    note: `${note}; no specialist Turn is started directly`,
  });
}

function clarification(input: InboundMessage, candidates: readonly string[], note: string): IngressDecision {
  return Object.freeze({
    route: 'needs_clarification',
    sourceMessageId: input.messageId,
    candidates: Object.freeze([...candidates]),
    note,
  });
}

function consoleItem(fact: ObservableKernelFact): ProjectionOutboxItem {
  return Object.freeze({
    id: `console:${fact.id}`,
    sink: 'console',
    sourceFactIds: [fact.id],
    sourceSequence: fact.sequence,
    speaker: fact.speaker,
    kind: kindForFact(fact.type),
    content: fact.text,
    targets: [targetForFact(fact)],
    deliveryStatus: 'sent',
    attempts: 0,
  });
}

function imItem(
  binding: SpaceBinding,
  representative: ObservableKernelFact,
  sources: readonly ObservableKernelFact[],
  kind: ProjectionOutboxItem['kind'],
): ProjectionOutboxItem {
  const sink: ProjectionSink = binding.space === 'workroom' ? 'workroom_im' : 'sponsor_im';
  const sourceFactIds = sources.map((fact) => fact.id);
  const prefix = `[${representative.speaker.displayName} · ${representative.speaker.role}]`;
  const content = kind === 'progress_digest'
    ? `${prefix} ${representative.taskKey ?? 'task'} 进度 ${representative.progress ?? '?'}%：${representative.text}`
    : `${prefix} ${representative.text}`;
  return Object.freeze({
    id: `${sink}:b${binding.revision}:${sourceFactIds.join('+')}`,
    sink,
    bindingRevision: binding.revision,
    conversation: binding.conversation,
    sourceFactIds: Object.freeze(sourceFactIds),
    sourceSequence: representative.sequence,
    speaker: representative.speaker,
    kind,
    content,
    targets: Object.freeze(sources.map(targetForFact)),
    deliveryStatus: 'pending',
    attempts: 0,
  });
}

function targetForFact(fact: ObservableKernelFact): ProjectionTarget {
  return Object.freeze({
    projectId: fact.projectId,
    runId: fact.runId,
    ...(fact.taskKey ? { taskKey: fact.taskKey } : {}),
    ...(fact.taskRevision ? { taskRevision: fact.taskRevision } : {}),
    ...(fact.assignmentId ? { assignmentId: fact.assignmentId } : {}),
    agentDefinitionId: fact.speaker.agentDefinitionId,
  });
}

function kindForFact(type: ObservableFactType): ProjectionOutboxItem['kind'] {
  if (type === 'task.progress') return 'progress_digest';
  if (type === 'task.blocked' || type === 'approval.requested' || type === 'task.failed') return 'attention';
  if (type === 'task.accepted' || type === 'run.completed') return 'conclusion';
  return 'status';
}

function sameTask(left: ObservableKernelFact, right: ObservableKernelFact): boolean {
  return left.projectId === right.projectId
    && left.runId === right.runId
    && left.taskKey === right.taskKey
    && left.taskRevision === right.taskRevision;
}

function messageIndexKey(conversation: ConversationAddress, messageId: string): string {
  return `${conversationKey(conversation)}\0${messageId}`;
}

function normalizeAlias(value: string): string {
  return value.trim().replace(/^@/u, '').toLocaleLowerCase();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueTargets(values: readonly ProjectionTarget[]): ProjectionTarget[] {
  return [...new Map(values.map((target) => [JSON.stringify(target), target])).values()];
}

function targetLabel(target: ProjectionTarget): string {
  return target.assignmentId ?? target.taskKey ?? target.projectId;
}
