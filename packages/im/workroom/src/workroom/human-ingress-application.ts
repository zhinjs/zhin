import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import type {
  HumanIngressIntent,
  HumanIngressProposal,
  HumanIngressProposalRepository,
} from './human-ingress.js';

export interface HumanIngressApplicationIdentity {
  readonly projectId: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly operationId: string;
}

export interface HumanIngressApplicationRequest {
  readonly version: 1;
  readonly kind: HumanIngressIntent;
  readonly identity: HumanIngressApplicationIdentity;
  readonly operationId: string;
  readonly attempt: number;
  readonly fence: number;
  readonly proposal: HumanIngressProposal;
}

export type HumanIngressAppliedKind =
  | 'discussion_recorded'
  | 'plan_proposal_submitted'
  | 'control_proposal_submitted';

export type HumanIngressClarificationReason =
  | 'ambiguous_intent'
  | 'missing_work_scope'
  | 'planning_unavailable'
  | 'planning_disclosure_unavailable'
  | 'missing_control_target'
  | 'unauthorized_control'
  | 'stale_target';

export type HumanIngressApplicationDecision =
  | Readonly<HumanIngressApplicationIdentity & {
      status: 'applied';
      kind: HumanIngressAppliedKind;
      receiptRef: string;
      receiptDigest: string;
    }>
  | Readonly<HumanIngressApplicationIdentity & {
      status: 'clarification_required';
      reason: HumanIngressClarificationReason;
      candidateRefs: readonly string[];
    }>;

/**
 * Trusted, idempotent Orchestrator boundary. Implementations must use
 * operationId as the exact replay key and may only submit proposals to the
 * Kernel; this port is deliberately not a Workroom command surface.
 */
export interface HumanIngressOrchestratorProposalPort {
  apply(
    request: HumanIngressApplicationRequest,
  ): HumanIngressApplicationDecision | Promise<HumanIngressApplicationDecision>;
}

interface HumanIngressApplicationEventBase {
  readonly version: 1;
  readonly projectId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly operationId: string;
  readonly occurredAt: number;
  readonly attempt: number;
  readonly fence: number;
  readonly digest: string;
}

export type HumanIngressApplicationEvent =
  | Readonly<HumanIngressApplicationEventBase & {
      type: 'proposal.claimed';
      leaseExpiresAt: number;
    }>
  | Readonly<HumanIngressApplicationEventBase & {
      type: 'proposal.applied';
      kind: HumanIngressAppliedKind;
      receiptRef: string;
      receiptDigest: string;
    }>
  | Readonly<HumanIngressApplicationEventBase & {
      type: 'proposal.clarification_required';
      reason: HumanIngressClarificationReason;
      candidateRefs: readonly string[];
    }>
  | Readonly<HumanIngressApplicationEventBase & {
      type: 'proposal.retry_scheduled';
      reason: 'downstream_unavailable';
      retryAt: number;
    }>;

type HumanIngressApplicationEventContent = HumanIngressApplicationEvent extends infer Event
  ? Event extends HumanIngressApplicationEvent
    ? Omit<Event, 'digest'>
    : never
  : never;

export type HumanIngressApplicationEventDraft = Omit<
HumanIngressApplicationEvent,
'version' | 'projectId' | 'sequence' | 'digest'
>;

export interface HumanIngressApplicationRepository {
  read(projectId: string): Promise<readonly HumanIngressApplicationEvent[]>;
  append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly HumanIngressApplicationEventDraft[],
  ): Promise<readonly HumanIngressApplicationEvent[]>;
}

export class HumanIngressApplicationSequenceConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(`Human ingress application ${projectId} sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`);
    this.name = 'HumanIngressApplicationSequenceConflictError';
  }
}

export class HumanIngressApplicationReplayConflictError extends Error {
  constructor(readonly projectId: string) {
    super(`Human ingress application ${projectId} replay payload drift`);
    this.name = 'HumanIngressApplicationReplayConflictError';
  }
}

export class MemoryHumanIngressApplicationRepository
implements HumanIngressApplicationRepository {
  readonly #events = new Map<string, readonly HumanIngressApplicationEvent[]>();

  async read(projectId: string): Promise<readonly HumanIngressApplicationEvent[]> {
    const id = text(projectId, 'projectId');
    return normalizeHistory(id, this.#events.get(id) ?? []);
  }

  async append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly HumanIngressApplicationEventDraft[],
  ): Promise<readonly HumanIngressApplicationEvent[]> {
    const id = text(projectId, 'projectId');
    const current = normalizeHistory(id, this.#events.get(id) ?? []);
    const events = materializeAppend(id, current, expectedSequence, drafts);
    const actualSequence = current.at(-1)?.sequence ?? -1;
    if (events.some(event => event.sequence > actualSequence)) {
      this.#events.set(id, normalizeHistory(id, [...current, ...events]));
    }
    return events;
  }
}

export type HumanIngressApplicationResult =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'waiting'; wakeAt: number }>
  | Readonly<{
      status: 'applied';
      proposalId: string;
      kind: HumanIngressAppliedKind;
      receiptRef: string;
      receiptDigest: string;
    }>
  | Readonly<{
      status: 'clarification_required';
      proposalId: string;
      reason: HumanIngressClarificationReason;
      candidateRefs: readonly string[];
    }>
  | Readonly<{
      status: 'retry_scheduled';
      proposalId: string;
      retryAt: number;
      reason: 'downstream_unavailable';
    }>;

export interface HumanIngressApplicationServiceOptions {
  readonly proposals: HumanIngressProposalRepository;
  readonly applications: HumanIngressApplicationRepository;
  readonly port: HumanIngressOrchestratorProposalPort;
  readonly now?: () => number;
  readonly claimLeaseMs?: number;
  readonly retryDelayMs?: number;
  /** Ephemeral diagnostics only; durable retry events remain content-free. */
  readonly onError?: (error: unknown, request: HumanIngressApplicationRequest) => void;
}

/** Crash/restart-safe consumer for durable, content-free human proposals. */
export class HumanIngressApplicationService {
  readonly #now: () => number;
  readonly #claimLeaseMs: number;
  readonly #retryDelayMs: number;

  constructor(readonly options: HumanIngressApplicationServiceOptions) {
    this.#now = options.now ?? Date.now;
    this.#claimLeaseMs = positive(options.claimLeaseMs ?? 30_000, 'claimLeaseMs');
    this.#retryDelayMs = positive(options.retryDelayMs ?? 5_000, 'retryDelayMs');
  }

  async runOnce(projectId: string): Promise<HumanIngressApplicationResult> {
    const id = text(projectId, 'projectId');
    const proposals = (await this.options.proposals.read(id)).map(event => event.proposal);
    if (proposals.length === 0) return deepFreeze({ status: 'idle' });
    let history = await this.options.applications.read(id);
    const now = safeTime(this.#now(), 'now');
    const proposal = proposals.find(candidate => isAvailable(candidate, history, now));
    if (!proposal) {
      const wakeAt = nextWakeAt(proposals, history, now);
      return wakeAt === undefined
        ? deepFreeze({ status: 'idle' })
        : deepFreeze({ status: 'waiting', wakeAt });
    }
    const prior = history.filter(event => event.proposalId === proposal.id).at(-1);
    const attempt = (prior?.attempt ?? 0) + 1;
    const fence = (prior?.fence ?? 0) + 1;
    const identity = applicationIdentity(proposal);
    const claim = eventDraft(identity, now, attempt, fence, {
      type: 'proposal.claimed' as const,
      leaseExpiresAt: now + this.#claimLeaseMs,
    });
    try {
      await this.options.applications.append(id, history.at(-1)?.sequence ?? -1, [claim]);
    } catch (error) {
      if (error instanceof HumanIngressApplicationSequenceConflictError) {
        return deepFreeze({ status: 'idle' });
      }
      throw error;
    }
    history = await this.options.applications.read(id);
    const request = deepFreeze<HumanIngressApplicationRequest>({
      version: 1,
      kind: proposal.intent,
      identity,
      operationId: identity.operationId,
      attempt,
      fence,
      proposal,
    });
    try {
      const decision = normalizeDecision(await this.options.port.apply(request), request);
      const terminal = decision.status === 'applied'
        ? eventDraft(identity, safeTime(this.#now(), 'now'), attempt, fence, {
            type: 'proposal.applied' as const,
            kind: decision.kind,
            receiptRef: decision.receiptRef,
            receiptDigest: decision.receiptDigest,
          })
        : eventDraft(identity, safeTime(this.#now(), 'now'), attempt, fence, {
            type: 'proposal.clarification_required' as const,
            reason: decision.reason,
            candidateRefs: decision.candidateRefs,
          });
      await this.options.applications.append(id, history.at(-1)?.sequence ?? -1, [terminal]);
      return decision.status === 'applied'
        ? deepFreeze({
            status: 'applied',
            proposalId: proposal.id,
            kind: decision.kind,
            receiptRef: decision.receiptRef,
            receiptDigest: decision.receiptDigest,
          })
        : deepFreeze({
            status: 'clarification_required',
            proposalId: proposal.id,
            reason: decision.reason,
            candidateRefs: decision.candidateRefs,
          });
    } catch (error) {
      if (error instanceof HumanIngressApplicationSequenceConflictError
        || error instanceof HumanIngressApplicationReplayConflictError) throw error;
      this.options.onError?.(error, request);
      const retryAt = safeTime(this.#now(), 'now') + this.#retryDelayMs;
      const retry = eventDraft(identity, safeTime(this.#now(), 'now'), attempt, fence, {
        type: 'proposal.retry_scheduled' as const,
        reason: 'downstream_unavailable' as const,
        retryAt,
      });
      history = await this.options.applications.read(id);
      await this.options.applications.append(id, history.at(-1)?.sequence ?? -1, [retry]);
      return deepFreeze({
        status: 'retry_scheduled',
        proposalId: proposal.id,
        retryAt,
        reason: 'downstream_unavailable',
      });
    }
  }

  async drain(projectId: string, max = 128): Promise<readonly HumanIngressApplicationResult[]> {
    positive(max, 'max');
    const results: HumanIngressApplicationResult[] = [];
    for (let index = 0; index < max; index += 1) {
      const result = await this.runOnce(projectId);
      if (result.status === 'idle') break;
      results.push(result);
      if (result.status === 'retry_scheduled' || result.status === 'waiting') break;
    }
    return deepFreeze(results);
  }
}

function applicationIdentity(proposal: HumanIngressProposal): HumanIngressApplicationIdentity {
  return deepFreeze({
    projectId: proposal.projectId,
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    operationId: `human-ingress-application:${proposal.id}`,
  });
}

function isAvailable(
  proposal: HumanIngressProposal,
  history: readonly HumanIngressApplicationEvent[],
  now: number,
): boolean {
  const latest = history.filter(event => event.proposalId === proposal.id).at(-1);
  if (!latest) return true;
  if (latest.proposalDigest !== proposal.digest) {
    throw new HumanIngressApplicationReplayConflictError(proposal.projectId);
  }
  if (latest.type === 'proposal.applied' || latest.type === 'proposal.clarification_required') return false;
  if (latest.type === 'proposal.retry_scheduled') return latest.retryAt <= now;
  return latest.leaseExpiresAt <= now;
}

function nextWakeAt(
  proposals: readonly HumanIngressProposal[],
  history: readonly HumanIngressApplicationEvent[],
  now: number,
): number | undefined {
  const wakeTimes = proposals.flatMap(proposal => {
    const latest = history.filter(event => event.proposalId === proposal.id).at(-1);
    if (!latest
      || latest.type === 'proposal.applied'
      || latest.type === 'proposal.clarification_required') return [];
    const wakeAt = latest.type === 'proposal.claimed' ? latest.leaseExpiresAt : latest.retryAt;
    return wakeAt > now ? [wakeAt] : [];
  });
  return wakeTimes.length === 0 ? undefined : Math.min(...wakeTimes);
}

function normalizeDecision(
  value: HumanIngressApplicationDecision,
  request: HumanIngressApplicationRequest,
): HumanIngressApplicationDecision {
  const snapshot = structuredClone(value) as HumanIngressApplicationDecision;
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Human ingress application decision is invalid');
  assertExactKeys(snapshot, snapshot.status === 'applied'
    ? ['projectId', 'proposalId', 'proposalDigest', 'operationId', 'status', 'kind', 'receiptRef', 'receiptDigest']
    : ['projectId', 'proposalId', 'proposalDigest', 'operationId', 'status', 'reason', 'candidateRefs'],
  'decision');
  if (snapshot.projectId !== request.identity.projectId
    || snapshot.proposalId !== request.identity.proposalId
    || snapshot.proposalDigest !== request.identity.proposalDigest
    || snapshot.operationId !== request.identity.operationId) {
    throw new Error('Human ingress application decision is stale');
  }
  if (snapshot.status === 'applied') {
    const expected: Record<HumanIngressIntent, HumanIngressAppliedKind> = {
      discussion: 'discussion_recorded',
      work_request: 'plan_proposal_submitted',
      control: 'control_proposal_submitted',
    };
    if (snapshot.kind !== expected[request.kind]) {
      throw new Error('Human ingress application decision crosses intent authority');
    }
    text(snapshot.receiptRef, 'receiptRef');
    sha256(snapshot.receiptDigest, 'receiptDigest');
  } else if (snapshot.status === 'clarification_required') {
    if (![
      'ambiguous_intent', 'missing_work_scope', 'missing_control_target',
      'planning_unavailable', 'planning_disclosure_unavailable', 'unauthorized_control', 'stale_target',
    ].includes(snapshot.reason)) throw new Error('Human ingress clarification reason is invalid');
    uniqueTexts(snapshot.candidateRefs, 'candidateRefs');
  } else {
    throw new Error('Human ingress application decision status is invalid');
  }
  return deepFreeze(snapshot);
}

function eventDraft<T extends Omit<HumanIngressApplicationEventDraft,
'eventId' | 'proposalId' | 'proposalDigest' | 'operationId' | 'occurredAt' | 'attempt' | 'fence'>>(
  identity: HumanIngressApplicationIdentity,
  occurredAt: number,
  attempt: number,
  fence: number,
  value: T,
): HumanIngressApplicationEventDraft {
  return deepFreeze({
    ...identity,
    eventId: `${identity.operationId}:${attempt}:${value.type}`,
    occurredAt,
    attempt,
    fence,
    ...value,
  }) as HumanIngressApplicationEventDraft;
}

function materializeAppend(
  projectId: string,
  current: readonly HumanIngressApplicationEvent[],
  expectedSequence: number,
  drafts: readonly HumanIngressApplicationEventDraft[],
): readonly HumanIngressApplicationEvent[] {
  sequence(expectedSequence, 'expectedSequence');
  if (!Array.isArray(drafts) || drafts.length === 0) throw new Error('Human ingress application append requires events');
  const actualSequence = current.at(-1)?.sequence ?? -1;
  const candidate = deepFreeze(drafts.map((draft, index) => materializeEvent(
    projectId,
    expectedSequence + index + 1,
    draft,
  )));
  if (expectedSequence < actualSequence) {
    const replay = current.slice(expectedSequence + 1, expectedSequence + 1 + candidate.length);
    if (replay.length === candidate.length && canonicalWorkroomJson(replay) === canonicalWorkroomJson(candidate)) {
      return replay;
    }
    throw new HumanIngressApplicationReplayConflictError(projectId);
  }
  if (expectedSequence !== actualSequence) {
    throw new HumanIngressApplicationSequenceConflictError(projectId, expectedSequence, actualSequence);
  }
  return candidate;
}

function materializeEvent(
  projectId: string,
  sequenceValue: number,
  draft: HumanIngressApplicationEventDraft,
): HumanIngressApplicationEvent {
  const content = deepFreeze({
    ...structuredClone(draft),
    version: 1 as const,
    projectId,
    sequence: sequenceValue,
  }) as HumanIngressApplicationEventContent;
  validateEvent(content);
  return deepFreeze({ ...content, digest: digestCanonicalWorkroomValue(content) }) as HumanIngressApplicationEvent;
}

function normalizeHistory(
  projectId: string,
  values: readonly HumanIngressApplicationEvent[],
): readonly HumanIngressApplicationEvent[] {
  const snapshots = deepFreeze(structuredClone(values) as HumanIngressApplicationEvent[]);
  const seenEventIds = new Set<string>();
  const latestByProposal = new Map<string, HumanIngressApplicationEvent>();
  snapshots.forEach((event, index) => {
    if (event.sequence !== index) throw new Error('Human ingress application history has a sequence gap');
    const { digest, ...content } = event;
    validateEvent(content as HumanIngressApplicationEventContent);
    if (event.projectId !== projectId || digest !== digestCanonicalWorkroomValue(content)) {
      throw new Error('Human ingress application history is corrupt');
    }
    if (seenEventIds.has(event.eventId)) throw new Error('Human ingress application eventId is duplicated');
    seenEventIds.add(event.eventId);
    const prior = latestByProposal.get(event.proposalId);
    if (!prior) {
      if (event.type !== 'proposal.claimed' || event.attempt !== 1 || event.fence !== 1) {
        throw new Error('Human ingress application lifecycle must begin with its first claim');
      }
    } else {
      if (prior.proposalDigest !== event.proposalDigest
        || prior.operationId !== event.operationId) {
        throw new Error('Human ingress application proposal identity drift');
      }
      if (prior.type === 'proposal.applied' || prior.type === 'proposal.clarification_required') {
        throw new Error('Human ingress application terminal lifecycle cannot continue');
      }
      if (event.type === 'proposal.claimed') {
        if (event.attempt !== prior.attempt + 1 || event.fence !== prior.fence + 1) {
          throw new Error('Human ingress application takeover attempt/fence is invalid');
        }
      } else if (prior.type !== 'proposal.claimed'
        || event.attempt !== prior.attempt
        || event.fence !== prior.fence) {
        throw new Error('Human ingress application outcome does not match its claim');
      }
    }
    latestByProposal.set(event.proposalId, event);
  });
  return snapshots;
}

function validateEvent(value: HumanIngressApplicationEventContent): void {
  const variantKeys = value.type === 'proposal.claimed'
    ? ['leaseExpiresAt']
    : value.type === 'proposal.applied'
      ? ['kind', 'receiptRef', 'receiptDigest']
      : value.type === 'proposal.clarification_required'
        ? ['reason', 'candidateRefs']
        : value.type === 'proposal.retry_scheduled'
          ? ['reason', 'retryAt']
          : [];
  assertExactKeys(value, [
    'version', 'projectId', 'sequence', 'eventId', 'proposalId',
    'proposalDigest', 'operationId', 'occurredAt', 'attempt', 'fence',
    'type', ...variantKeys,
  ], 'event');
  if (value.version !== 1) throw new Error('Human ingress application event version is unsupported');
  text(value.projectId, 'projectId');
  sequence(value.sequence, 'sequence', false);
  text(value.eventId, 'eventId');
  text(value.proposalId, 'proposalId');
  sha256(value.proposalDigest, 'proposalDigest');
  text(value.operationId, 'operationId');
  if (value.operationId !== `human-ingress-application:${value.proposalId}`) {
    throw new Error('Human ingress application operationId does not bind the proposal');
  }
  if (value.eventId !== `${value.operationId}:${value.attempt}:${value.type}`) {
    throw new Error('Human ingress application eventId does not bind its lifecycle identity');
  }
  safeTime(value.occurredAt, 'occurredAt');
  positive(value.attempt, 'attempt');
  positive(value.fence, 'fence');
  if (value.type === 'proposal.claimed') {
    safeTime(value.leaseExpiresAt, 'leaseExpiresAt');
    if (value.leaseExpiresAt <= value.occurredAt) throw new Error('Human ingress application claim lease must be in the future');
  }
  else if (value.type === 'proposal.applied') {
    if (!['discussion_recorded', 'plan_proposal_submitted', 'control_proposal_submitted'].includes(value.kind)) {
      throw new Error('Human ingress applied kind is invalid');
    }
    text(value.receiptRef, 'receiptRef');
    sha256(value.receiptDigest, 'receiptDigest');
  } else if (value.type === 'proposal.clarification_required') {
    if (![
      'ambiguous_intent', 'missing_work_scope', 'missing_control_target',
      'planning_unavailable', 'planning_disclosure_unavailable', 'unauthorized_control', 'stale_target',
    ].includes(value.reason)) throw new Error('Human ingress clarification reason is invalid');
    uniqueTexts(value.candidateRefs, 'candidateRefs');
  } else if (value.type === 'proposal.retry_scheduled') {
    if (value.reason !== 'downstream_unavailable') throw new Error('Human ingress retry reason is invalid');
    safeTime(value.retryAt, 'retryAt');
    if (value.retryAt <= value.occurredAt) throw new Error('Human ingress retry must be scheduled in the future');
  } else throw new Error('Human ingress application event type is invalid');
}

function uniqueTexts(values: readonly string[], field: string): void {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  const canonical = values.map(value => text(value, field));
  if (new Set(canonical).size !== canonical.length) throw new Error(`${field} contains duplicates`);
}

function assertExactKeys(value: object, allowed: readonly string[], field: string): void {
  const expected = new Set(allowed);
  const unexpected = Object.keys(value).find(key => !expected.has(key));
  if (unexpected) throw new Error(`Human ingress application ${field} contains forbidden field ${unexpected}`);
  const missing = allowed.find(key => !(key in value));
  if (missing) throw new Error(`Human ingress application ${field} is missing field ${missing}`);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${field} must be canonical text`);
  }
  return value;
}

function sha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${field} must be a canonical SHA-256 digest`);
  }
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`);
  return value;
}

function safeTime(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
}

function sequence(value: number, field: string, allowMinusOne = true): number {
  if (!Number.isSafeInteger(value) || value < (allowMinusOne ? -1 : 0)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}
