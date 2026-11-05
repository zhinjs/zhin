/**
 * ADR 0048 Agent Harness — composition (H1).
 *
 * Wires the components behind the contracts: every mail is attenuated,
 * funded from its sender's grant, admitted by the guard kernel, journaled,
 * and only then posted to the mailbox. The agent layer supplies the turn
 * runner and calls `send` from its collaboration tools.
 *
 * Semantics:
 * - `ask` is synchronous for the asker: `send` resolves with the target's
 *   reply; the reply is journaled as a `result` mail but not posted to the
 *   asker's mailbox (the asker's turn is still running and consumes it).
 * - `delegate` is asynchronous: `send` resolves once the work is admitted;
 *   the target's reply is posted to the delegator's mailbox as a `result`
 *   mail, which wakes it with a new turn.
 * - `tell` expects nothing back.
 * - An `ask` whose target is (transitively) waiting on the asker would
 *   deadlock the serial mailbox; it is denied as `wait_cycle` and escalated.
 * - A denial with `escalate: true` freezes the whole engagement: an
 *   `escalated` event is journaled, `onEscalate` is called once so the host
 *   can ask the principal, every outstanding ask / delegate is cancelled
 *   (askers get a `cancelled` reply), and later sends are denied as `frozen`.
 * - An engagement closes when it has no running or queued turns and no
 *   outstanding ask / delegate; its root grant is closed then.
 * - Inbound mail (`human` / `timer` / `event`) enters through `deliver`
 *   (`open` is the same call): it opens an engagement and posts the root mail
 *   into the entry actor's inbox lane (D1). The inbox policy (`inbox.policy`,
 *   D2) decides what the mail does to that lane, also while a turn of the
 *   lane is running (mid-turn): queue, merge, supersede the running turn,
 *   stop it, or reject. Every turn of every actor runs inside the mailbox;
 *   there is no externally running root turn (H3, Q6).
 * - A merged batch (Q2) may span several engagements (one per human
 *   message); each engagement is accounted for by its own mails.
 * - A `result` for a mail that ran on an explicit lane returns on that lane,
 *   so delegated results wait for the lane's running turn (the root turn)
 *   instead of running beside it.
 */
import {
  ALL,
  DEFAULT_GUARD_LIMITS,
  type ActorId,
  type ActorTurnResult,
  type ActorTurnRunner,
  type AgentCeiling,
  type AgentName,
  type Authority,
  type AuthorityNarrowing,
  type BoardEntry,
  type BoardEntryKind,
  type BoardReadFilter,
  type BoardWriteInput,
  type BudgetAmounts,
  type BudgetLedger,
  type BudgetResult,
  type BudgetSnapshot,
  type Engagement,
  type EngagementGraphView,
  type EngagementId,
  type EngagementJournal,
  type FollowUpInput,
  type GrantId,
  type GuardDenyCode,
  type GuardKernel,
  type GuardLimits,
  type Mail,
  type MailBody,
  type MailId,
  type MailSender,
  type Mailbox,
  type MailboxKey,
  type InboxDropReason,
  type InboxPolicy,
  type InboxRejectCode,
  type InboxSetTimer,
  type MailboxOptions,
  type PostResult,
  type Principal,
  type RemoteMailResult,
  type RemoteMailTransport,
  type SendAck,
  type VenueRef,
} from './contracts.js';
import { agentOf } from './authority.js';
import { reconstructBoardFromEvents } from './journal.js';

export type HarnessDenyCode =
  | GuardDenyCode
  | InboxRejectCode
  | 'unknown_agent'
  | 'wait_cycle'
  | 'budget_exceeded'
  | 'closed'
  | 'frozen';

export type SendOutcome =
  | {
      readonly ok: true;
      readonly accepted?: true;
      readonly mailId?: MailId;
      readonly mail: Mail;
      readonly reply?: { readonly status: ActorTurnResult['status']; readonly content: string };
      readonly result?: { readonly status: ActorTurnResult['status'] | 'rejected'; readonly content: string };
    }
  | {
      readonly ok: false;
      readonly accepted?: false;
      readonly mailId?: MailId;
      readonly mail?: Mail;
      readonly code: HarnessDenyCode;
      readonly reason: string;
      readonly escalated: boolean;
      readonly reply?: { readonly status: ActorTurnResult['status']; readonly content: string };
      readonly result?: { readonly status: ActorTurnResult['status'] | 'rejected'; readonly content: string };
    };

export interface SendRequest {
  readonly kind: 'ask' | 'delegate' | 'tell';
  readonly to: ActorId;
  readonly text: string;
  readonly narrowing?: AuthorityNarrowing;
  readonly budget?: Partial<BudgetAmounts>;
  /** For `delegate`: what the delegator expects back. */
  readonly deliverable?: string;
  /** Optional timeout (ms) for remote transport calls. */
  readonly timeoutMs?: number;
}

export interface OpenEngagementInput {
  readonly principal: Principal;
  /** Actor that receives the root mail (the venue's entry actor). */
  readonly entry: ActorId;
  readonly body: Extract<MailBody, { kind: 'human' | 'timer' | 'event' }>;
  readonly budget: BudgetAmounts;
  readonly approvers?: readonly string[];
  readonly venue?: VenueRef;
  /**
   * Serial lane of the root mail inside the entry actor's inbox (D1): the IM
   * session key for human and scene-event mail, `timer:<jobId>` for timers,
   * `event:<source>` for webhooks. Omitted = the engagement's own lane.
   */
  readonly lane?: string;
  /**
   * Called synchronously with the admitted root mail right before it is
   * posted. The inbox may start its turn in the next microtask, before
   * `deliver` resolves, so a host that correlates turns with its own
   * callers registers the mail here.
   */
  readonly onPosting?: (root: Mail) => void;
}

/** How the inbox took an inbound mail. `stopped`: it was a stop request and was consumed. */
export type DeliverDisposition = Extract<PostResult, { accepted: true }>['disposition'];

export type OpenOutcome =
  | {
      readonly ok: true;
      readonly engagement: Engagement;
      readonly root: Mail;
      readonly disposition: DeliverDisposition;
      /** 1-based queue position; 0 when consumed (`stopped`). */
      readonly position: number;
    }
  | { readonly ok: false; readonly code: HarnessDenyCode; readonly reason: string };

/** `deliver` and `open` are the same call. */
export type DeliverOutcome = OpenOutcome;

export interface EscalationNotice {
  readonly engagement: Engagement;
  readonly mail: Mail;
  readonly code: HarnessDenyCode;
  readonly reason: string;
}

export interface HarnessOptions {
  readonly guard: GuardKernel;
  readonly ledger: BudgetLedger;
  readonly journal: EngagementJournal;
  readonly createMailbox: (options: MailboxOptions) => Mailbox;
  /**
   * Agent definitions' ceilings; `undefined` = unknown agent. `engagementId`
   * names the engagement asking, so a long-lived host can resolve agents per
   * engagement (the directory of the turn that opened it).
   */
  readonly ceilingOf: (agent: AgentName, engagementId: EngagementId) => AgentCeiling | undefined;
  readonly rootAuthority: (principal: Principal, ceiling: AgentCeiling, options?: { approvers?: readonly string[] }) => Authority;
  readonly attenuate: (parent: Authority, narrowing: AuthorityNarrowing, target: AgentCeiling, via: ActorId) => Authority;
  /** Runs one actor turn; the agent layer calls `harness.send` / `harness.charge` from inside it. */
  readonly runTurn: ActorTurnRunner;
  readonly limits?: GuardLimits;
  readonly maxConcurrentTurns?: number;
  readonly maxQueuedPerKey?: number;
  /** Inbox scheduling (H3): policy (D2), queue TTL and the timer / clock windows use. */
  readonly inbox?: Readonly<{
    policy?: InboxPolicy;
    queueTtlMs?: number;
    now?: () => number;
    setTimer?: InboxSetTimer;
  }>;
  readonly clock?: () => number;
  readonly newId?: () => string;
  readonly remoteTransport?: RemoteMailTransport;
  readonly onEscalate?: (notice: EscalationNotice) => void | Promise<void>;
  /** Called once when an engagement closed (after `engagement_closed` was journaled). */
  readonly onEngagementClosed?: (engagement: Engagement) => void;
  readonly onError?: (error: unknown) => void;
}

export type CreateHarnessOptions = HarnessOptions;

export interface Harness {
  /**
   * Delivers an inbound mail (`human` / `timer` / `event`): opens its
   * engagement and posts the root mail to the entry actor's inbox lane. May be
   * called at any time, including while a turn of that lane is running
   * (mid-turn delivery): the inbox policy then decides whether the new mail
   * queues, merges, supersedes or stops the running turn (whose stale reply
   * must then not be sent; see `ActorTurnControl.staleCheck`).
   */
  deliver(input: OpenEngagementInput): Promise<DeliverOutcome>;
  /** Same as `deliver`. */
  open(input: OpenEngagementInput): Promise<OpenOutcome>;
  /** Remaining budget of the grant `current` runs on. */
  remaining(current: Mail): BudgetAmounts | undefined;
  /** Called by collaboration tools while `current` (the mail being processed) is running. */
  send(from: ActorId, current: Mail, request: SendRequest): Promise<SendOutcome>;
  /** Follows up on previously delegated / asked work within the same engagement. */
  followUp(input: FollowUpInput): Promise<SendAck>;
  /** Writes an artifact, note, or todo item to the engagement's shared blackboard. */
  writeBoard(engagementId: EngagementId, input: BoardWriteInput): Promise<BoardEntry>;
  /** Reads entries from the engagement's shared blackboard, reconstructing from journal if needed. */
  readBoard(engagementId: EngagementId, filter?: BoardReadFilter): Promise<readonly BoardEntry[]>;
  /** Records model / tool usage against the grant of `current`. */
  charge(current: Mail, usage: Partial<BudgetAmounts>): Promise<BudgetResult<BudgetSnapshot>>;
  cancel(mailId: MailId, reason?: string): boolean;
  /** Drops every queued mail of `senderId` on one lane of `actor` (reported `cancelled` with `reason`). */
  cancelSender(actor: ActorId, lane: string, senderId: string, reason?: InboxDropReason): number;
  engagement(id: EngagementId): Engagement | undefined;
  graph(id: EngagementId): EngagementGraphView | undefined;
  idle(): Promise<void>;
  close(reason?: string): Promise<void>;
}


interface EngagementState {
  readonly engagement: Engagement;
  readonly initialBudget: BudgetAmounts;
  readonly mails: Mail[];
  readonly byId: Map<MailId, Mail>;
  /** Mails posted to the mailbox whose turn has not finished. */
  pendingTurns: number;
  /** ask / delegate mails without a reply yet. */
  readonly outstanding: Set<MailId>;
  closed: boolean;
  /** Set by the first escalation; the engagement accepts no new collaboration after it. */
  frozen?: { readonly code: HarnessDenyCode; readonly reason: string };
}

interface DelegatedMailRecord {
  readonly id: MailId;
  readonly engagementId: EngagementId;
  readonly from: ActorId;
  readonly to: ActorId;
  readonly authority: Authority;
  readonly parentMail: Mail;
  readonly lane?: string;
}

interface Waiter {
  readonly asker: ActorId;
  readonly engagementId: EngagementId;
  readonly resolve: (reply: { status: ActorTurnResult['status']; content: string }) => void;
}

export function createHarness(options: HarnessOptions): Harness {
  const limits = options.limits ?? DEFAULT_GUARD_LIMITS;
  const clock = options.clock ?? Date.now;
  let counter = 0;
  const newId = options.newId ?? (() => `m${++counter}`);
  const engagements = new Map<EngagementId, EngagementState>();
  const allEngagements = new Map<EngagementId, EngagementState>();
  const sentDelegations = new Map<MailId, DelegatedMailRecord>();
  const boards = new Map<EngagementId, Map<string, BoardEntry>>();
  const askWaiters = new Map<MailId, Waiter>();
  /** asker actor → actors it is currently waiting on (per engagement). */
  const waitingOn = new Map<string, Set<ActorId>>();
  let closed = false;

  const reportError = (error: unknown): void => {
    try { options.onError?.(error); } catch { /* reporting must not throw */ }
  };

  const mailbox = options.createMailbox({
    run: async (actor, batch, signal, control) => {
      const engagementId = batch[0]?.engagementId;
      if (engagementId) {
        await record(engagementId, 'turn_started', { actor, mails: batch.map((mail) => mail.id) }).catch(reportError);
      }
      return options.runTurn(actor, batch, signal, control);
    },
    maxConcurrentTurns: options.maxConcurrentTurns ?? 8,
    maxQueuedPerKey: options.maxQueuedPerKey ?? 16,
    ...(options.inbox?.policy ? { policy: options.inbox.policy } : {}),
    ...(options.inbox?.queueTtlMs !== undefined ? { queueTtlMs: options.inbox.queueTtlMs } : {}),
    ...(options.inbox?.now ? { now: options.inbox.now } : {}),
    ...(options.inbox?.setTimer ? { setTimer: options.inbox.setTimer } : {}),
    onTurnFinished: (key, batch, result) => onTurnFinished(key, batch, result),
  });

  function graphOf(state: EngagementState): EngagementGraphView {
    return {
      engagement: state.engagement,
      get mails() { return state.mails; },
      get: (id) => state.byId.get(id),
    };
  }

  async function record(engagementId: EngagementId, type: Parameters<EngagementJournal['append']>[0]['type'], data: Record<string, unknown>): Promise<void> {
    await options.journal.append({ engagementId, at: clock(), type, data });
  }

  function admit(state: EngagementState, mail: Mail): void {
    state.mails.push(mail);
    state.byId.set(mail.id, mail);
  }

  function waitKey(engagementId: EngagementId, actor: ActorId): string {
    return `${engagementId}\u0000${actor}`;
  }

  /** True when `target` is, directly or transitively, waiting on `asker`. */
  function wouldCycle(engagementId: EngagementId, asker: ActorId, target: ActorId): boolean {
    if (asker === target) return true;
    const seen = new Set<ActorId>();
    const stack = [target];
    for (let actor = stack.pop(); actor !== undefined; actor = stack.pop()) {
      if (actor === asker) return true;
      if (seen.has(actor)) continue;
      seen.add(actor);
      for (const next of waitingOn.get(waitKey(engagementId, actor)) ?? []) stack.push(next);
    }
    return false;
  }

  function mailSummary(mail: Mail): Record<string, unknown> {
    return {
      mailId: mail.id,
      kind: mail.kind,
      from: mail.from.kind === 'actor' ? mail.from.actor : mail.from.kind === 'human' ? `human:${mail.from.principal.id}` : `system:${mail.from.source}`,
      to: mail.to,
      causationId: mail.causationId ?? null,
      grantId: mail.grantId,
      tools: mail.authority.tools.kind === 'all' ? '*' : [...mail.authority.tools.names],
      trust: mail.authority.trust,
    };
  }

  async function escalate(state: EngagementState, mail: Mail, code: HarnessDenyCode, reason: string): Promise<void> {
    if (state.frozen) return;
    state.frozen = { code, reason };
    await record(state.engagement.id, 'escalated', { ...mailSummary(mail), code, reason });
    // Stop every branch still in flight; their askers receive a cancelled reply.
    for (const id of [...state.outstanding]) {
      if (!mailbox.cancel(id, `engagement frozen: ${reason}`)) {
        const waiter = askWaiters.get(id);
        if (waiter) {
          askWaiters.delete(id);
          state.outstanding.delete(id);
          waiter.resolve({ status: 'cancelled', content: `engagement frozen: ${reason}` });
        }
      }
    }
    try {
      await options.onEscalate?.({ engagement: state.engagement, mail, code, reason });
    } catch (error) {
      reportError(error);
    }
  }

  async function maybeCloseEngagement(state: EngagementState): Promise<void> {
    if (state.closed || state.pendingTurns > 0 || state.outstanding.size > 0) return;
    state.closed = true;
    const snapshot = options.ledger.close(state.engagement.rootGrantId);
    await record(state.engagement.id, 'engagement_closed', {
      status: state.frozen ? 'escalated' : 'completed',
      ...(state.frozen ? { reason: state.frozen.reason } : {}),
      budget: snapshot.ok ? { spent: snapshot.value.spent, granted: snapshot.value.granted } : null,
    });
    await options.journal.compact?.(state.engagement.id).catch(reportError);
    engagements.delete(state.engagement.id);
    try { options.onEngagementClosed?.(state.engagement); } catch (error) { reportError(error); }
  }

  type Posted =
    | { readonly ok: true; readonly disposition: DeliverDisposition; readonly position: number }
    | { readonly ok: false; readonly code: InboxRejectCode | 'closed'; readonly reason: string };

  function post(state: EngagementState, mail: Mail): Posted {
    const posted = mailbox.post(mail);
    if (!posted.accepted) {
      return { ok: false, code: posted.code === 'mailbox_closed' ? 'closed' : posted.code, reason: posted.message };
    }
    // A stop request is consumed by the inbox: it never becomes a turn.
    if (posted.disposition !== 'stopped') state.pendingTurns += 1;
    return { ok: true, disposition: posted.disposition, position: posted.position };
  }

  async function onTurnFinished(key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult): Promise<void> {
    // A merged batch (Q2) may carry mails of several engagements.
    const byEngagement = new Map<EngagementId, Mail[]>();
    for (const mail of batch) {
      const list = byEngagement.get(mail.engagementId);
      if (list) list.push(mail);
      else byEngagement.set(mail.engagementId, [mail]);
    }
    for (const [engagementId, mails] of byEngagement) {
      const state = engagements.get(engagementId);
      if (!state) continue;
      state.pendingTurns -= mails.length;
      try {
        await record(state.engagement.id, 'turn_finished', {
          actor: key.actor,
          mails: mails.map((mail) => mail.id),
          status: result.status,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(engagementId !== key.engagementId ? { carriedBy: key.engagementId } : {}),
        });
        for (const mail of mails) {
          if (mail.body.kind === 'tell') options.ledger.close(mail.grantId);
          if (mail.body.kind !== 'ask' && mail.body.kind !== 'delegate') continue;
          await reply(state, mail, result);
        }
      } catch (error) {
        reportError(error);
      } finally {
        await maybeCloseEngagement(state).catch(reportError);
      }
    }
  }

  /** Sends the target's reply for an ask / delegate back to its sender. */
  async function reply(state: EngagementState, request: Mail, result: ActorTurnResult): Promise<void> {
    if (request.from.kind !== 'actor') return;
    const requester = request.from.actor;
    const content = result.content ?? '';
    const parent = request.causationId ? state.byId.get(request.causationId) : undefined;
    const back: Mail = Object.freeze({
      id: newId(),
      kind: 'result',
      engagementId: state.engagement.id,
      causationId: request.id,
      from: Object.freeze({ kind: 'actor', actor: request.to }) as MailSender,
      to: requester,
      // Back on the requester's lane, behind the turn that asked (it may still be running).
      ...(parent?.lane !== undefined && parent.to === requester ? { lane: parent.lane } : {}),
      // The reply runs with the requester's own authority and grant, never the replier's.
      authority: parent?.authority ?? request.authority,
      grantId: parent?.grantId ?? request.grantId,
      body: Object.freeze({ kind: 'result', inReplyTo: request.id, status: result.status, content }),
      createdAt: clock(),
    });
    options.ledger.close(request.grantId);
    state.outstanding.delete(request.id);
    const ceiling = options.ceilingOf(agentOf(requester), state.engagement.id);
    const decision = ceiling
      ? options.guard.admitMail(back, { graph: graphOf(state), targetCeiling: ceiling, limits })
      : { allow: false as const, code: 'not_accepted_by_target' as const, reason: `unknown agent ${requester}`, escalate: false };
    if (!decision.allow) {
      await record(state.engagement.id, 'mail_denied', { ...mailSummary(back), code: decision.code, reason: decision.reason });
      askWaiters.get(request.id)?.resolve({ status: 'failed', content: decision.reason });
      askWaiters.delete(request.id);
      return;
    }
    admit(state, back);
    await record(state.engagement.id, 'mail_admitted', mailSummary(back));
    const waiter = askWaiters.get(request.id);
    if (waiter) {
      askWaiters.delete(request.id);
      waitingOn.get(waitKey(state.engagement.id, waiter.asker))?.delete(request.to);
      waiter.resolve({ status: result.status, content });
      return;
    }
    const posted = post(state, back);
    if (!posted.ok) await record(state.engagement.id, 'mail_denied', { ...mailSummary(back), code: posted.code, reason: posted.reason });
  }

  async function deliver(input: OpenEngagementInput): Promise<DeliverOutcome> {
    if (closed) return { ok: false, code: 'closed', reason: 'harness is closed' };
    const engagementId = newId();
    const ceiling = options.ceilingOf(agentOf(input.entry), engagementId);
    if (!ceiling) return { ok: false, code: 'unknown_agent', reason: `unknown agent ${agentOf(input.entry)}` };
    const rootGrantId = options.ledger.openRoot(input.budget);
    const rootMailId = newId();
    const engagement: Engagement = Object.freeze({
      id: engagementId,
      principal: input.principal,
      rootMailId,
      rootGrantId,
      venue: input.venue,
      openedAt: clock(),
    });
    const from: MailSender = input.body.kind === 'human'
      ? { kind: 'human', principal: input.principal }
      : { kind: 'system', source: input.body.kind === 'timer' ? 'timer' : 'event' };
    const root: Mail = Object.freeze({
      id: rootMailId,
      kind: input.body.kind,
      engagementId,
      from: Object.freeze(from),
      to: input.entry,
      ...(input.lane !== undefined ? { lane: input.lane } : {}),
      authority: options.rootAuthority(input.principal, ceiling, { approvers: input.approvers }),
      grantId: rootGrantId,
      body: input.body,
      createdAt: clock(),
    });
    const state: EngagementState = {
      engagement,
      initialBudget: input.budget,
      mails: [],
      byId: new Map(),
      pendingTurns: 0,
      outstanding: new Set(),
      closed: false,
    };
    engagements.set(engagementId, state);
    allEngagements.set(engagementId, state);
    await record(engagementId, 'engagement_opened', {
      principal: input.principal.id,
      initiator: input.principal,
      ...(input.venue ? { venue: input.venue } : {}),
      entry: input.entry,
      rootMailId,
      rootGrantId,
      budget: input.budget,
      ...(input.lane !== undefined ? { lane: input.lane } : {}),
    });
    const decision = options.guard.admitMail(root, { graph: graphOf(state), targetCeiling: ceiling, limits });
    if (!decision.allow) {
      await record(engagementId, 'mail_denied', { ...mailSummary(root), code: decision.code, reason: decision.reason });
      await maybeCloseEngagement(state);
      return { ok: false, code: decision.code, reason: decision.reason };
    }
    admit(state, root);
    await record(engagementId, 'mail_admitted', mailSummary(root));
    if (closed) {
      await maybeCloseEngagement(state);
      return { ok: false, code: 'closed', reason: 'harness is closed' };
    }
    try {
      input.onPosting?.(root);
    } catch (error) {
      reportError(error);
    }
    const posted = post(state, root);
    if (!posted.ok) {
      await record(engagementId, 'mail_denied', { ...mailSummary(root), code: posted.code, reason: posted.reason });
      await maybeCloseEngagement(state);
      return { ok: false, code: posted.code, reason: posted.reason };
    }
    if (posted.disposition === 'stopped') await maybeCloseEngagement(state);
    return { ok: true, engagement, root, disposition: posted.disposition, position: posted.position };
  }

  async function sendInternal(
    from: ActorId,
    current: Mail,
    request: SendRequest,
    overrides?: { readonly causationId?: MailId; readonly authority?: Authority },
  ): Promise<SendOutcome> {
    const state = engagements.get(current.engagementId);
    const deny = async (code: HarnessDenyCode, reason: string, mail?: Mail, escalateIt = false): Promise<SendOutcome> => {
      if (state && mail) {
        await record(state.engagement.id, 'mail_denied', { ...mailSummary(mail), code, reason });
        if (escalateIt) await escalate(state, mail, code, reason);
      }
      return { ok: false, accepted: false, code, reason, escalated: escalateIt && Boolean(state && mail) };
    };
    if (closed) return deny('closed', 'harness is closed');
    if (!state || state.closed) return deny('unknown_engagement', `engagement ${current.engagementId} is not open`);
    if (state.frozen) {
      return {
        ok: false,
        accepted: false,
        code: 'frozen',
        reason: `collaboration is paused for the human to decide: ${state.frozen.reason}`,
        escalated: true,
      };
    }
    if (current.to !== from || !state.byId.has(current.id)) {
      return deny('authority_not_attenuated', `${from} is not processing mail ${current.id}`);
    }
    const isRemote = Boolean(options.remoteTransport?.canRoute(request.to));
    const ceiling = options.ceilingOf(agentOf(request.to), state.engagement.id)
      ?? (isRemote
        ? {
            agent: agentOf(request.to),
            tools: ALL,
            contacts: ALL,
            maxTrust: 'master' as const,
            egress: { network: true, hosts: ALL },
            acceptsFrom: ALL,
          }
        : undefined);
    if (!ceiling) return deny('unknown_agent', `unknown agent ${agentOf(request.to)}`);

    const budgetRequest = request.budget ?? ceiling.defaultBudget ?? {};
    const granted = options.ledger.grant(current.grantId, budgetRequest);
    const grantId: GrantId = granted.ok ? granted.value : current.grantId;
    const body: MailBody = request.kind === 'ask'
      ? { kind: 'ask', question: request.text }
      : request.kind === 'delegate'
        ? { kind: 'delegate', brief: request.text, ...(request.deliverable ? { deliverable: request.deliverable } : {}) }
        : { kind: 'tell', content: request.text };
    const mail: Mail = Object.freeze({
      id: newId(),
      kind: request.kind,
      engagementId: state.engagement.id,
      causationId: overrides?.causationId ?? current.id,
      from: Object.freeze({ kind: 'actor', actor: from }) as MailSender,
      to: request.to,
      authority: overrides?.authority ?? options.attenuate(current.authority, request.narrowing ?? {}, ceiling, from),
      grantId,
      body: Object.freeze(body),
      createdAt: clock(),
    });
    if (!granted.ok) return deny('budget_exceeded', granted.message, mail);

    const decision = options.guard.admitMail(mail, {
      graph: graphOf(state),
      targetCeiling: ceiling,
      senderAuthority: current.authority,
      limits,
    });
    if (!decision.allow) {
      options.ledger.close(grantId);
      return deny(decision.code, decision.reason, mail, decision.escalate);
    }
    if (request.kind === 'ask' && wouldCycle(state.engagement.id, from, request.to)) {
      options.ledger.close(grantId);
      return deny('wait_cycle', `${request.to} is waiting on ${from}; asking it back would deadlock`, mail, true);
    }

    admit(state, mail);
    await record(state.engagement.id, 'mail_admitted', mailSummary(mail));
    const snapshot = options.ledger.snapshot(grantId);
    if (granted.ok && request.kind !== 'tell') {
      await record(state.engagement.id, 'budget_granted', {
        grantId,
        parentId: current.grantId,
        granted: snapshot?.granted ?? null,
      });
    }
    if (request.kind === 'ask' || request.kind === 'delegate') {
      sentDelegations.set(mail.id, {
        id: mail.id,
        engagementId: state.engagement.id,
        from,
        to: request.to,
        authority: mail.authority,
        parentMail: current,
        ...(current.lane !== undefined ? { lane: current.lane } : {}),
      });
    }

    if (isRemote && options.remoteTransport) {
      const remoteTransport = options.remoteTransport;
      const grantedAmounts: BudgetAmounts = snapshot?.granted ?? {
        modelCalls: 0,
        tokens: 0,
        wallMs: 0,
        sideEffects: 0,
      };
      if (request.kind === 'tell') {
        void Promise.resolve()
          .then(() => remoteTransport.send(mail, grantedAmounts))
          .then(async (remoteRes) => {
            if (remoteRes?.consumed && Object.keys(remoteRes.consumed).length > 0) {
              const ch = options.ledger.charge(grantId, remoteRes.consumed);
              await record(state.engagement.id, ch.ok ? 'budget_charged' : 'budget_exceeded', {
                grantId,
                mailId: mail.id,
                usage: remoteRes.consumed,
                ...(ch.ok ? {} : { exhausted: ch.exhausted ?? [] }),
              });
            }
          })
          .catch(reportError)
          .finally(() => {
            options.ledger.close(grantId);
            void maybeCloseEngagement(state).catch(reportError);
          });
        return { ok: true, accepted: true, mailId: mail.id, mail };
      }

      state.outstanding.add(mail.id);
      let remoteResult: RemoteMailResult;
      try {
        const sendPromise = options.remoteTransport.send(mail, grantedAmounts);
        if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<RemoteMailResult>((resolve) => {
            timer = setTimeout(() => {
              resolve({
                status: 'cancelled',
                content: `remote mail ${mail.id} timed out after ${request.timeoutMs}ms`,
              });
            }, request.timeoutMs);
            timer.unref?.();
          });
          remoteResult = await Promise.race([sendPromise, timeoutPromise]).finally(() => {
            if (timer !== undefined) clearTimeout(timer);
          });
        } else {
          remoteResult = await sendPromise;
        }
      } catch (error) {
        remoteResult = {
          status: 'rejected',
          content: error instanceof Error ? error.message : String(error),
        };
      } finally {
        state.outstanding.delete(mail.id);
      }

      const consumed = remoteResult.consumed ?? { modelCalls: 1 };
      const chargeRes = options.ledger.charge(grantId, consumed);
      await record(state.engagement.id, chargeRes.ok ? 'budget_charged' : 'budget_exceeded', {
        grantId,
        mailId: mail.id,
        usage: consumed,
        ...(chargeRes.ok ? {} : { exhausted: chargeRes.exhausted ?? [] }),
      });
      options.ledger.close(grantId);
      await record(state.engagement.id, 'mail_delivered', { mailId: mail.id, actor: request.to });
      if (remoteResult.status === 'completed') {
        await record(state.engagement.id, 'mail_completed', {
          mailId: mail.id,
          actor: request.to,
          status: 'completed',
          content: remoteResult.content,
        });
      } else {
        await record(state.engagement.id, 'mail_cancelled', {
          mailId: mail.id,
          actor: request.to,
          status: remoteResult.status,
          reason: remoteResult.content,
        });
      }
      await maybeCloseEngagement(state).catch(reportError);
      const turnStatus: ActorTurnResult['status'] =
        remoteResult.status === 'completed'
          ? 'completed'
          : remoteResult.status === 'cancelled'
            ? 'cancelled'
            : 'failed';
      return {
        ok: true,
        accepted: true,
        mailId: mail.id,
        mail,
        reply: { status: turnStatus, content: remoteResult.content },
        result: { status: remoteResult.status, content: remoteResult.content },
      };
    }

    if (request.kind !== 'tell') state.outstanding.add(mail.id);

    let replied: Promise<{ status: ActorTurnResult['status']; content: string }> | undefined;
    if (request.kind === 'ask') {
      replied = new Promise((resolve) => askWaiters.set(mail.id, { asker: from, engagementId: state.engagement.id, resolve }));
      const key = waitKey(state.engagement.id, from);
      const set = waitingOn.get(key) ?? new Set<ActorId>();
      set.add(request.to);
      waitingOn.set(key, set);
    }
    const posted = post(state, mail);
    if (!posted.ok) {
      state.outstanding.delete(mail.id);
      askWaiters.delete(mail.id);
      waitingOn.get(waitKey(state.engagement.id, from))?.delete(request.to);
      options.ledger.close(grantId);
      return deny(posted.code, posted.reason, mail);
    }
    if (!replied) return { ok: true, accepted: true, mailId: mail.id, mail };
    const replyVal = await replied;
    return { ok: true, accepted: true, mailId: mail.id, mail, reply: replyVal, result: replyVal };
  }

  return {
    deliver,

    open: deliver,

    remaining(current) {
      return options.ledger.snapshot(current.grantId)?.remaining;
    },

    send(from, current, request) {
      return sendInternal(from, current, request);
    },

    async followUp(input) {
      const original = sentDelegations.get(input.mailId);
      if (!original || original.from !== input.from) {
        return Object.freeze({
          ok: false,
          accepted: false,
          mailId: input.mailId,
          code: 'missing_causation',
          reason: Object.freeze({
            code: 'missing_causation',
            detail: !original
              ? `unknown delegated mail ${input.mailId}`
              : `mail ${input.mailId} was sent by ${original.from}, not ${input.from}`,
          }),
          escalated: false,
        });
      }
      const state = engagements.get(original.engagementId) ?? allEngagements.get(original.engagementId);
      if (!state) {
        return Object.freeze({
          ok: false,
          accepted: false,
          mailId: input.mailId,
          code: 'unknown_engagement',
          reason: Object.freeze({
            code: 'unknown_engagement',
            detail: `engagement ${original.engagementId} does not exist`,
          }),
          escalated: false,
        });
      }
      const wasClosed = state.closed;
      let carrierMail = original.parentMail;
      if (wasClosed) {
        state.closed = false;
        engagements.set(state.engagement.id, state);
      }
      const snap = options.ledger.snapshot(carrierMail.grantId);
      if (!snap || snap.closed) {
        const reopenedGrant = options.ledger.openRoot(state.initialBudget);
        carrierMail = Object.freeze({ ...carrierMail, grantId: reopenedGrant });
        state.byId.set(carrierMail.id, carrierMail);
      }

      const outcome = await sendInternal(
        input.from,
        carrierMail,
        {
          kind: 'ask',
          to: original.to,
          text: `[Follow-up on ${input.mailId}]\n${input.content}`,
          ...(input.budget ? { budget: input.budget } : {}),
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        },
        {
          causationId: input.mailId,
          authority: original.authority,
        },
      );

      if (wasClosed) {
        await maybeCloseEngagement(state).catch(reportError);
      }

      if (!outcome.ok) {
        return Object.freeze({
          ok: false,
          accepted: false,
          mailId: input.mailId,
          code: outcome.code,
          reason: Object.freeze({ code: outcome.code, detail: outcome.reason }),
          escalated: outcome.escalated,
        });
      }
      return Object.freeze({
        ok: true,
        accepted: true,
        mailId: outcome.mail.id,
        mail: outcome.mail,
        ...(outcome.reply ? { reply: outcome.reply } : {}),
        ...(outcome.result ? { result: outcome.result } : outcome.reply ? { result: outcome.reply } : {}),
      });
    },

    async writeBoard(engagementId, input) {
      const key = typeof input.key === 'string' ? input.key.trim() : '';
      if (!key) throw new TypeError('Board entry key must be a non-empty string');
      const kind: BoardEntryKind = input.kind ?? 'note';
      let board = boards.get(engagementId);
      if (!board) {
        board = new Map<string, BoardEntry>();
        boards.set(engagementId, board);
      }
      const existing = board.get(key);
      const version = (existing?.version ?? 0) + 1;
      const updatedAt = clock();
      const entry: BoardEntry = Object.freeze({
        key,
        kind,
        content: input.content,
        author: input.author,
        updatedAt,
        version,
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      board.set(key, entry);
      await record(engagementId, 'board_written', {
        actor: input.author,
        key,
        kind,
        content: input.content,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.mailId !== undefined ? { mailId: input.mailId } : {}),
        version,
      });
      return entry;
    },

    async readBoard(engagementId, filter) {
      const board = boards.get(engagementId);
      if (board && board.size > 0) {
        const entries = [...board.values()].filter((entry) => {
          if (filter?.key !== undefined && entry.key !== filter.key) return false;
          if (filter?.kind !== undefined && entry.kind !== filter.kind) return false;
          return true;
        });
        return Object.freeze(entries);
      }
      const records = await options.journal.read(engagementId);
      return reconstructBoardFromEvents(records, filter);
    },

    async charge(current, usage) {
      const result = options.ledger.charge(current.grantId, usage);
      await record(current.engagementId, result.ok ? 'budget_charged' : 'budget_exceeded', {
        grantId: current.grantId,
        mailId: current.id,
        usage,
        ...(result.ok ? {} : { exhausted: result.exhausted ?? [] }),
      });
      return result;
    },

    cancel(mailId, reason) {
      return mailbox.cancel(mailId, reason);
    },

    cancelSender(actor, lane, senderId, reason) {
      return mailbox.cancelSender({ actor, lane }, senderId, reason);
    },

    engagement(id) {
      return engagements.get(id)?.engagement;
    },

    graph(id) {
      const state = engagements.get(id) ?? allEngagements.get(id);
      return state ? graphOf(state) : undefined;
    },

    idle() {
      return mailbox.idle();
    },

    async close(reason) {
      closed = true;
      await mailbox.close(reason);
      for (const waiter of askWaiters.values()) waiter.resolve({ status: 'cancelled', content: reason ?? 'harness closed' });
      askWaiters.clear();
    },
  };
}
