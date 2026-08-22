import {
  canonicalWorkroomJson as stableJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import type { InteractionSpaceDecision } from './interaction-space-router.js';
import {
  conversationRefKey,
  type ConversationRef,
} from '@zhin.js/im-contract';

export type HumanIngressIntent = 'discussion' | 'work_request' | 'control';

export type HumanIngressSpaceDecision = Readonly<
Extract<InteractionSpaceDecision, { status: 'resolved'; source: 'binding' }>
& { readonly space: 'workroom' | 'sponsor_room'; readonly projectId: string }
>;

export interface HumanIngressConversationEventRef {
  readonly version: 1;
  readonly ref: string;
  readonly digest: string;
  readonly sequence: number;
  readonly conversation: ConversationRef;
}

export interface HumanPrincipalSnapshot {
  readonly version: 1;
  readonly ref: string;
  readonly revision: number;
  readonly digest: string;
  readonly principalId: string;
  readonly subjectId: string;
  readonly kind: 'human';
}

export interface HumanIngressProposalInput {
  readonly decision: HumanIngressSpaceDecision;
  readonly sourceEvent: HumanIngressConversationEventRef;
  readonly principal: HumanPrincipalSnapshot;
  /** Catalog-selected Agent definition that owns the Project Inbox. */
  readonly entryAgentDefinitionId?: string;
}

export type HumanIngressTargetResolutionRequest = Readonly<HumanIngressProposalInput>;

export interface HumanIngressTaskTarget {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId?: string;
  readonly assignmentRevision?: number;
  readonly agentDefinitionId?: string;
  readonly status: 'active' | 'historical';
}

/** Durable proof that a Sponsor control replied to a governed single-Project projection. */
export interface HumanIngressProjectionReplyProof {
  readonly version: 1;
  readonly projectionId: string;
  readonly projectId: string;
  readonly bindingRevision: number;
  readonly messageKey: string;
  readonly targetDigest: string;
}

interface HumanIngressTargetResolutionEcho extends HumanIngressTargetResolutionRequest {
  readonly intent: HumanIngressIntent;
  readonly resolverRef: string;
  readonly resolverDigest: string;
}

export type HumanIngressTargetResolution =
  | Readonly<HumanIngressTargetResolutionEcho & {
      readonly status: 'unaddressed';
      readonly projectionReply?: HumanIngressProjectionReplyProof;
    }>
  | Readonly<HumanIngressTargetResolutionEcho & {
      readonly status: 'task_target';
      readonly via: 'reply' | 'mention';
      readonly target: HumanIngressTaskTarget;
    }>
  | Readonly<HumanIngressTargetResolutionEcho & {
      readonly status: 'clarification_required';
      readonly reason: 'target_not_found' | 'ambiguous_target' | 'cross_project_target';
      readonly candidateRefs: readonly string[];
    }>;

export interface HumanIngressTargetResolverPort {
  resolve(
    request: HumanIngressTargetResolutionRequest,
  ): HumanIngressTargetResolution | Promise<HumanIngressTargetResolution>;
}

export interface HumanIngressSourceAnchor {
  readonly ref: string;
  readonly digest: string;
  readonly sequence: number;
  readonly conversationKey: string;
}

export interface HumanIngressPrincipalReference {
  readonly ref: string;
  readonly revision: number;
  readonly digest: string;
  readonly principalId: string;
  readonly subjectId: string;
}

export type HumanIngressAuthorityRequirement =
  | 'none'
  | 'workroom_control'
  | 'typed_sponsor_control';

interface HumanIngressProposalBase {
  readonly version: 1;
  readonly id: string;
  readonly digest: string;
  readonly status: 'proposed';
  readonly projectId: string;
  readonly space: 'workroom' | 'sponsor_room';
  readonly bindingRevision: number;
  readonly bindingDigest: string;
  readonly sourceEvent: HumanIngressSourceAnchor;
  readonly principal: HumanIngressPrincipalReference;
  readonly intent: HumanIngressIntent;
  readonly resolverRef: string;
  readonly resolverDigest: string;
  readonly authorityRequirement: HumanIngressAuthorityRequirement;
  readonly projectionReply?: HumanIngressProjectionReplyProof;
}

export interface ProjectInboxProposal extends HumanIngressProposalBase {
  readonly kind: 'project_inbox';
  readonly target: Readonly<{
    readonly orchestrator: true;
    readonly agentDefinitionId?: string;
  }>;
}

export interface TaskInputProposal extends HumanIngressProposalBase {
  readonly kind: 'task_input';
  readonly via: 'reply' | 'mention';
  readonly target: HumanIngressTaskTarget;
  readonly disposition: 'context_proposal' | 'discussion_only';
}

export type HumanIngressProposal = ProjectInboxProposal | TaskInputProposal;

export interface HumanIngressProposalEventDraft {
  readonly eventId: string;
  readonly type: 'project_inbox.proposed' | 'task_input.proposed';
  readonly proposal: HumanIngressProposal;
}

export interface HumanIngressProposalEvent extends HumanIngressProposalEventDraft {
  readonly version: 1;
  readonly projectId: string;
  readonly sequence: number;
  readonly digest: string;
}

export interface HumanIngressProposalProjection {
  readonly version: 1;
  readonly projectId: string;
  readonly sequence: number;
  readonly inbox: readonly ProjectInboxProposal[];
  readonly taskInputs: readonly TaskInputProposal[];
}

export interface HumanIngressProposalRepository {
  read(projectId: string): Promise<readonly HumanIngressProposalEvent[]>;
  append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly HumanIngressProposalEventDraft[],
  ): Promise<readonly HumanIngressProposalEvent[]>;
}

export class HumanIngressProposalSequenceConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(`Human ingress ${projectId} sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`);
    this.name = 'HumanIngressProposalSequenceConflictError';
  }
}

export class HumanIngressProposalReplayConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly proposalId?: string,
  ) {
    super(`Human ingress ${projectId} replay payload drift${proposalId ? `: ${proposalId}` : ''}`);
    this.name = 'HumanIngressProposalReplayConflictError';
  }
}

/**
 * Contract adapter for tests and embedders. This adapter is process-local and
 * is explicitly not a production-durable Workroom Inbox.
 */
export class MemoryHumanIngressProposalRepository implements HumanIngressProposalRepository {
  readonly #events = new Map<string, readonly HumanIngressProposalEvent[]>();

  async read(projectId: string): Promise<readonly HumanIngressProposalEvent[]> {
    const id = canonicalText(projectId, 'projectId');
    return normalizeEvents(id, this.#events.get(id) ?? []);
  }

  async append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly HumanIngressProposalEventDraft[],
  ): Promise<readonly HumanIngressProposalEvent[]> {
    const id = canonicalText(projectId, 'projectId');
    const current = normalizeEvents(id, this.#events.get(id) ?? []);
    const appended = materializeAppend(id, current, expectedSequence, drafts);
    if (appended.some(event => event.sequence > (current.at(-1)?.sequence ?? -1))) {
      this.#events.set(id, normalizeEvents(id, [...current, ...appended]));
    }
    return appended;
  }
}

export type HumanIngressProposalOutcome =
  | Readonly<{
      status: 'proposed';
      duplicate: boolean;
      event: HumanIngressProposalEvent;
      projection: HumanIngressProposalProjection;
    }>
  | Readonly<{
      status: 'clarification_required';
      sourceEventRef: string;
      reason: Extract<HumanIngressTargetResolution, { status: 'clarification_required' }>['reason'];
      candidateRefs: readonly string[];
    }>;

/** Produces content-free proposals only; it has no Workroom Kernel command port. */
export class HumanIngressProposalService {
  constructor(
    readonly repository: HumanIngressProposalRepository,
    readonly targetResolver: HumanIngressTargetResolverPort,
  ) {}

  async propose(input: HumanIngressProposalInput): Promise<HumanIngressProposalOutcome> {
    const request = normalizeInput(input);
    const resolution = normalizeResolution(await this.targetResolver.resolve(request), request);
    if (resolution.status === 'clarification_required') {
      return deepFreeze({
        status: 'clarification_required',
        sourceEventRef: request.sourceEvent.ref,
        reason: resolution.reason,
        candidateRefs: resolution.candidateRefs,
      });
    }
    const proposal = createProposal(request, resolution);
    const events = normalizeEvents(
      request.decision.projectId,
      await this.repository.read(request.decision.projectId),
    );
    const prior = events.find(event => event.proposal.id === proposal.id);
    if (prior) {
      if (stableJson(prior.proposal) !== stableJson(proposal)) {
        throw new HumanIngressProposalReplayConflictError(
          request.decision.projectId,
          proposal.id,
        );
      }
      return deepFreeze({
        status: 'proposed',
        duplicate: true,
        event: prior,
        projection: projectEvents(request.decision.projectId, events),
      });
    }
    const type = proposal.kind === 'project_inbox'
      ? 'project_inbox.proposed' as const
      : 'task_input.proposed' as const;
    const draft = deepFreeze({
      eventId: proposal.id,
      type,
      proposal,
    });
    const expectedSequence = events.at(-1)?.sequence ?? -1;
    const appended = await this.repository.append(
      request.decision.projectId,
      expectedSequence,
      [draft],
    );
    if (appended.length !== 1 || appended[0]?.eventId !== draft.eventId) {
      throw new Error('Human ingress proposal repository append result drift');
    }
    const event = appended[0]!;
    const projection = projectEvents(
      request.decision.projectId,
      event.sequence <= expectedSequence ? events : [...events, event],
    );
    return deepFreeze({ status: 'proposed', duplicate: false, event, projection });
  }
}

function normalizeInput(input: HumanIngressProposalInput): HumanIngressTargetResolutionRequest {
  const snapshot = structuredClone(input) as HumanIngressProposalInput;
  assertObject(snapshot, 'input');
  assertExactKeys(snapshot, ['decision', 'sourceEvent', 'principal', 'entryAgentDefinitionId'], 'input');
  const decision = normalizeDecision(snapshot.decision);
  const sourceEvent = normalizeSourceEvent(snapshot.sourceEvent, decision);
  const principal = normalizePrincipal(snapshot.principal);
  const entryAgentDefinitionId = snapshot.entryAgentDefinitionId === undefined
    ? undefined
    : canonicalText(snapshot.entryAgentDefinitionId, 'entryAgentDefinitionId');
  return deepFreeze({
    decision,
    sourceEvent,
    principal,
    ...(entryAgentDefinitionId ? { entryAgentDefinitionId } : {}),
  });
}

function normalizeDecision(value: HumanIngressSpaceDecision): HumanIngressSpaceDecision {
  assertObject(value, 'Interaction Space decision');
  assertExactKeys(value, [
    'status', 'conversationKey', 'conversationSequence', 'source', 'space',
    'bindingRevision', 'bindingDigest', 'projectId',
  ], 'Interaction Space decision');
  if (value.status !== 'resolved' || value.source !== 'binding'
    || (value.space !== 'workroom' && value.space !== 'sponsor_room')) {
    throw new Error('Human ingress requires a resolved non-chat Interaction Space binding');
  }
  canonicalText(value.conversationKey, 'decision.conversationKey');
  positiveInteger(value.conversationSequence, 'decision.conversationSequence');
  positiveInteger(value.bindingRevision, 'decision.bindingRevision');
  sha256(value.bindingDigest, 'decision.bindingDigest');
  canonicalText(value.projectId, 'decision.projectId');
  return deepFreeze(structuredClone(value));
}

function normalizeSourceEvent(
  value: HumanIngressConversationEventRef,
  decision: HumanIngressSpaceDecision,
): HumanIngressConversationEventRef {
  assertObject(value, 'source conversation event');
  assertExactKeys(value, ['version', 'ref', 'digest', 'sequence', 'conversation'], 'source conversation event');
  if (value.version !== 1) throw new Error('Human ingress source conversation event version is unsupported');
  canonicalText(value.ref, 'sourceEvent.ref');
  sha256(value.digest, 'sourceEvent.digest');
  positiveInteger(value.sequence, 'sourceEvent.sequence');
  const conversation = normalizeConversation(value.conversation);
  if (conversationRefKey(conversation) !== decision.conversationKey
    || value.sequence !== decision.conversationSequence) {
    throw new Error('Human ingress source conversation event does not match the Interaction Space decision');
  }
  return deepFreeze({ ...value, conversation });
}

function normalizePrincipal(value: HumanPrincipalSnapshot): HumanPrincipalSnapshot {
  assertObject(value, 'principal snapshot');
  assertExactKeys(value, [
    'version', 'ref', 'revision', 'digest', 'principalId', 'subjectId', 'kind',
  ], 'principal snapshot');
  if (value.version !== 1 || value.kind !== 'human') {
    throw new Error('Human ingress requires a trusted human principal snapshot');
  }
  canonicalText(value.ref, 'principal.ref');
  positiveInteger(value.revision, 'principal.revision');
  sha256(value.digest, 'principal.digest');
  canonicalText(value.principalId, 'principal.principalId');
  canonicalText(value.subjectId, 'principal.subjectId');
  return deepFreeze(structuredClone(value));
}

function normalizeResolution(
  value: HumanIngressTargetResolution,
  request: HumanIngressTargetResolutionRequest,
): HumanIngressTargetResolution {
  const snapshot = structuredClone(value) as HumanIngressTargetResolution;
  assertObject(snapshot, 'target resolution');
  if (!['unaddressed', 'task_target', 'clarification_required'].includes(snapshot.status)) {
    throw new Error('Human ingress target resolution status is invalid');
  }
  const additional = snapshot.status === 'unaddressed'
    ? ['projectionReply']
    : snapshot.status === 'task_target'
      ? ['via', 'target']
      : ['reason', 'candidateRefs'];
  assertExactKeys(snapshot, [
    ...Object.keys(request), 'status', 'intent', 'resolverRef', 'resolverDigest', ...additional,
  ], 'target resolution');
  for (const key of Object.keys(request) as (keyof HumanIngressTargetResolutionRequest)[]) {
    if (stableJson(snapshot[key]) !== stableJson(request[key])) {
      throw new Error(`Human ingress target resolution is stale for ${key}`);
    }
  }
  if (!['discussion', 'work_request', 'control'].includes(snapshot.intent)) {
    throw new Error('Human ingress target resolution intent is invalid');
  }
  canonicalText(snapshot.resolverRef, 'targetResolution.resolverRef');
  sha256(snapshot.resolverDigest, 'targetResolution.resolverDigest');
  if (snapshot.status === 'unaddressed' && snapshot.projectionReply !== undefined) {
    normalizeProjectionReplyProof(snapshot.projectionReply, request.decision.projectId);
  }
  if (snapshot.status === 'task_target') normalizeTaskTarget(snapshot.target, request.decision.projectId);
  if (snapshot.status === 'clarification_required') {
    if (!['target_not_found', 'ambiguous_target', 'cross_project_target'].includes(snapshot.reason)
      || !Array.isArray(snapshot.candidateRefs)) {
      throw new Error('Human ingress clarification result is invalid');
    }
    const candidates = new Set<string>();
    snapshot.candidateRefs.forEach(candidate => {
      canonicalText(candidate, 'targetResolution.candidateRef');
      if (candidates.has(candidate)) throw new Error('Human ingress clarification candidates are duplicated');
      candidates.add(candidate);
    });
  }
  return deepFreeze(snapshot);
}

function createProposal(
  request: HumanIngressTargetResolutionRequest,
  resolution: Exclude<HumanIngressTargetResolution, { status: 'clarification_required' }>,
): HumanIngressProposal {
  const common = {
    version: 1 as const,
    id: proposalId(request.decision.projectId, request.sourceEvent.ref),
    status: 'proposed' as const,
    projectId: request.decision.projectId,
    space: request.decision.space,
    bindingRevision: request.decision.bindingRevision,
    bindingDigest: request.decision.bindingDigest,
    sourceEvent: {
      ref: request.sourceEvent.ref,
      digest: request.sourceEvent.digest,
      sequence: request.sourceEvent.sequence,
      conversationKey: request.decision.conversationKey,
    },
    principal: {
      ref: request.principal.ref,
      revision: request.principal.revision,
      digest: request.principal.digest,
      principalId: request.principal.principalId,
      subjectId: request.principal.subjectId,
    },
    intent: resolution.intent,
    resolverRef: resolution.resolverRef,
    resolverDigest: resolution.resolverDigest,
    authorityRequirement: authorityRequirement(request.decision.space, resolution.intent),
    ...(resolution.status === 'unaddressed' && resolution.projectionReply
      ? { projectionReply: normalizeProjectionReplyProof(
          resolution.projectionReply,
          request.decision.projectId,
        ) }
      : {}),
  };
  if (resolution.status === 'unaddressed') {
    const content = deepFreeze({
      ...common,
      kind: 'project_inbox' as const,
      target: {
        orchestrator: true as const,
        ...(request.entryAgentDefinitionId
          ? { agentDefinitionId: request.entryAgentDefinitionId }
          : {}),
      },
    });
    return deepFreeze({ ...content, digest: digest(content) });
  }
  const target = normalizeTaskTarget(resolution.target, request.decision.projectId);
  const content = deepFreeze({
    ...common,
    kind: 'task_input' as const,
    via: resolution.via,
    target,
    disposition: target.status === 'active'
      ? 'context_proposal' as const
      : 'discussion_only' as const,
  });
  return deepFreeze({ ...content, digest: digest(content) });
}

function normalizeTaskTarget(value: HumanIngressTaskTarget, projectId: string): HumanIngressTaskTarget {
  assertObject(value, 'Task target');
  assertExactKeys(value, [
    'projectId', 'runId', 'taskKey', 'taskRevision', 'assignmentId',
    'assignmentRevision', 'agentDefinitionId', 'status',
  ], 'Task target');
  if (value.projectId !== projectId) throw new Error('Human ingress Task target crosses Project scope');
  canonicalText(value.runId, 'target.runId');
  canonicalText(value.taskKey, 'target.taskKey');
  positiveInteger(value.taskRevision, 'target.taskRevision');
  if (value.status !== 'active' && value.status !== 'historical') {
    throw new Error('Human ingress Task target status is invalid');
  }
  if ((value.assignmentId === undefined) !== (value.assignmentRevision === undefined)) {
    throw new Error('Human ingress Task target Assignment id/revision must be supplied together');
  }
  if (value.assignmentId !== undefined) canonicalText(value.assignmentId, 'target.assignmentId');
  if (value.assignmentRevision !== undefined) positiveInteger(value.assignmentRevision, 'target.assignmentRevision');
  if (value.agentDefinitionId !== undefined) canonicalText(value.agentDefinitionId, 'target.agentDefinitionId');
  return deepFreeze(structuredClone(value));
}

function authorityRequirement(
  space: 'workroom' | 'sponsor_room',
  intent: HumanIngressIntent,
): HumanIngressAuthorityRequirement {
  if (intent !== 'control') return 'none';
  return space === 'sponsor_room' ? 'typed_sponsor_control' : 'workroom_control';
}

function proposalId(projectId: string, sourceEventRef: string): string {
  return `human-ingress:${encodeURIComponent(projectId)}:${encodeURIComponent(sourceEventRef)}`;
}

function materializeAppend(
  projectId: string,
  current: readonly HumanIngressProposalEvent[],
  expectedSequence: number,
  drafts: readonly HumanIngressProposalEventDraft[],
): readonly HumanIngressProposalEvent[] {
  sequence(expectedSequence, 'expectedSequence');
  if (!Array.isArray(drafts) || drafts.length === 0) {
    throw new Error('Human ingress proposal append requires events');
  }
  const actualSequence = current.at(-1)?.sequence ?? -1;
  const candidate = deepFreeze(drafts.map((draft, index) => materializeEvent(
    projectId,
    expectedSequence + index + 1,
    draft,
  )));
  if (expectedSequence < actualSequence) {
    const replay = current.slice(expectedSequence + 1, expectedSequence + 1 + candidate.length);
    if (replay.length === candidate.length && stableJson(replay) === stableJson(candidate)) return deepFreeze(replay);
    throw new HumanIngressProposalReplayConflictError(projectId);
  }
  if (expectedSequence !== actualSequence) {
    throw new HumanIngressProposalSequenceConflictError(projectId, expectedSequence, actualSequence);
  }
  return candidate;
}

function materializeEvent(
  projectId: string,
  eventSequence: number,
  draft: HumanIngressProposalEventDraft,
): HumanIngressProposalEvent {
  assertObject(draft, 'event draft');
  assertExactKeys(draft, ['eventId', 'type', 'proposal'], 'event draft');
  canonicalText(draft.eventId, 'event.eventId');
  const proposal = normalizeProposal(draft.proposal, projectId);
  const expectedType = proposal.kind === 'project_inbox'
    ? 'project_inbox.proposed'
    : 'task_input.proposed';
  if (draft.type !== expectedType || draft.eventId !== proposal.id) {
    throw new Error('Human ingress proposal event identity drift');
  }
  const content = deepFreeze({
    version: 1 as const,
    projectId,
    sequence: eventSequence,
    eventId: draft.eventId,
    type: draft.type,
    proposal,
  });
  return deepFreeze({ ...content, digest: digest(content) });
}

function normalizeEvents(
  projectId: string,
  values: readonly HumanIngressProposalEvent[],
): readonly HumanIngressProposalEvent[] {
  if (!Array.isArray(values)) throw new Error('Human ingress proposal event stream must be an array');
  const eventIds = new Set<string>();
  return deepFreeze(values.map((value, index) => {
    assertObject(value, 'event');
    assertExactKeys(value, [
      'version', 'projectId', 'sequence', 'eventId', 'type', 'proposal', 'digest',
    ], 'event');
    const event = value as unknown as HumanIngressProposalEvent;
    if (event.version !== 1 || event.projectId !== projectId || event.sequence !== index) {
      throw new Error('Human ingress proposal event stream is corrupt or non-contiguous');
    }
    const canonical = materializeEvent(projectId, index, {
      eventId: event.eventId,
      type: event.type,
      proposal: event.proposal,
    });
    const actualDigest = event.digest;
    if (actualDigest !== canonical.digest || stableJson(event) !== stableJson(canonical)) {
      throw new Error('Human ingress proposal event digest or payload is corrupt');
    }
    if (eventIds.has(event.eventId)) throw new Error('Human ingress proposal event id is duplicated');
    eventIds.add(event.eventId);
    return canonical;
  }));
}

function normalizeProposal(value: HumanIngressProposal, projectId: string): HumanIngressProposal {
  assertObject(value, 'proposal');
  const proposal = value as unknown as HumanIngressProposal;
  const kindKeys = proposal.kind === 'project_inbox'
    ? ['target']
    : proposal.kind === 'task_input'
      ? ['via', 'target', 'disposition']
      : [];
  assertExactKeys(proposal, [
    'version', 'id', 'digest', 'status', 'projectId', 'space', 'bindingRevision',
    'bindingDigest', 'sourceEvent', 'principal', 'intent', 'resolverRef',
    'resolverDigest', 'authorityRequirement', 'projectionReply', 'kind', ...kindKeys,
  ], 'proposal');
  if (proposal.version !== 1 || proposal.status !== 'proposed' || proposal.projectId !== projectId) {
    throw new Error('Human ingress proposal scope or schema is invalid');
  }
  if (proposal.space !== 'workroom' && proposal.space !== 'sponsor_room') {
    throw new Error('Human ingress proposal Space is invalid');
  }
  positiveInteger(proposal.bindingRevision, 'proposal.bindingRevision');
  sha256(proposal.bindingDigest, 'proposal.bindingDigest');
  assertObject(proposal.sourceEvent, 'proposal source event');
  assertExactKeys(proposal.sourceEvent, [
    'ref', 'digest', 'sequence', 'conversationKey',
  ], 'proposal source event');
  canonicalText(proposal.sourceEvent.ref, 'proposal.sourceEvent.ref');
  sha256(proposal.sourceEvent.digest, 'proposal.sourceEvent.digest');
  positiveInteger(proposal.sourceEvent.sequence, 'proposal.sourceEvent.sequence');
  canonicalText(proposal.sourceEvent.conversationKey, 'proposal.sourceEvent.conversationKey');
  assertObject(proposal.principal, 'proposal principal');
  assertExactKeys(proposal.principal, [
    'ref', 'revision', 'digest', 'principalId', 'subjectId',
  ], 'proposal principal');
  canonicalText(proposal.principal.ref, 'proposal.principal.ref');
  positiveInteger(proposal.principal.revision, 'proposal.principal.revision');
  sha256(proposal.principal.digest, 'proposal.principal.digest');
  canonicalText(proposal.principal.principalId, 'proposal.principal.principalId');
  canonicalText(proposal.principal.subjectId, 'proposal.principal.subjectId');
  if (!['discussion', 'work_request', 'control'].includes(proposal.intent)) {
    throw new Error('Human ingress proposal intent is invalid');
  }
  canonicalText(proposal.resolverRef, 'proposal.resolverRef');
  sha256(proposal.resolverDigest, 'proposal.resolverDigest');
  if (proposal.authorityRequirement !== authorityRequirement(proposal.space, proposal.intent)) {
    throw new Error('Human ingress proposal authority requirement is invalid');
  }
  if (proposal.projectionReply !== undefined) {
    if (proposal.kind !== 'project_inbox' || proposal.space !== 'sponsor_room'
      || proposal.intent !== 'control') {
      throw new Error('Human ingress Projection reply proof is outside Sponsor control scope');
    }
    normalizeProjectionReplyProof(proposal.projectionReply, projectId);
  }
  if (proposal.id !== proposalId(projectId, proposal.sourceEvent.ref)) {
    throw new Error('Human ingress proposal id does not bind the source event');
  }
  if (proposal.kind === 'project_inbox') {
    assertObject(proposal.target, 'Project Inbox target');
    assertExactKeys(proposal.target, ['orchestrator', 'agentDefinitionId'], 'Project Inbox target');
    if (proposal.target.orchestrator !== true) {
      throw new Error('Human ingress Project Inbox must target the Orchestrator');
    }
    if (proposal.target.agentDefinitionId !== undefined) {
      canonicalText(proposal.target.agentDefinitionId, 'Project Inbox target.agentDefinitionId');
    }
  } else if (proposal.kind === 'task_input') {
    if (proposal.via !== 'reply' && proposal.via !== 'mention') {
      throw new Error('Human ingress TaskInput addressing method is invalid');
    }
    const target = normalizeTaskTarget(proposal.target, projectId);
    const disposition = target.status === 'active' ? 'context_proposal' : 'discussion_only';
    if (proposal.disposition !== disposition) {
      throw new Error('Human ingress TaskInput disposition does not match target status');
    }
  } else {
    throw new Error('Human ingress proposal kind is invalid');
  }
  const { digest: actualDigest, ...content } = proposal;
  if (actualDigest !== digest(content)) throw new Error('Human ingress proposal digest is corrupt');
  return deepFreeze(structuredClone(proposal));
}

function normalizeProjectionReplyProof(
  value: HumanIngressProjectionReplyProof,
  projectId: string,
): HumanIngressProjectionReplyProof {
  assertObject(value, 'Projection reply proof');
  assertExactKeys(value, [
    'version', 'projectionId', 'projectId', 'bindingRevision', 'messageKey', 'targetDigest',
  ], 'Projection reply proof');
  if (value.version !== 1 || value.projectId !== projectId) {
    throw new Error('Human ingress Projection reply proof crosses Project scope');
  }
  canonicalText(value.projectionId, 'projectionReply.projectionId');
  positiveInteger(value.bindingRevision, 'projectionReply.bindingRevision');
  canonicalText(value.messageKey, 'projectionReply.messageKey');
  sha256(value.targetDigest, 'projectionReply.targetDigest');
  return deepFreeze(structuredClone(value));
}

function projectEvents(
  projectId: string,
  values: readonly HumanIngressProposalEvent[],
): HumanIngressProposalProjection {
  const events = normalizeEvents(projectId, values);
  const proposals = events.map(event => event.proposal);
  return deepFreeze({
    version: 1,
    projectId,
    sequence: events.at(-1)?.sequence ?? -1,
    inbox: proposals.filter((value): value is ProjectInboxProposal => value.kind === 'project_inbox'),
    taskInputs: proposals.filter((value): value is TaskInputProposal => value.kind === 'task_input'),
  });
}

function normalizeConversation(value: ConversationRef): ConversationRef {
  assertObject(value, 'conversation');
  assertExactKeys(value, ['endpoint', 'kind', 'id', 'parent', 'threadId'], 'conversation');
  assertObject(value.endpoint, 'conversation endpoint');
  assertExactKeys(value.endpoint, ['adapter', 'id'], 'conversation endpoint');
  canonicalText(value.endpoint.adapter, 'conversation.endpoint.adapter');
  canonicalText(value.endpoint.id, 'conversation.endpoint.id');
  if (value.kind !== 'private' && value.kind !== 'group' && value.kind !== 'channel') {
    throw new Error('Human ingress conversation kind is invalid');
  }
  canonicalText(value.id, 'conversation.id');
  if (value.parent !== undefined) {
    assertObject(value.parent, 'conversation parent');
    assertExactKeys(value.parent, ['kind', 'id'], 'conversation parent');
    if (value.parent.kind !== 'private' && value.parent.kind !== 'group' && value.parent.kind !== 'channel') {
      throw new Error('Human ingress conversation parent kind is invalid');
    }
    canonicalText(value.parent.id, 'conversation.parent.id');
  }
  if (value.threadId !== undefined) canonicalText(value.threadId, 'conversation.threadId');
  return deepFreeze(structuredClone(value));
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Human ingress ${field} must be an object`);
  }
}

function assertExactKeys(value: object, allowed: readonly string[], field: string): void {
  const allow = new Set(allowed);
  const unexpected = Object.keys(value).find(key => !allow.has(key));
  if (unexpected) throw new Error(`Human ingress ${field} contains forbidden field ${unexpected}`);
}

function canonicalText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Human ingress ${field} must be canonical text`);
  }
  return value;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Human ingress ${field} must be a canonical SHA-256 digest`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Human ingress ${field} must be a positive integer`);
  }
  return value as number;
}

function sequence(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < -1) {
    throw new Error(`Human ingress ${field} must be a valid sequence`);
  }
  return value as number;
}
