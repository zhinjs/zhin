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
 */
import {
  DEFAULT_GUARD_LIMITS,
  type ActorId,
  type ActorTurnResult,
  type ActorTurnRunner,
  type AgentCeiling,
  type AgentName,
  type Authority,
  type AuthorityNarrowing,
  type BudgetAmounts,
  type BudgetLedger,
  type BudgetResult,
  type BudgetSnapshot,
  type Engagement,
  type EngagementGraphView,
  type EngagementId,
  type EngagementJournal,
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
  type MailboxOptions,
  type Principal,
  type VenueRef,
} from './contracts.js';
import { agentOf } from './authority.js';

export type HarnessDenyCode = GuardDenyCode | 'unknown_agent' | 'wait_cycle' | 'budget_exceeded' | 'queue_full' | 'closed' | 'frozen';

export type SendOutcome =
  | { readonly ok: true; readonly mail: Mail; readonly reply?: { readonly status: ActorTurnResult['status']; readonly content: string } }
  | { readonly ok: false; readonly code: HarnessDenyCode; readonly reason: string; readonly escalated: boolean };

export interface SendRequest {
  readonly kind: 'ask' | 'delegate' | 'tell';
  readonly to: ActorId;
  readonly text: string;
  readonly narrowing?: AuthorityNarrowing;
  readonly budget?: Partial<BudgetAmounts>;
  /** For `delegate`: what the delegator expects back. */
  readonly deliverable?: string;
}

export interface OpenEngagementInput {
  readonly principal: Principal;
  /** Actor that receives the root mail (the venue's entry actor). */
  readonly entry: ActorId;
  readonly body: Extract<MailBody, { kind: 'human' | 'timer' | 'event' }>;
  readonly budget: BudgetAmounts;
  readonly approvers?: readonly string[];
  readonly venue?: VenueRef;
}

export interface AttachedEngagement {
  readonly engagement: Engagement;
  readonly root: Mail;
  /**
   * Ends the externally running root turn. `delegate` results that came back
   * for the root actor while it was attached are posted to its mailbox now,
   * so the root actor continues with them in a normal actor turn (results
   * arriving later go there directly). Returns the re-posted mails.
   * Idempotent.
   */
  detach(result: ActorTurnResult): Promise<readonly Mail[]>;
}

export type AttachOutcome =
  | ({ readonly ok: true } & AttachedEngagement)
  | { readonly ok: false; readonly code: HarnessDenyCode; readonly reason: string };

export type OpenOutcome =
  | { readonly ok: true; readonly engagement: Engagement; readonly root: Mail }
  | { readonly ok: false; readonly code: HarnessDenyCode; readonly reason: string };

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
  /** Agent definitions' ceilings; `undefined` = unknown agent. */
  readonly ceilingOf: (agent: AgentName) => AgentCeiling | undefined;
  readonly rootAuthority: (principal: Principal, ceiling: AgentCeiling, options?: { approvers?: readonly string[] }) => Authority;
  readonly attenuate: (parent: Authority, narrowing: AuthorityNarrowing, target: AgentCeiling, via: ActorId) => Authority;
  /** Runs one actor turn; the agent layer calls `harness.send` / `harness.charge` from inside it. */
  readonly runTurn: ActorTurnRunner;
  readonly limits?: GuardLimits;
  readonly maxConcurrentTurns?: number;
  readonly maxQueuedPerKey?: number;
  readonly clock?: () => number;
  readonly newId?: () => string;
  readonly onEscalate?: (notice: EscalationNotice) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export interface Harness {
  open(input: OpenEngagementInput): Promise<OpenOutcome>;
  /**
   * Opens an engagement whose root turn is already running outside the
   * mailbox (the live IM turn). The root actor counts as busy until `detach`.
   */
  attach(input: OpenEngagementInput): Promise<AttachOutcome>;
  /** Remaining budget of the grant `current` runs on. */
  remaining(current: Mail): BudgetAmounts | undefined;
  /** Called by collaboration tools while `current` (the mail being processed) is running. */
  send(from: ActorId, current: Mail, request: SendRequest): Promise<SendOutcome>;
  /** Records model / tool usage against the grant of `current`. */
  charge(current: Mail, usage: Partial<BudgetAmounts>): Promise<BudgetResult<BudgetSnapshot>>;
  cancel(mailId: MailId, reason?: string): boolean;
  engagement(id: EngagementId): Engagement | undefined;
  graph(id: EngagementId): EngagementGraphView | undefined;
  idle(): Promise<void>;
  close(reason?: string): Promise<void>;
}


interface EngagementState {
  readonly engagement: Engagement;
  readonly mails: Mail[];
  readonly byId: Map<MailId, Mail>;
  /** Mails posted to the mailbox whose turn has not finished. */
  pendingTurns: number;
  /** ask / delegate mails without a reply yet. */
  readonly outstanding: Set<MailId>;
  closed: boolean;
  /** Set by the first escalation; the engagement accepts no new collaboration after it. */
  frozen?: { readonly code: HarnessDenyCode; readonly reason: string };
  /** Root actor running outside the mailbox, and results held for it until detach. */
  attached?: { readonly actor: ActorId; readonly held: Mail[] };
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
      budget: snapshot.ok ? { spent: snapshot.value.spent, granted: snapshot.value.granted } : null,
    });
    engagements.delete(state.engagement.id);
  }

  async function post(state: EngagementState, mail: Mail): Promise<{ ok: true } | { ok: false; reason: string }> {
    const posted = mailbox.post(mail);
    if (!posted.accepted) return { ok: false, reason: posted.message };
    state.pendingTurns += 1;
    return { ok: true };
  }

  async function onTurnFinished(key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult): Promise<void> {
    const state = engagements.get(key.engagementId);
    if (!state) return;
    state.pendingTurns -= 1;
    try {
      await record(state.engagement.id, 'turn_finished', { actor: key.actor, mails: batch.map((mail) => mail.id), status: result.status });
      for (const mail of batch) {
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
      // The reply runs with the requester's own authority and grant, never the replier's.
      authority: parent?.authority ?? request.authority,
      grantId: parent?.grantId ?? request.grantId,
      body: Object.freeze({ kind: 'result', inReplyTo: request.id, status: result.status, content }),
      createdAt: clock(),
    });
    options.ledger.close(request.grantId);
    state.outstanding.delete(request.id);
    const ceiling = options.ceilingOf(agentOf(requester));
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
    if (state.attached && state.attached.actor === requester) {
      state.attached.held.push(back);
      return;
    }
    const posted = await post(state, back);
    if (!posted.ok) await record(state.engagement.id, 'mail_denied', { ...mailSummary(back), code: 'queue_full', reason: posted.reason });
  }

  async function begin(input: OpenEngagementInput, attach: boolean): Promise<
    | { ok: true; state: EngagementState; root: Mail }
    | { ok: false; code: HarnessDenyCode; reason: string }
  > {
    if (closed) return { ok: false, code: 'closed', reason: 'harness is closed' };
    const ceiling = options.ceilingOf(agentOf(input.entry));
    if (!ceiling) return { ok: false, code: 'unknown_agent', reason: `unknown agent ${agentOf(input.entry)}` };
    const rootGrantId = options.ledger.openRoot(input.budget);
    const engagementId = newId();
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
      authority: options.rootAuthority(input.principal, ceiling, { approvers: input.approvers }),
      grantId: rootGrantId,
      body: input.body,
      createdAt: clock(),
    });
    const state: EngagementState = { engagement, mails: [], byId: new Map(), pendingTurns: 0, outstanding: new Set(), closed: false };
    engagements.set(engagementId, state);
    await record(engagementId, 'engagement_opened', { principal: input.principal.id, entry: input.entry, rootMailId, rootGrantId, budget: input.budget });
    const decision = options.guard.admitMail(root, { graph: graphOf(state), targetCeiling: ceiling, limits });
    if (!decision.allow) {
      await record(engagementId, 'mail_denied', { ...mailSummary(root), code: decision.code, reason: decision.reason });
      await maybeCloseEngagement(state);
      return { ok: false, code: decision.code, reason: decision.reason };
    }
    admit(state, root);
    await record(engagementId, 'mail_admitted', mailSummary(root));
    if (attach) {
      state.attached = { actor: input.entry, held: [] };
      state.pendingTurns += 1;
      await record(engagementId, 'turn_started', { actor: input.entry, mails: [rootMailId], attached: true });
      return { ok: true, state, root };
    }
    const posted = await post(state, root);
    if (!posted.ok) {
      await maybeCloseEngagement(state);
      return { ok: false, code: 'queue_full', reason: posted.reason };
    }
    return { ok: true, state, root };
    }


  return {
    async open(input) {
      const opened = await begin(input, false);
      return opened.ok ? { ok: true, engagement: opened.state.engagement, root: opened.root } : opened;
    },

    async attach(input) {
      const opened = await begin(input, true);
      if (!opened.ok) return opened;
      const { state, root } = opened;
      let detached: Promise<readonly Mail[]> | undefined;
      const detach = (result: ActorTurnResult): Promise<readonly Mail[]> => {
        detached ??= (async () => {
          const held = state.attached?.held.splice(0) ?? [];
          state.attached = undefined;
          state.pendingTurns -= 1;
          try {
            await record(state.engagement.id, 'turn_finished', { actor: root.to, mails: [root.id], status: result.status, held: held.map((mail) => mail.id) });
          } catch (error) {
            reportError(error);
          }
          for (const mail of held) {
            const posted = await post(state, mail);
            if (!posted.ok) await record(state.engagement.id, 'mail_denied', { ...mailSummary(mail), code: 'queue_full', reason: posted.reason }).catch(reportError);
          }
          await maybeCloseEngagement(state).catch(reportError);
          return Object.freeze(held);
        })();
        return detached;
      };
      return { ok: true, engagement: state.engagement, root, detach };
    },

    remaining(current) {
      return options.ledger.snapshot(current.grantId)?.remaining;
    },

    async send(from, current, request) {
      const state = engagements.get(current.engagementId);
      const deny = async (code: HarnessDenyCode, reason: string, mail?: Mail, escalateIt = false): Promise<SendOutcome> => {
        if (state && mail) {
          await record(state.engagement.id, 'mail_denied', { ...mailSummary(mail), code, reason });
          if (escalateIt) await escalate(state, mail, code, reason);
        }
        return { ok: false, code, reason, escalated: escalateIt && Boolean(state && mail) };
      };
      if (closed) return deny('closed', 'harness is closed');
      if (!state || state.closed) return deny('unknown_engagement', `engagement ${current.engagementId} is not open`);
      if (state.frozen) return { ok: false, code: 'frozen', reason: `collaboration is paused for the human to decide: ${state.frozen.reason}`, escalated: true };
      if (current.to !== from || !state.byId.has(current.id)) {
        return deny('authority_not_attenuated', `${from} is not processing mail ${current.id}`);
      }
      const ceiling = options.ceilingOf(agentOf(request.to));
      if (!ceiling) return deny('unknown_agent', `unknown agent ${agentOf(request.to)}`);

      const granted = options.ledger.grant(current.grantId, request.budget ?? {});
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
        causationId: current.id,
        from: Object.freeze({ kind: 'actor', actor: from }) as MailSender,
        to: request.to,
        authority: options.attenuate(current.authority, request.narrowing ?? {}, ceiling, from),
        grantId,
        body: Object.freeze(body),
        createdAt: clock(),
      });
      if (!granted.ok) return deny('budget_exceeded', granted.message, mail);

      const decision = options.guard.admitMail(mail, { graph: graphOf(state), targetCeiling: ceiling, senderAuthority: current.authority, limits });
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
      if (granted.ok && request.kind !== 'tell') {
        const snapshot = options.ledger.snapshot(grantId);
        await record(state.engagement.id, 'budget_granted', { grantId, parentId: current.grantId, granted: snapshot?.granted ?? null });
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
      const posted = await post(state, mail);
      if (!posted.ok) {
        state.outstanding.delete(mail.id);
        askWaiters.delete(mail.id);
        waitingOn.get(waitKey(state.engagement.id, from))?.delete(request.to);
        options.ledger.close(grantId);
        return deny('queue_full', posted.reason, mail);
      }
      if (!replied) return { ok: true, mail };
      return { ok: true, mail, reply: await replied };
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

    engagement(id) {
      return engagements.get(id)?.engagement;
    },

    graph(id) {
      const state = engagements.get(id);
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
