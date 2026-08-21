import {
  parsePortfolioResourceBundle,
  type PortfolioCapacityGrant,
  type PortfolioCapacityReclaim,
  type PortfolioFact,
  type PortfolioGrantAssignmentFailureReason,
} from './portfolio-journal.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface PortfolioWorkroomRoute {
  readonly projectId: string;
  readonly routeRef: string;
  readonly routeDigest: string;
  readonly authorityRef: string;
  readonly authorityDigest: string;
}

export type PortfolioControlOutboxPayload =
  | Readonly<{ kind: 'grant_offer'; grant: PortfolioCapacityGrant }>
  | Readonly<{ kind: 'reclaim_request'; grant: PortfolioCapacityGrant; reclaim: PortfolioCapacityReclaim }>;

export interface PortfolioControlOutboxItem {
  readonly version: 1;
  readonly itemId: string;
  readonly portfolioId: string;
  readonly projectId: string;
  readonly sourceSequence: number;
  readonly sourceEventId: string;
  readonly sourceEventDigest: string;
  readonly route: PortfolioWorkroomRoute;
  readonly payload: PortfolioControlOutboxPayload;
  readonly status: 'pending' | 'dispatching' | 'outcome_unknown' | 'acknowledged' | 'closed';
  readonly deliveryFence: number;
  readonly workerId?: string;
  readonly claimedAt?: number;
  readonly claimExpiresAt?: number;
  readonly ack?: PortfolioControlAck;
  readonly compensation?: PortfolioControlCompensation;
  readonly digest: string;
}

export interface PortfolioControlCompensation {
  readonly version: 1;
  readonly itemId: string;
  readonly portfolioId: string;
  readonly projectId: string;
  readonly grantId: string;
  readonly grantFence: number;
  readonly deliveryFence: number;
  readonly assignmentRef: string;
  readonly reason: PortfolioGrantAssignmentFailureReason;
  readonly kernelSequence: number;
  readonly kernelFactDigest: string;
  readonly proofDigest: string;
  readonly digest: string;
}

export type PortfolioControlAck =
  | Readonly<{
      version: 1; kind: 'grant_accepted'; ackId: string; portfolioId: string; projectId: string;
      itemId: string; grantId: string; requestId: string; grantFence: number; deliveryFence: number;
      assignmentRef: string; assignmentAttempt: number; assignmentFence: number;
      producer: Readonly<{ principalId: string; authorityRef: string; authorityDigest: string }>;
      observedAt: number; digest: string;
    }>
  | Readonly<{
      version: 1; kind: 'reclaim_acknowledged'; ackId: string; portfolioId: string; projectId: string;
      itemId: string; grantId: string; reclaimId: string; grantFence: number; deliveryFence: number;
      assignmentRef: string; assignmentAttempt: number; assignmentFence: number;
      outcome: 'checkpointed' | 'declined'; checkpoint?: Readonly<{ ref: string; digest: string }>;
      producer: Readonly<{ principalId: string; authorityRef: string; authorityDigest: string }>;
      observedAt: number; digest: string;
    }>;

export interface PortfolioControlOutboxState {
  readonly portfolioId: string;
  readonly sequence: number;
  readonly sourceCursor: number;
  readonly items: Readonly<Record<string, PortfolioControlOutboxItem>>;
}

export type PortfolioControlOutboxEventDraft =
  | Readonly<{ type: 'source.scanned'; payload: { sourceSequence: number; sourceEventId: string; sourceEventDigest: string; item?: PortfolioControlOutboxItem } }>
  | Readonly<{ type: 'item.claimed'; payload: { itemId: string; workerId: string; deliveryFence: number; claimedAt: number; claimExpiresAt: number } }>
  | Readonly<{ type: 'item.outcome_unknown'; payload: { itemId: string; deliveryFence: number; observedAt: number } }>
  | Readonly<{ type: 'item.compensated'; payload: {
      itemId: string; deliveryFence: number; compensation: PortfolioControlCompensation;
    } }>
  | Readonly<{ type: 'item.closed'; payload: {
      itemId: string; reason: 'offer_expired' | 'reclaim_timed_out'; closedAt: number;
      terminalSourceSequence: number; terminalSourceEventId: string; terminalSourceEventDigest: string;
    } }>
  | Readonly<{ type: 'item.acknowledged'; payload: { itemId: string; deliveryFence: number; ack: PortfolioControlAck } }>;

export type PortfolioControlOutboxEvent = PortfolioControlOutboxEventDraft & Readonly<{
  readonly version: 1;
  readonly portfolioId: string;
  readonly sequence: number;
  readonly digest: string;
}>;

export interface PortfolioControlOutboxRepository {
  read(portfolioId: string): Promise<readonly PortfolioControlOutboxEvent[]>;
  append(portfolioId: string, expectedSequence: number, draft: PortfolioControlOutboxEventDraft): Promise<PortfolioControlOutboxEvent>;
}

export class MemoryPortfolioControlOutboxRepository implements PortfolioControlOutboxRepository {
  readonly #events = new Map<string, readonly PortfolioControlOutboxEvent[]>();

  async read(portfolioId: string): Promise<readonly PortfolioControlOutboxEvent[]> {
    return this.#events.get(required(portfolioId, 'portfolioId')) ?? Object.freeze([]);
  }

  async append(portfolioId: string, expectedSequence: number, draft: PortfolioControlOutboxEventDraft): Promise<PortfolioControlOutboxEvent> {
    const current = await this.read(portfolioId);
    if (current.length - 1 !== expectedSequence) throw new Error('Portfolio Control Outbox sequence conflict');
    const event = createPortfolioControlOutboxEvent(portfolioId, expectedSequence + 1, draft);
    replayPortfolioControlOutbox(portfolioId, [...current, event]);
    this.#events.set(portfolioId, Object.freeze([...current, event]));
    return event;
  }
}

export function createPortfolioControlItem(
  fact: Extract<PortfolioFact, { type: 'capacity.grant_offered' | 'capacity.reclaim_requested' }>,
  grant: PortfolioCapacityGrant,
  route: PortfolioWorkroomRoute,
): PortfolioControlOutboxItem {
  required(fact.portfolioId, 'portfolioId');
  if (route.projectId !== grant.projectId) {
    throw new Error('Portfolio Control route escaped Project ownership');
  }
  const payload: PortfolioControlOutboxPayload = fact.type === 'capacity.grant_offered'
    ? deepFreeze({ kind: 'grant_offer', grant: fact.payload.grant })
    : deepFreeze({ kind: 'reclaim_request', grant, reclaim: fact.payload.reclaim });
  if (payload.grant.grantId !== grant.grantId || payload.grant.fence !== grant.fence) {
    throw new Error('Portfolio Control source Grant binding drift');
  }
  const body = deepFreeze({
    version: 1 as const,
    itemId: `portfolio-control:${encodeURIComponent(fact.portfolioId)}:${fact.sequence}:${encodeURIComponent(fact.eventId)}`,
    portfolioId: fact.portfolioId,
    projectId: grant.projectId,
    sourceSequence: fact.sequence,
    sourceEventId: fact.eventId,
    sourceEventDigest: digest(fact),
    route: parseRoute(route, grant.projectId),
    payload,
    status: 'pending' as const,
    deliveryFence: 0,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export function replayPortfolioControlOutbox(
  portfolioId: string,
  events: readonly PortfolioControlOutboxEvent[],
): PortfolioControlOutboxState {
  const scannedSources = new Map<number, Readonly<{ eventId: string; eventDigest: string }>>();
  let state: PortfolioControlOutboxState = deepFreeze({
    portfolioId, sequence: -1, sourceCursor: -1, items: {},
  });
  for (const [sequence, event] of events.entries()) {
    assertEvent(event, portfolioId, sequence);
    if (event.type === 'source.scanned') {
      if (event.payload.sourceSequence !== state.sourceCursor + 1) throw new Error('Portfolio Control scanner cursor gap');
      const items = { ...state.items };
      if (event.payload.item) {
        const item = assertItem(event.payload.item);
        if (item.sourceSequence !== event.payload.sourceSequence
          || item.sourceEventId !== event.payload.sourceEventId
          || item.sourceEventDigest !== event.payload.sourceEventDigest
          || items[item.itemId]) throw new Error('Portfolio Control source item drift');
        items[item.itemId] = item;
      }
      state = deepFreeze({ ...state, sequence, sourceCursor: event.payload.sourceSequence, items });
      scannedSources.set(event.payload.sourceSequence, {
        eventId: event.payload.sourceEventId,
        eventDigest: event.payload.sourceEventDigest,
      });
      continue;
    }
    const current = requireItem(state, event.payload.itemId);
    if (event.type === 'item.claimed') {
      if (current.status !== 'pending' || event.payload.deliveryFence !== current.deliveryFence + 1
        || event.payload.claimExpiresAt <= event.payload.claimedAt) throw new Error('Portfolio Control claim drift');
      state = replaceItem(state, sequence, current.itemId, {
        ...current, status: 'dispatching', workerId: required(event.payload.workerId, 'workerId'),
        deliveryFence: positive(event.payload.deliveryFence, 'deliveryFence'),
        claimedAt: nonNegative(event.payload.claimedAt, 'claimedAt'),
        claimExpiresAt: positive(event.payload.claimExpiresAt, 'claimExpiresAt'),
      });
      continue;
    }
    if (event.type === 'item.outcome_unknown') {
      if (current.status !== 'dispatching' || current.deliveryFence !== event.payload.deliveryFence) {
        throw new Error('Portfolio Control unknown outcome drift');
      }
      state = replaceItem(state, sequence, current.itemId, { ...current, status: 'outcome_unknown' });
      continue;
    }
    if (event.type === 'item.closed') {
      const terminal = scannedSources.get(event.payload.terminalSourceSequence);
      if (current.status !== 'pending' || current.deliveryFence !== 0
        || !terminal || terminal.eventId !== event.payload.terminalSourceEventId
        || terminal.eventDigest !== event.payload.terminalSourceEventDigest) {
        throw new Error('Portfolio Control terminal tombstone drift');
      }
      nonNegative(event.payload.closedAt, 'closedAt');
      state = replaceItem(state, sequence, current.itemId, { ...current, status: 'closed' });
      continue;
    }
    if (event.type === 'item.compensated') {
      if (!['dispatching', 'outcome_unknown'].includes(current.status)
        || current.deliveryFence !== event.payload.deliveryFence) {
        throw new Error('Portfolio Control compensation state drift');
      }
      const compensation = assertCompensation(event.payload.compensation, current);
      state = replaceItem(state, sequence, current.itemId, {
        ...current, status: 'closed', compensation,
      });
      continue;
    }
    if (!['dispatching', 'outcome_unknown'].includes(current.status)
      || current.deliveryFence !== event.payload.deliveryFence) {
      throw new Error('Portfolio Control acknowledgement state drift');
    }
    const ack = assertAck(event.payload.ack, current);
    state = replaceItem(state, sequence, current.itemId, { ...current, status: 'acknowledged', ack });
  }
  return state;
}

export function createPortfolioControlOutboxEvent(
  portfolioId: string,
  sequence: number,
  draft: PortfolioControlOutboxEventDraft,
): PortfolioControlOutboxEvent {
  assertDraftShape(draft);
  const body = deepFreeze({
    version: 1 as const, portfolioId: required(portfolioId, 'portfolioId'),
    sequence: nonNegative(sequence, 'sequence'), type: draft.type, payload: deepFreeze(draft.payload),
  });
  return deepFreeze({ ...body, digest: digest(body) }) as PortfolioControlOutboxEvent;
}

function assertEvent(event: PortfolioControlOutboxEvent, portfolioId: string, sequence: number): void {
  exactKeys(event, ['version', 'portfolioId', 'sequence', 'type', 'payload', 'digest'], [], 'event');
  const canonical = createPortfolioControlOutboxEvent(portfolioId, sequence, {
    type: event.type,
    payload: event.payload,
  } as PortfolioControlOutboxEventDraft);
  if (event.digest !== canonical.digest || canonicalWorkroomJson(event) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Portfolio Control Outbox event drift');
  }
}

function assertItem(value: PortfolioControlOutboxItem): PortfolioControlOutboxItem {
  exactKeys(value, [
    'version', 'itemId', 'portfolioId', 'projectId', 'sourceSequence', 'sourceEventId',
    'sourceEventDigest', 'route', 'payload', 'status', 'deliveryFence', 'digest',
  ], [], 'item');
  const { digest: ignored, ...body } = value;
  void ignored;
  if (value.version !== 1 || value.status !== 'pending' || value.deliveryFence !== 0
    || value.digest !== digest(body)) throw new Error('Portfolio Control item drift');
  requiredDigest(value.sourceEventDigest, 'sourceEventDigest');
  parseRoute(value.route, value.projectId);
  assertControlPayload(value.payload);
  assertContentFree(value, 'item');
  return deepFreeze(value);
}

function assertAck(value: PortfolioControlAck, item: PortfolioControlOutboxItem): PortfolioControlAck {
  const common = [
    'version', 'kind', 'ackId', 'portfolioId', 'projectId', 'itemId', 'grantId',
    'grantFence', 'deliveryFence', 'assignmentRef', 'assignmentAttempt', 'assignmentFence',
    'producer', 'observedAt', 'digest',
  ];
  exactKeys(value,
    value.kind === 'grant_accepted' ? [...common, 'requestId'] : [...common, 'reclaimId', 'outcome'],
    value.kind === 'reclaim_acknowledged' ? ['checkpoint'] : [], 'ack');
  exactKeys(value.producer, ['principalId', 'authorityRef', 'authorityDigest'], [], 'ack producer');
  const { digest: ignored, ...body } = value;
  void ignored;
  if (value.version !== 1 || value.portfolioId !== item.portfolioId || value.projectId !== item.projectId
    || value.itemId !== item.itemId || value.deliveryFence !== item.deliveryFence
    || value.grantId !== item.payload.grant.grantId || value.grantFence !== item.payload.grant.fence
    || value.digest !== digest(body)) {
    throw new Error('Portfolio Control Workroom acknowledgement binding drift');
  }
  required(value.ackId, 'ackId');
  required(value.assignmentRef, 'assignmentRef');
  positive(value.assignmentAttempt, 'assignmentAttempt');
  positive(value.assignmentFence, 'assignmentFence');
  required(value.producer.principalId, 'producer principalId');
  required(value.producer.authorityRef, 'producer authorityRef');
  requiredDigest(value.producer.authorityDigest, 'producer authorityDigest');
  nonNegative(value.observedAt, 'observedAt');
  if (item.payload.kind === 'grant_offer') {
    if (value.kind !== 'grant_accepted' || value.requestId !== item.payload.grant.requestId) {
      throw new Error('Grant Offer acknowledgement kind drift');
    }
  } else {
    if (value.kind !== 'reclaim_acknowledged' || value.reclaimId !== item.payload.reclaim.reclaimId) {
      throw new Error('Reclaim acknowledgement kind drift');
    }
    if (value.outcome === 'checkpointed') {
      required(value.checkpoint?.ref, 'checkpoint ref');
      requiredDigest(value.checkpoint?.digest, 'checkpoint digest');
      exactKeys(value.checkpoint!, ['ref', 'digest'], [], 'checkpoint');
    } else if (value.outcome !== 'declined' || value.checkpoint !== undefined) {
      throw new Error('Reclaim acknowledgement checkpoint drift');
    }
  }
  return deepFreeze(value);
}

function replaceItem(
  state: PortfolioControlOutboxState,
  sequence: number,
  itemId: string,
  input: Omit<PortfolioControlOutboxItem, 'digest'>,
): PortfolioControlOutboxState {
  const item = deepFreeze({ ...input, digest: digest(input) });
  return deepFreeze({ ...state, sequence, items: { ...state.items, [itemId]: item } });
}

function requireItem(state: PortfolioControlOutboxState, itemId: string): PortfolioControlOutboxItem {
  const item = state.items[required(itemId, 'itemId')];
  if (!item) throw new Error(`Unknown Portfolio Control item ${itemId}`);
  return item;
}

function parseRoute(value: PortfolioWorkroomRoute, projectId: string): PortfolioWorkroomRoute {
  exactKeys(value, ['projectId', 'routeRef', 'routeDigest', 'authorityRef', 'authorityDigest'], [], 'route');
  if (value.projectId !== projectId) throw new Error('Portfolio Workroom route Project drift');
  required(value.routeRef, 'routeRef'); requiredDigest(value.routeDigest, 'routeDigest');
  required(value.authorityRef, 'route authorityRef'); requiredDigest(value.authorityDigest, 'route authorityDigest');
  return deepFreeze(value);
}

function assertDraftShape(draft: PortfolioControlOutboxEventDraft): void {
  exactKeys(draft, ['type', 'payload'], [], 'event draft');
  switch (draft.type) {
    case 'source.scanned':
      exactKeys(draft.payload, ['sourceSequence', 'sourceEventId', 'sourceEventDigest'], ['item'], draft.type);
      break;
    case 'item.claimed':
      exactKeys(draft.payload, ['itemId', 'workerId', 'deliveryFence', 'claimedAt', 'claimExpiresAt'], [], draft.type);
      break;
    case 'item.outcome_unknown':
      exactKeys(draft.payload, ['itemId', 'deliveryFence', 'observedAt'], [], draft.type);
      break;
    case 'item.compensated':
      exactKeys(draft.payload, ['itemId', 'deliveryFence', 'compensation'], [], draft.type);
      break;
    case 'item.closed':
      exactKeys(draft.payload, [
        'itemId', 'reason', 'closedAt', 'terminalSourceSequence',
        'terminalSourceEventId', 'terminalSourceEventDigest',
      ], [], draft.type);
      break;
    case 'item.acknowledged':
      exactKeys(draft.payload, ['itemId', 'deliveryFence', 'ack'], [], draft.type);
      break;
  }
  assertContentFree(draft.payload, draft.type);
}

function assertCompensation(
  value: PortfolioControlCompensation,
  item: PortfolioControlOutboxItem,
): PortfolioControlCompensation {
  exactKeys(value, [
    'version', 'itemId', 'portfolioId', 'projectId', 'grantId', 'grantFence',
    'deliveryFence', 'assignmentRef', 'reason', 'kernelSequence', 'kernelFactDigest',
    'proofDigest', 'digest',
  ], [], 'compensation');
  const { digest: ignored, ...body } = value;
  void ignored;
  if (value.version !== 1 || value.itemId !== item.itemId || value.portfolioId !== item.portfolioId
    || value.projectId !== item.projectId || value.grantId !== item.payload.grant.grantId
    || value.grantFence !== item.payload.grant.fence || value.deliveryFence !== item.deliveryFence
    || value.digest !== digest(body)
    || (value.reason !== 'task_stale' && value.reason !== 'task_terminal'
      && value.reason !== 'run_terminal')) {
    throw new Error('Portfolio Control compensation binding drift');
  }
  required(value.assignmentRef, 'compensation assignmentRef');
  nonNegative(value.kernelSequence, 'compensation kernelSequence');
  requiredDigest(value.kernelFactDigest, 'compensation kernelFactDigest');
  requiredDigest(value.proofDigest, 'compensation proofDigest');
  return deepFreeze(value);
}

function assertControlPayload(value: PortfolioControlOutboxPayload): void {
  if (value.kind === 'grant_offer') {
    exactKeys(value, ['kind', 'grant'], [], 'grant offer payload');
  } else {
    exactKeys(value, ['kind', 'grant', 'reclaim'], [], 'reclaim request payload');
    exactKeys(value.reclaim,
      ['reclaimId', 'grantId', 'projectId', 'requestedAt', 'deadline', 'reason', 'status'],
      ['reservedForRequestId'], 'reclaim');
  }
  exactKeys(value.grant, [
    'grantId', 'requestId', 'projectId', 'fence', 'resourceBundle', 'requestDigest',
    'resourceBundleDigest', 'catalogGenerationId', 'catalogRevision', 'catalogDigest',
    'profileRevisionId', 'profileDigest', 'profileCeilingDigest', 'validatedBundleDigest',
    'reservedCostMicros', 'portfolioPolicyRevision', 'portfolioPolicyDigest',
    'projectPolicyRevision', 'lane', 'issuedAt', 'issuedSequence', 'offerExpiresAt', 'status',
  ], [
    'consumedAt', 'leaseExpiresAt', 'assignmentRef', 'actualCostMicros', 'settlementRef',
    'receiptId', 'receiptDigest', 'authenticatedBy', 'maxLeaseExpiresAt', 'renewalCount',
    'lastHeartbeatSequence', 'lastHeartbeatAt',
  ], 'grant');
  const parsedBundle = parsePortfolioResourceBundle(value.grant.resourceBundle);
  if (canonicalWorkroomJson(parsedBundle) !== canonicalWorkroomJson(value.grant.resourceBundle)) {
    throw new Error('Portfolio Control grant resource bundle exact schema drift');
  }
}

function exactKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  label: string,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Portfolio Control ${label} exact schema drift`);
  }
  const actual = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (requiredKeys.some(key => !Object.hasOwn(value, key)) || actual.some(key => !allowed.has(key))) {
    throw new Error(`Portfolio Control ${label} exact schema drift`);
  }
}

function assertContentFree(value: unknown, label: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertContentFree(item, label);
    return;
  }
  const forbidden = /^(?:prompt|context|message|title|memory|task|plan|artifact|evidence|body|content|secret|token|credential)$/u;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key)) throw new Error(`Portfolio Control ${label} exact schema forbids governed content`);
    assertContentFree(item, label);
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}
function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}
function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}
function nonNegative(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}
