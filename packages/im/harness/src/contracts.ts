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
  | { readonly kind: 'human'; readonly text: string; readonly venue: VenueRef; readonly messageId?: string }
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
// Engagement journal (ADR 0048 §3.5)
// ---------------------------------------------------------------------------

export type EngagementEventType =
  | 'engagement_opened'
  | 'mail_admitted'
  | 'mail_denied'
  | 'turn_started'
  | 'turn_finished'
  | 'budget_granted'
  | 'budget_charged'
  | 'budget_exceeded'
  | 'escalated'
  | 'engagement_closed';

export interface EngagementEvent {
  readonly engagementId: EngagementId;
  /** 0-based, contiguous per engagement; assigned by the journal. */
  readonly seq: number;
  readonly at: number;
  readonly type: EngagementEventType;
  /** JSON-serializable payload; shape is per event type and documented at the call site. */
  readonly data: Readonly<Record<string, unknown>>;
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
}

// ---------------------------------------------------------------------------
// Mailbox scheduling (ADR 0048 §3.1)
// ---------------------------------------------------------------------------

/** Serial key: one actor runs one turn at a time within one engagement. */
export interface MailboxKey {
  readonly actor: ActorId;
  readonly engagementId: EngagementId;
}

export type TurnStatus = 'completed' | 'failed' | 'cancelled' | 'budget_exceeded';

export interface ActorTurnResult {
  readonly status: TurnStatus;
  /** Text handed back to the asker / delegator when the batch contains ask / delegate mail. */
  readonly content?: string;
}

/** Runs one actor turn over a batch of mails. Supplied by the agent layer. */
export type ActorTurnRunner = (actor: ActorId, batch: readonly Mail[], signal: AbortSignal) => Promise<ActorTurnResult>;

/**
 * Picks the next batch from an actor's pending mails (all for the same key,
 * in arrival order). Must return a non-empty prefix-preserving selection;
 * unselected mails stay queued. Default: the first mail only.
 */
export type BatchPolicy = (pending: readonly Mail[]) => readonly Mail[];

export interface MailboxOptions {
  readonly run: ActorTurnRunner;
  readonly batch?: BatchPolicy;
  /** Max turns running at once across all keys. */
  readonly maxConcurrentTurns: number;
  /** Max mails queued per key; posting beyond it is rejected. */
  readonly maxQueuedPerKey: number;
  /** Called once per finished batch (also on failure / cancel). */
  readonly onTurnFinished?: (key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult) => void | Promise<void>;
}

export type PostResult =
  | { readonly accepted: true; readonly position: number }
  | { readonly accepted: false; readonly code: 'queue_full' | 'mailbox_closed'; readonly message: string };

export interface Mailbox {
  post(mail: Mail): PostResult;
  /** Cancels the running turn for `mailId` (via its AbortSignal) or drops it if still queued. */
  cancel(mailId: MailId, reason?: string): boolean;
  /** Resolves when no turn is running or queued. */
  idle(): Promise<void>;
  /** Stops accepting mail, aborts running turns, drops the queue. */
  close(reason?: string): Promise<void>;
}
