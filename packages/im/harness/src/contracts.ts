/**
 * ADR 0048 Agent Harness — shared contracts (H1).
 *
 * Everything here is plain, serializable data plus the interfaces that the
 * harness components implement. Components (authority, budget, guard,
 * journal, mailbox) depend on this file only, never on each other, so they
 * can be built and tested independently and composed in `harness.ts`.
 *
 * Rules that hold across all components:
 * - No platform (IM) types. Venues are opaque references.
 * - Every value that crosses a mailbox is JSON-serializable (A2A in H5).
 * - Pure functions never mutate their inputs; returned objects are frozen.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Agent definition name (`agents/<name>/agent.json`). */
export type AgentName = string;

/**
 * Actor identity: `<agent>` for a named, long-lived actor, or
 * `<agent>#<instance>` for an ephemeral one (e.g. a one-off delegation).
 */
export type ActorId = string;

export type EngagementId = string;
export type MailId = string;

/** Opaque reference to where an engagement is shown (a group, a DM, Console, …). */
export interface VenueRef {
  readonly kind: string;
  readonly id: string;
}

/**
 * Trust levels, lowest first. Comparisons use this order only; never compare
 * strings any other way.
 */
export const TRUST_LEVELS = ['stranger', 'group_member', 'trusted', 'master'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** The human (or system trigger) an engagement ultimately acts for. */
export interface Principal {
  readonly kind: 'human' | 'system';
  /** Stable id: platform user id for humans, trigger id (e.g. `timer:<id>`) for system. */
  readonly id: string;
  readonly trust: TrustLevel;
  /** Where the principal spoke, when known; approvals are asked there. */
  readonly venue?: VenueRef;
}

// ---------------------------------------------------------------------------
// Scopes — finite sets with an explicit "everything" sentinel
// ---------------------------------------------------------------------------

/**
 * A set of names. `all` means unrestricted; `only` is an exact finite set.
 * There are no globs at this layer: callers expand patterns before building
 * a scope, so intersection stays exact and auditable.
 */
export type NameScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'only'; readonly names: readonly string[] };

export const ALL: NameScope = Object.freeze({ kind: 'all' });
export const NONE: NameScope = Object.freeze({ kind: 'only', names: Object.freeze([]) as readonly string[] });

export function only(names: Iterable<string>): NameScope {
  return Object.freeze({ kind: 'only', names: Object.freeze([...new Set(names)].sort()) });
}

export function scopeHas(scope: NameScope, name: string): boolean {
  return scope.kind === 'all' || scope.names.includes(name);
}

/** Set intersection. `all ∩ x = x`. Result names are sorted and unique. */
export function intersectScopes(a: NameScope, b: NameScope): NameScope {
  if (a.kind === 'all') return b.kind === 'all' ? ALL : only(b.names);
  if (b.kind === 'all') return only(a.names);
  const right = new Set(b.names);
  return only(a.names.filter((name) => right.has(name)));
}

/** `true` when every name `inner` allows is also allowed by `outer`. */
export function scopeWithin(inner: NameScope, outer: NameScope): boolean {
  if (outer.kind === 'all') return true;
  if (inner.kind === 'all') return false;
  return inner.names.every((name) => outer.names.includes(name));
}

// ---------------------------------------------------------------------------
// Authority (ADR 0048 §3.4 invariant 1: only ever attenuated)
// ---------------------------------------------------------------------------

export interface EgressScope {
  readonly network: boolean;
  /** Hosts allowed when `network` is true; `all` = no host restriction. */
  readonly hosts: NameScope;
}

export interface Authority {
  readonly principal: Principal;
  /** Effective trust; never above `principal.trust`. */
  readonly trust: TrustLevel;
  /** Tools this authority may call. */
  readonly tools: NameScope;
  /** Agents this authority may contact (ask / delegate / tell). */
  readonly contacts: NameScope;
  readonly egress: EgressScope;
  /**
   * Who answers approvals. Always humans (invariant 4): the principal by
   * default, plus configured approver ids. Never an actor id.
   */
  readonly approvers: readonly string[];
  /** Actor ids that derived this authority, root first (audit trail). */
  readonly chain: readonly ActorId[];
}

/** What a delegator asks to narrow when it hands work on. Omitted = keep. */
export interface AuthorityNarrowing {
  readonly tools?: NameScope;
  readonly contacts?: NameScope;
  readonly trust?: TrustLevel;
  readonly egress?: Partial<EgressScope>;
}

/** An agent definition's fixed capability ceiling (from agent.json). */
export interface AgentCeiling {
  readonly agent: AgentName;
  readonly tools: NameScope;
  readonly contacts: NameScope;
  readonly maxTrust: TrustLevel;
  readonly egress: EgressScope;
  /** Who may hand this agent work: agent names, plus `human` for people. */
  readonly acceptsFrom: NameScope;
  /** Default delegation budget when handing work to this agent (ADR 0048 §2, §5). */
  readonly defaultBudget?: Partial<BudgetAmounts>;
}

// ---------------------------------------------------------------------------
// Budget (ADR 0048 §3.4 invariant 2: conserved down the delegation tree)
// ---------------------------------------------------------------------------

export interface BudgetAmounts {
  readonly modelCalls: number;
  readonly tokens: number;
  readonly wallMs: number;
  /** Tool calls with side effects (writes, sends, shell, config). */
  readonly sideEffects: number;
}

export type BudgetKey = keyof BudgetAmounts;
export const BUDGET_KEYS: readonly BudgetKey[] = ['modelCalls', 'tokens', 'wallMs', 'sideEffects'];

export type GrantId = string;

export interface BudgetSnapshot {
  readonly grantId: GrantId;
  readonly parentId?: GrantId;
  readonly granted: BudgetAmounts;
  /**
   * Consumed by this grant plus its closed children. A closed child adds at
   * most its own granted amount (overspend stays visible on the child's
   * snapshot and in the journal, but never pushes an ancestor past its grant).
   */
  readonly spent: BudgetAmounts;
  /** Currently reserved by open child grants. */
  readonly reservedForChildren: BudgetAmounts;
  readonly remaining: BudgetAmounts;
  readonly closed: boolean;
}

export type BudgetResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: 'budget_exceeded' | 'grant_closed' | 'unknown_grant' | 'invalid_amount'; readonly exhausted?: readonly BudgetKey[]; readonly message: string };

export interface BudgetLedger {
  /** Opens a root grant for a new engagement. */
  openRoot(amounts: BudgetAmounts): GrantId;
  /**
   * Carves a child grant out of the parent's remaining amounts. A requested
   * key above the parent's remaining fails (never silently clamps); omitted
   * keys default to an equal share policy decided by the implementation and
   * documented there, but never more than the parent's remaining.
   */
  grant(parent: GrantId, request: Partial<BudgetAmounts>): BudgetResult<GrantId>;
  /** Records usage. Fails with `budget_exceeded` (listing keys) once any key would go below zero; the charge is still recorded so overspend is visible. */
  charge(grant: GrantId, usage: Partial<BudgetAmounts>): BudgetResult<BudgetSnapshot>;
  /** Closes a grant; its unspent amount returns to the parent's remaining. Idempotent. */
  close(grant: GrantId): BudgetResult<BudgetSnapshot>;
  snapshot(grant: GrantId): BudgetSnapshot | undefined;
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export type MailKind = 'human' | 'ask' | 'delegate' | 'tell' | 'result' | 'signal' | 'timer' | 'event';

export type MailSender =
  | { readonly kind: 'human'; readonly principal: Principal }
  | { readonly kind: 'actor'; readonly actor: ActorId }
  | { readonly kind: 'system'; readonly source: 'timer' | 'event' | 'harness' };

export type MailBody =
  | {
      readonly kind: 'human';
      readonly text: string;
      readonly venue: VenueRef;
      readonly messageId?: string;
      // Inbox-policy markers (ADR 0048 H3, D2). All optional: an absent marker
      // means "no" (`plainText` included), so a bare human mail is never
      // merged, superseded or treated as a stop. Set by the venue from the
      // transport, never from message text (invariant 6).
      /** Platform sender id; defaults to the sender principal's id. */
      readonly senderId?: string;
      /** Display name used when several senders share one turn. */
      readonly senderName?: string;
      /** Plain text without media, quotes or forwards (only those may be merged / superseded). */
      readonly plainText?: boolean;
      /** May join a merge window (ADR 0038 §1): plain group text from a non-master, not a command, stop or approval. */
      readonly mergeable?: boolean;
      /** A danmaku of a live room (ADR 0038 §5): joins the lane's danmaku window. */
      readonly live?: boolean;
      /** Sender is the bot master (may stop anyone's turn). */
      readonly isMaster?: boolean;
      /** Explicit stop request: consumed by the inbox, never run as a turn. */
      readonly isStop?: boolean;
      /**
       * The transport saw neither an @ / reply to the bot nor a private chat
       * (an ordinary group message). The admission policy does not run it as a
       * turn (`not_addressed`).
       */
      readonly unaddressed?: boolean;
    }
  | { readonly kind: 'ask'; readonly question: string }
  | { readonly kind: 'delegate'; readonly brief: string; readonly deliverable?: string }
  | { readonly kind: 'tell'; readonly content: string }
  | {
      readonly kind: 'result';
      /** The `ask` / `delegate` mail this answers. */
      readonly inReplyTo: MailId;
      readonly status: 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'denied';
      readonly content: string;
    }
  | { readonly kind: 'signal'; readonly signal: 'cancel'; readonly target: MailId; readonly reason?: string }
  | { readonly kind: 'timer'; readonly timerId: string; readonly content: string }
  | { readonly kind: 'event'; readonly event: string; readonly data: unknown };

export interface Mail {
  readonly id: MailId;
  readonly kind: MailKind;
  readonly engagementId: EngagementId;
  /** Mail that caused this one; absent only for the engagement's root mail (invariant 3). */
  readonly causationId?: MailId;
  /** Filled by the harness from the transport, never by the sender (invariant 6). */
  readonly from: MailSender;
  readonly to: ActorId;
  /**
   * Serial lane inside the target's inbox (ADR 0048 H3, D1). Mails of one
   * actor in the same lane run one turn at a time and may be merged by the
   * inbox policy; different lanes run in parallel. Defaults to the engagement
   * (`engagement:<id>`); an IM venue session uses one lane across the
   * engagements its messages open. See `laneOf`.
   */
  readonly lane?: string;
  readonly authority: Authority;
  readonly grantId: GrantId;
  readonly body: MailBody;
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

export interface Engagement {
  readonly id: EngagementId;
  readonly principal: Principal;
  readonly rootMailId: MailId;
  readonly rootGrantId: GrantId;
  readonly venue?: VenueRef;
  readonly openedAt: number;
}

// ---------------------------------------------------------------------------
// Guard kernel (ADR 0048 §3.4)
// ---------------------------------------------------------------------------

export interface GuardLimits {
  /** Max actor-to-actor hops from the root mail (root = depth 0). */
  readonly maxDepth: number;
  /** Max ask + delegate mails in one engagement. */
  readonly maxFanout: number;
  /** Max ask/delegate round trips between the same unordered pair of actors. */
  readonly maxPairRoundTrips: number;
  /** Max times the same (from, to, normalized content) may be sent in one engagement. */
  readonly maxDuplicates: number;
}

export const DEFAULT_GUARD_LIMITS: GuardLimits = Object.freeze({
  maxDepth: 4,
  maxFanout: 16,
  maxPairRoundTrips: 3,
  maxDuplicates: 2,
});

export type GuardDenyCode =
  | 'missing_causation'
  | 'unknown_engagement'
  | 'authority_not_attenuated'
  | 'contact_not_allowed'
  | 'not_accepted_by_target'
  | 'depth_exceeded'
  | 'fanout_exceeded'
  | 'pair_round_trips_exceeded'
  | 'duplicate_mail';

export type GuardDecision =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly code: GuardDenyCode;
      readonly reason: string;
      /** When true the harness freezes the branch and escalates to the principal. */
      readonly escalate: boolean;
    };

/** Read-only view of an engagement's mail graph the guard decides on. */
export interface EngagementGraphView {
  readonly engagement: Engagement;
  /** All admitted mails of this engagement, in admission order. */
  readonly mails: readonly Mail[];
  /** Mail by id within this engagement. */
  get(id: MailId): Mail | undefined;
}

export interface GuardContext {
  readonly graph: EngagementGraphView | undefined;
  /** Ceiling of the target actor's agent definition. */
  readonly targetCeiling: AgentCeiling;
  /** Authority of the sender when the sender is an actor (its current turn's authority). */
  readonly senderAuthority?: Authority;
  readonly limits: GuardLimits;
}

export interface GuardKernel {
  /** Decides whether `mail` may be delivered. Pure: no side effects. */
  admitMail(mail: Mail, context: GuardContext): GuardDecision;
}

// ---------------------------------------------------------------------------
// Blackboard (ADR 0048 §3.1, §3.3, H5)
// ---------------------------------------------------------------------------

export type BoardEntryKind = 'artifact' | 'note' | 'todo';
export type BoardTodoStatus = 'pending' | 'in_progress' | 'done';

export interface BoardEntry {
  readonly key: string;
  readonly kind: BoardEntryKind;
  readonly content: string;
  readonly author: ActorId;
  readonly updatedAt: number;
  readonly version: number;
  readonly status?: BoardTodoStatus;
}

export interface BoardWriteInput {
  readonly key: string;
  readonly kind?: BoardEntryKind;
  readonly content: string;
  readonly author: ActorId;
  readonly status?: BoardTodoStatus;
  readonly mailId?: MailId;
}

export interface BoardReadFilter {
  readonly key?: string;
  readonly kind?: BoardEntryKind;
}

// ---------------------------------------------------------------------------
// Remote Mailbox transport (ADR 0048 §3.6, §8 H5)
// ---------------------------------------------------------------------------

export interface RemoteMailResult {
  readonly status: 'completed' | 'cancelled' | 'rejected';
  readonly content: string;
  readonly consumed?: Partial<BudgetAmounts>;
}

export interface RemoteMailTransport {
  canRoute(target: ActorId): boolean;
  send(mail: Mail, grantedBudget: BudgetAmounts): Promise<RemoteMailResult>;
}

export interface GuardBlockReason {
  readonly code: GuardDenyCode | string;
  readonly detail?: string;
}

export interface FollowUpInput {
  readonly mailId: MailId;
  readonly from: ActorId;
  readonly content: string;
  readonly budget?: Partial<BudgetAmounts>;
  readonly timeoutMs?: number;
}

export interface SendAck {
  readonly ok: boolean;
  readonly accepted: boolean;
  readonly mailId: MailId;
  readonly mail?: Mail;
  readonly reply?: { readonly status: TurnStatus; readonly content: string };
  readonly result?: { readonly status: TurnStatus | 'rejected'; readonly content: string };
  readonly code?: string;
  readonly reason?: GuardBlockReason;
  readonly escalated?: boolean;
}

// ---------------------------------------------------------------------------
// Engagement journal (ADR 0048 §3.5, §6, §8 H5)
// ---------------------------------------------------------------------------

export type EngagementEventType =
  | 'engagement_opened'
  | 'mail_admitted'
  | 'mail_denied'
  | 'mail_sent'
  | 'mail_delivered'
  | 'mail_completed'
  | 'mail_cancelled'
  | 'turn_started'
  | 'turn_finished'
  | 'budget_granted'
  | 'budget_charged'
  | 'budget_exceeded'
  | 'tool_called'
  | 'board_written'
  | 'venue_projected'
  | 'guard_blocked'
  | 'escalated'
  | 'engagement_closed';

export type JournalEvent =
  | {
      readonly type: 'board_written';
      readonly actor: ActorId;
      readonly key: string;
      readonly kind: 'artifact' | 'note' | 'todo';
      readonly content?: string;
      readonly status?: BoardTodoStatus;
      readonly version?: number;
    }
  | {
      readonly type: EngagementEventType;
      readonly [key: string]: unknown;
    };

export interface EngagementEvent {
  readonly engagementId: EngagementId;
  /** 0-based, contiguous per engagement; assigned by the journal. */
  readonly seq: number;
  readonly at: number;
  readonly type: EngagementEventType;
  /** JSON-serializable payload; shape is per event type and documented at the call site. */
  readonly data: Readonly<Record<string, unknown>>;
}

export type JournalRecord = EngagementEvent & {
  readonly event?: JournalEvent;
};

export interface EngagementHopSummary {
  readonly mailId: MailId;
  readonly kind: MailKind;
  readonly from: string;
  readonly to: ActorId;
  readonly causationId?: MailId;
  readonly status: 'sent' | 'delivered' | 'completed' | 'cancelled';
}

export interface EngagementSummary {
  readonly engagementId: EngagementId;
  readonly initiator?: Principal;
  readonly venue?: VenueRef;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly status: 'open' | 'completed' | 'escalated' | 'cancelled' | 'blocked';
  readonly reason?: string;
  readonly actors: readonly ActorId[];
  readonly mailCount: number;
  readonly toolCallCount: number;
  readonly boardEntries: readonly BoardEntry[];
  readonly guardBlocks: readonly {
    readonly from: ActorId;
    readonly to?: ActorId;
    readonly reason: GuardBlockReason;
    readonly at: number;
  }[];
  readonly escalations: readonly {
    readonly by: ActorId;
    readonly reason: string;
    readonly at: number;
  }[];
  readonly projections: readonly {
    readonly venue: VenueRef;
    readonly actor: ActorId;
    readonly mailId: MailId;
    readonly mode: 'visible' | 'summary';
    readonly at: number;
  }[];
  readonly consumed: BudgetAmounts;
  readonly hops: readonly EngagementHopSummary[];
}

export interface JournalRetention {
  /** Engagements whose last event is older than this are pruned. */
  readonly maxAgeMs: number;
  /** Events per engagement above this are rejected (`journal_full`). */
  readonly maxEventsPerEngagement: number;
}

export const DEFAULT_JOURNAL_RETENTION: JournalRetention = Object.freeze({
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxEventsPerEngagement: 5000,
});

export class JournalFullError extends Error {
  readonly code = 'journal_full';
  constructor(readonly engagementId: EngagementId, readonly limit: number) {
    super(`Engagement ${engagementId} reached the journal limit of ${limit} events`);
    this.name = 'JournalFullError';
  }
}

export interface EngagementJournal {
  append(event: Omit<EngagementEvent, 'seq'>): Promise<EngagementEvent>;
  read(engagementId: EngagementId): Promise<readonly EngagementEvent[]>;
  /** Deletes engagements past retention; returns how many engagements were removed. */
  prune(now: number): Promise<number>;
  /** Returns most recent engagement IDs ordered by latest activity descending. */
  listEngagements(limit?: number): Promise<readonly EngagementId[]>;
  /** Summarizes an engagement's events into a collaboration graph and stats. */
  summarize(engagementId: EngagementId): Promise<EngagementSummary | undefined>;
  /** Compacts intermediate events of a normally completed engagement. */
  compact(engagementId: EngagementId): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mailbox scheduling (ADR 0048 §3.1)
// ---------------------------------------------------------------------------

/**
 * Serial key: one actor runs one turn at a time per lane (D1). `lane`
 * defaults to the mail's engagement, so without explicit lanes this is the
 * H1 rule "one actor, one engagement, one turn at a time".
 */
export interface MailboxKey {
  readonly actor: ActorId;
  readonly lane: string;
  /**
   * Engagement of the batch's first mail. A merged batch may span several
   * engagements (one per human message); the first one carries the turn (Q2).
   */
  readonly engagementId: EngagementId;
}

/** Lane of a mail: `mail.lane`, or its engagement. */
export function laneOf(mail: Pick<Mail, 'lane' | 'engagementId'>): string {
  return mail.lane ?? `engagement:${mail.engagementId}`;
}

export function mailboxKeyOf(mail: Pick<Mail, 'to' | 'lane' | 'engagementId'>): MailboxKey {
  return { actor: mail.to, lane: laneOf(mail), engagementId: mail.engagementId };
}

/**
 * Stable sender id the inbox policies compare: the human body's `senderId`,
 * else the principal's id; the actor id for actor mail; `system:<source>`.
 * Always transport-derived (invariant 6), never read from free text.
 */
export function senderOf(mail: Pick<Mail, 'from' | 'body'>): string {
  if (mail.body.kind === 'human' && mail.body.senderId) return mail.body.senderId;
  switch (mail.from.kind) {
    case 'human': return mail.from.principal.id;
    case 'actor': return mail.from.actor;
    default: return `system:${mail.from.source}`;
  }
}

export type TurnStatus = 'completed' | 'failed' | 'cancelled' | 'budget_exceeded';

/** Why the inbox finished a mail without running it (status `cancelled`). */
export type InboxDropReason = 'cancelled' | 'expired' | 'stopped' | 'evicted' | 'closed';

export interface ActorTurnResult {
  readonly status: TurnStatus;
  /** Text handed back to the asker / delegator when the batch contains ask / delegate mail. */
  readonly content?: string;
  /** Set when the inbox dropped the mail(s) instead of running them. */
  readonly reason?: InboxDropReason;
}

/** Pre-send verdict for a running turn (ADR 0038 §4). */
export type InboxStaleVerdict =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'discard'; readonly senders: readonly string[] }
  | { readonly kind: 'send'; readonly senders: readonly string[]; readonly reason: 'acted' | 'starvation' };

/** Facts about how the inbox admitted a batch (recorded on the turn trace by the agent layer). */
export interface InboxTurnFacts {
  /** Milliseconds between the batch's earliest (re)queue time and its start. */
  readonly queuedMs: number;
  /** Mails in the batch. */
  readonly mergedMessages: number;
  /** The batch replaces the same sender's own unanswered turn. */
  readonly supersededPrevious: boolean;
  /** The batch carries mails whose previous reply was discarded as stale. */
  readonly carried: boolean;
  /** Mails of this lane evicted (danmaku window cap) since the previous turn started. */
  readonly evicted: number;
}

/** Handed to the runner with each batch; lets the turn talk back to its inbox. */
export interface ActorTurnControl {
  readonly facts: InboxTurnFacts;
  /** A reply went out: later same-sender mails queue instead of superseding, and the reply is never cut. */
  markDelivered(): void;
  /** The turn did something that must be reported (tool call, hard gate): a stale reply still goes out. */
  markActed(): void;
  /**
   * Ask before each send. The first `discard` moves this batch back into the
   * follow-up's group; later calls keep answering `discard`.
   */
  staleCheck(): InboxStaleVerdict;
}

/** Runs one actor turn over a batch of mails. Supplied by the agent layer. */
export type ActorTurnRunner = (
  actor: ActorId,
  batch: readonly Mail[],
  signal: AbortSignal,
  control?: ActorTurnControl,
) => Promise<ActorTurnResult>;

/** One queued (or running) mail as the inbox policy sees it. */
export interface InboxEntry {
  readonly mail: Mail;
  /** Global arrival order (kept when a mail is requeued). */
  readonly seq: number;
  /** Mailbox clock when the mail was (re)queued. */
  readonly postedAt: number;
  /** Requeued because the same sender superseded its running turn. */
  readonly superseded?: boolean;
  /** Requeued because its reply went stale; belongs to the group of this mail. */
  readonly carriedInto?: MailId;
}

export interface InboxRunning {
  readonly batch: readonly InboxEntry[];
  readonly startedAt: number;
  /** Entries with `seq >= startSeq` arrived while this batch ran. */
  readonly startSeq: number;
  readonly delivered: boolean;
  readonly acted: boolean;
}

/** Read-only view of one lane's inbox handed to the policy. */
export interface InboxView {
  readonly key: MailboxKey;
  readonly now: number;
  /** Queued mails in queue order (not necessarily `seq` order). */
  readonly pending: readonly InboxEntry[];
  readonly running?: InboxRunning;
  /** Last finished batch of this lane, kept for `InboxPolicy.memoryMs`. */
  readonly lastTurn?: { readonly batch: readonly Mail[]; readonly endedAt: number };
}

export type InboxRejectCode = 'queue_full' | 'forbidden' | 'not_running' | 'not_addressed';

/** What happens to a mail being posted (decided before it is queued). */
export type InboxPostDecision =
  /** Queue it. `merged`: it joined an existing group. `evict`: queued mails to drop (danmaku cap). */
  | { readonly kind: 'enqueue'; readonly merged?: boolean; readonly evict?: readonly MailId[] }
  /** Abort the running batch and requeue it in front, followed by this mail. */
  | { readonly kind: 'supersede' }
  /** Consume this mail: abort the running batch and drop these senders' queued mails. */
  | { readonly kind: 'stop'; readonly cancelSenders: readonly string[] }
  | { readonly kind: 'reject'; readonly code: InboxRejectCode; readonly message: string };

/** When an idle lane starts its next turn. */
export type InboxReadyDecision =
  /** Run these mails: an in-order subsequence of `pending` that contains `pending[0]`. */
  | { readonly kind: 'run'; readonly batch: readonly Mail[] }
  /** Not yet: re-check at `until` (or on the next post when omitted). */
  | { readonly kind: 'wait'; readonly until?: number };

export type InboxStaleDecision =
  | Exclude<InboxStaleVerdict, { readonly kind: 'discard' }>
  /** Discard the reply and requeue the running batch right before `carryInto`. */
  | { readonly kind: 'discard'; readonly senders: readonly string[]; readonly carryInto: MailId };

/**
 * Inbox policy (D2): pure decisions over an `InboxView`; the mailbox applies
 * them. Omitted members fall back to plain FIFO: enqueue, run the first
 * mail, always fresh. See `createInboxPolicy` for the IM admission policy.
 */
export interface InboxPolicy {
  onPost?(entry: InboxEntry, view: InboxView): InboxPostDecision;
  ready?(view: InboxView): InboxReadyDecision;
  staleOf?(view: InboxView & { readonly running: InboxRunning }): InboxStaleDecision;
  /** How long a lane's last finished batch stays visible as `lastTurn`. Default 0. */
  readonly memoryMs?: number;
}

/** Schedules `callback` after `delayMs`; returns a cancel function. */
export type InboxSetTimer = (callback: () => void, delayMs: number) => () => void;

export interface MailboxOptions {
  readonly run: ActorTurnRunner;
  readonly policy?: InboxPolicy;
  /** Max turns running at once across all keys. */
  readonly maxConcurrentTurns: number;
  /**
   * Hard cap on mails queued per key; posting beyond it is rejected. With a
   * merging policy this is a memory ceiling, the policy bounds turns.
   */
  readonly maxQueuedPerKey: number;
  /** A queued mail older than this when its lane would start is dropped (`expired`). `0`/omitted = never. */
  readonly queueTtlMs?: number;
  readonly now?: () => number;
  /** Defaults to an unref'd `setTimeout`. */
  readonly setTimer?: InboxSetTimer;
  /** Called once per finished batch (also on failure / cancel / drop). */
  readonly onTurnFinished?: (key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult) => void | Promise<void>;
}

export type PostResult =
  | {
      readonly accepted: true;
      /** 1-based queue position; 0 when the mail was consumed (`stopped`). */
      readonly position: number;
      readonly disposition: 'queued' | 'merged' | 'superseded' | 'stopped';
    }
  | { readonly accepted: false; readonly code: InboxRejectCode | 'mailbox_closed'; readonly message: string };

export interface Mailbox {
  post(mail: Mail): PostResult;
  /** Cancels the running turn for `mailId` (via its AbortSignal) or drops it if still queued. */
  cancel(mailId: MailId, reason?: string): boolean;
  /** Drops every queued mail of `senderId` in one lane; returns how many were dropped. */
  cancelSender(key: Pick<MailboxKey, 'actor' | 'lane'>, senderId: string, reason?: InboxDropReason): number;
  /** Resolves when no turn is running or queued. */
  idle(): Promise<void>;
  /** Stops accepting mail, aborts running turns, drops the queue. */
  close(reason?: string): Promise<void>;
}
