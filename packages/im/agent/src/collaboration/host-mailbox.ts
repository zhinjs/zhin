/**
 * ADR 0048 H3 — the host's long-lived harness and Mailbox (D3).
 *
 * Every IM turn goes through here: the ingress posts the message as a
 * `human` Mail (a scene event as an `event` Mail, a due timer as a `timer` Mail) on its lane via
 * `harness.open()`, and the inbox policy (`createInboxPolicy`, configured by
 * `ai.agent.mailbox`) decides admission, queueing, merge / danmaku windows,
 * supersede, stop and stale replies. When the Mailbox starts a batch, the
 * ingress call that carries it receives a `run` admission and runs the real
 * turn; the turn's end settles the batch.
 *
 * The harness lives as long as the host (one ingress generation), also when
 * there are no peer agents: a turn with peers binds its collaboration
 * directory and actor runner to its engagement (`bindCollaboration`); a turn
 * without peers gets no collaboration tools. Delegated work and results run
 * as actor turns of the same harness; results for the entry actor return on
 * the session lane, behind the turn that delegated.
 *
 * Carrier rule: a batch is run by the first mail of the batch whose ingress
 * call is still waiting. A mail that joined a group resolves `merged` at
 * once; a mail whose turn was superseded or discarded is already settled and
 * only rides along. When the carrier's own mail was stopped / evicted while
 * others of its group remain, the carrier keeps waiting and still runs the
 * group (as the former gate did).
 */
import {
  ALL,
  DEFAULT_GUARD_LIMITS,
  InMemoryBudgetLedger,
  InMemoryEngagementJournal,
  attenuate,
  classifyMail,
  createGuardKernel,
  createHarness,
  createInboxPolicy,
  createMailbox,
  groupInbox,
  isAttenuationOf,
  mergedAuthority,
  renderInboxText,
  rootAuthority,
  senderOf,
  type ActorTurnControl,
  type ActorTurnResult,
  type ActorTurnRunner,
  type AgentCeiling,
  type BudgetAmounts,
  type EngagementId,
  type EngagementJournal,
  type EscalationNotice,
  type Harness,
  type InboxEntry,
  type InboxGroupingOptions,
  type InboxSetTimer,
  type Mail,
  type MailId,
  type MailboxKey,
  type MailboxOptions,
  type Principal,
  agentOf,
} from '@zhin.js/harness';
import type { VenueProjector } from '@zhin.js/core';
import { getLogger } from '@zhin.js/logger';
import { TriggerCancelledError } from '../turn/trigger-cancelled-error.js';
import { TurnSupersededError } from '../turn/prompt-controller.js';
import { DEFAULT_MAILBOX_CONFIG, type ResolvedMailboxConfig } from '../turn/mailbox-config.js';
import type {
  TurnAdmission,
  TurnAdmissionFacts,
  TurnAdmissionRejectReason,
  TurnAdmissionRequest,
  TurnMergeWindowSnapshot,
  TurnParticipant,
  TurnStaleVerdict,
  TurnStopResult,
} from '../turn/turn-admission.js';
import { registerCollaboration } from './registry.js';
import type { CollaborationDirectory } from './contracts.js';

const logger = getLogger('ai.mailbox');

/** Default entry actor of a venue (the `zhin` binding). */
export const DEFAULT_ENTRY_ACTOR = 'zhin';

/** Default budget for one engagement; delegations are carved out of it (invariant 2). */
export const DEFAULT_ENGAGEMENT_BUDGET: BudgetAmounts = Object.freeze({
  modelCalls: 60,
  tokens: 400_000,
  wallMs: 10 * 60 * 1000,
  sideEffects: 30,
});

/** Host journal keeps closed engagements this long (memory bound of a long-lived host). */
const HOST_JOURNAL_RETENTION = Object.freeze({ maxAgeMs: 60 * 60 * 1000, maxEventsPerEngagement: 5000 });

export interface HostMailboxOptions {
  /** `ai.agent.mailbox`, normalized. Defaults to {@link DEFAULT_MAILBOX_CONFIG}. */
  readonly config?: ResolvedMailboxConfig;
  readonly now?: () => number;
  readonly setTimer?: InboxSetTimer;
  /** Turns running at once across every lane (the one global concurrency budget, ADR 0048 §3.1). */
  readonly maxConcurrentTurns?: number;
  readonly budget?: BudgetAmounts;
  /** Optional VenueProjector for multi-bot Venue hop projection (ADR 0048 H4). */
  readonly venueProjector?: VenueProjector;
  /** Optional EngagementJournal (defaults to an in-memory journal; can be swapped via {@link HostMailbox.setJournal}). */
  readonly journal?: EngagementJournal;
}

/** What a turn with peer agents registers for its engagement. */
export interface CollaborationBinding {
  readonly directory: CollaborationDirectory;
  /** Runs actor turns (peers, and the entry actor continuing with results). */
  readonly runTurn: ActorTurnRunner;
  readonly onEscalate?: (notice: EscalationNotice) => void | Promise<void>;
  readonly venueProjector?: VenueProjector;
}

interface Ticket {
  readonly mailId: MailId;
  readonly lane: string;
  readonly actor: string;
  readonly request: TurnAdmissionRequest;
  readonly resolve: (admission: TurnAdmission) => void;
  settled: boolean;
  /** Own mail left the queue (stop / eviction) while its group still waits. */
  detached: boolean;
}

interface QueuedMail {
  readonly mail: Mail;
  readonly seq: number;
  readonly postedAt: number;
}

const ENTRY_EGRESS = Object.freeze({ network: true, hosts: ALL });

function entryCeiling(agent: string): AgentCeiling {
  return Object.freeze({ agent, tools: ALL, contacts: ALL, maxTrust: 'master', egress: ENTRY_EGRESS, acceptsFrom: ALL });
}

/** Text a mail contributes to the turn: human, scene-event, or timer content. */
function mailText(mail: Mail): string {
  if (mail.body.kind === 'human') return mail.body.text;
  if (mail.body.kind === 'timer') return mail.body.content;
  if (mail.body.kind === 'event') {
    const text = (mail.body.data as { text?: unknown } | null)?.text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

function mailSender(mail: Mail): string {
  if (mail.body.kind === 'event') {
    const sender = (mail.body.data as { senderId?: unknown } | null)?.senderId;
    if (typeof sender === 'string') return sender;
  }
  return senderOf(mail);
}

/** Groups a batch by sender, senders in order of their first mail (ADR 0038 §3). */
function participantsOfBatch(
  batch: readonly Mail[],
  windowed: boolean,
  accessOf: ReadonlyMap<string, NonNullable<TurnAdmissionRequest['access']>>,
): readonly TurnParticipant[] {
  const order: string[] = [];
  const by = new Map<string, { senderName?: string; texts: string[]; messageIds: string[] }>();
  for (const mail of batch) {
    if (mail.body.kind !== 'human' && mail.body.kind !== 'event' && mail.body.kind !== 'timer') continue;
    const sender = mailSender(mail);
    let p = by.get(sender);
    if (!p) {
      p = { texts: [], messageIds: [] };
      by.set(sender, p);
      order.push(sender);
    }
    if (mail.body.kind === 'human') {
      if (!p.senderName && mail.body.senderName) p.senderName = mail.body.senderName;
      if (mail.body.messageId) p.messageIds.push(mail.body.messageId);
    }
    p.texts.push(mailText(mail));
  }
  return Object.freeze(order.map((senderId) => {
    const p = by.get(senderId)!;
    const access = accessOf.get(senderId);
    return Object.freeze({
      senderId,
      ...(p.senderName ? { senderName: p.senderName } : {}),
      texts: Object.freeze(p.texts),
      ...(windowed && p.messageIds.length ? { messageIds: Object.freeze(p.messageIds) } : {}),
      ...(access ? { access } : {}),
    });
  }));
}

export class HostMailbox {
  readonly harness: Harness;
  readonly config: ResolvedMailboxConfig;
  readonly #now: () => number;
  readonly #grouping: InboxGroupingOptions;
  readonly #budget: BudgetAmounts;
  #journal: EngagementJournal;
  readonly #tickets = new Map<MailId, Ticket>();
  /** Mails posted on each lane that have neither started nor finished. */
  readonly #queued = new Map<string, QueuedMail[]>();
  /** Sender of the batch running on each lane. */
  readonly #running = new Map<string, string>();
  readonly #bindings = new Map<EngagementId, CollaborationBinding>();
  readonly #venueHopsSeen = new Map<EngagementId, number>();
  readonly #idleWaiters: Array<() => void> = [];
  readonly #release: () => void;
  #venueProjector?: VenueProjector;
  #seq = 0;
  #closedSince = 0;
  #closed = false;

  constructor(options: HostMailboxOptions = {}) {
    const config = options.config ?? DEFAULT_MAILBOX_CONFIG;
    this.config = config;
    this.#now = options.now ?? Date.now;
    this.#budget = options.budget ?? DEFAULT_ENGAGEMENT_BUDGET;
    this.#journal = options.journal ?? new InMemoryEngagementJournal({ retention: HOST_JOURNAL_RETENTION });
    this.#venueProjector = options.venueProjector;
    const merge = config.merge.enabled
      ? { quietMs: config.merge.quietMs, maxWaitMs: config.merge.maxWaitMs, maxSenders: config.merge.maxSenders }
      : undefined;
    this.#grouping = { ...(merge ? { merge: { maxSenders: merge.maxSenders } } : {}), live: true };
    const policy = createInboxPolicy({
      maxQueuedTurns: config.maxQueuedTurns,
      supersedeSameSender: config.groupMode === 'supersede',
      ...(merge ? { merge } : {}),
      // ADR 0038 §5: only conversations of a `liveDanmaku` adapter post live mail.
      live: { windowMs: config.live.windowMs, minIntervalMs: config.live.minIntervalMs },
    });
    const journalProxy: EngagementJournal = {
      append: async (record) => {
        const appended = await this.#journal.append(record);
        if (record.type === 'mail_admitted') {
          await this.#maybeProjectAdmittedMail(record.engagementId, record.data.mailId as string | undefined);
        }
        return appended;
      },
      read: (engagementId) => this.#journal.read(engagementId),
      listEngagements: (limit) => this.#journal.listEngagements(limit),
      summarize: (engagementId) => this.#journal.summarize(engagementId),
      compact: (engagementId) => this.#journal.compact(engagementId),
      prune: (now) => this.#journal.prune(now),
    };
    this.harness = createHarness({
      guard: createGuardKernel({ isAttenuationOf }),
      ledger: new InMemoryBudgetLedger(),
      journal: journalProxy,
      createMailbox: (mailboxOptions: MailboxOptions) => createMailbox({
        ...mailboxOptions,
        onTurnFinished: async (key, batch, result) => {
          this.#onFinished(key, batch, result);
          await mailboxOptions.onTurnFinished?.(key, batch, result);
        },
      }, { onError: (error, context) => logger.warn(`mailbox ${context}: ${error instanceof Error ? error.message : String(error)}`) }),
      ceilingOf: (agent, engagementId) => {
        const directory = this.#bindings.get(engagementId)?.directory;
        if (!directory) return entryCeiling(agent);
        return (agent === directory.entry.name ? directory.entry : directory.get(agent))?.ceiling;
      },
      rootAuthority,
      attenuate,
      limits: DEFAULT_GUARD_LIMITS,
      maxConcurrentTurns: options.maxConcurrentTurns ?? 64,
      // Hard memory ceiling per lane; the policy bounds turns (`maxQueuedTurns`, danmaku cap).
      maxQueuedPerKey: 512,
      inbox: {
        policy,
        queueTtlMs: config.ttlMs,
        now: this.#now,
        ...(options.setTimer ? { setTimer: options.setTimer } : {}),
      },
      clock: this.#now,
      runTurn: (actor, batch, signal, control) => this.#run(actor, batch, signal, control),
      onEscalate: async (notice) => {
        await this.#bindings.get(notice.engagement.id)?.onEscalate?.(notice);
      },
      onEngagementClosed: (engagement) => {
        this.#venueHopsSeen.delete(engagement.id);
        void this.#journal.compact(engagement.id).catch(() => undefined);
        if (this.#bindings.delete(engagement.id) && this.#bindings.size === 0) {
          for (const waiter of this.#idleWaiters.splice(0)) waiter();
        }
        if (++this.#closedSince >= 256) {
          this.#closedSince = 0;
          void this.#journal.prune(this.#now()).catch(() => undefined);
        }
      },
      onError: (error) => logger.warn(`harness: ${error instanceof Error ? error.message : String(error)}`),
    });
    this.#release = registerCollaboration({ idle: () => this.idle(), close: (reason) => this.close(reason) });
  }

  /** Underlying engagement journal for inspection and telemetry. */
  get journal(): EngagementJournal {
    return this.#journal;
  }

  /** Replaces the underlying engagement journal (e.g. when SQL persistence activates). */
  setJournal(journal: EngagementJournal): void {
    this.#journal = journal;
  }

  /** Sets or updates the default VenueProjector for engagements on this mailbox. */
  setVenueProjector(projector: VenueProjector | undefined): void {
    this.#venueProjector = projector;
  }

  /** Appends a `tool_called` event to the engagement journal. */
  async recordToolCalled(info: {
    readonly engagementId: EngagementId;
    readonly actor: string;
    readonly mailId: MailId;
    readonly tool: string;
    readonly ok: boolean;
  }): Promise<void> {
    await this.#journal.append({
      engagementId: info.engagementId,
      at: this.#now(),
      type: 'tool_called',
      data: {
        actor: info.actor,
        mailId: info.mailId,
        tool: info.tool,
        ok: info.ok,
      },
    });
  }

  /** Projects a direct `tell` to a Venue room if a projector is configured. */
  async projectVenueTell(engagementId: EngagementId, fromActor: string, mailId: MailId, venueId: string, content: string): Promise<void> {
    const projector = this.#bindings.get(engagementId)?.venueProjector ?? this.#venueProjector;
    if (!projector) return;
    const engagement = this.harness.engagement(engagementId);
    const resolvedVenueId = venueId === 'current' && engagement?.venue ? engagement.venue.id : venueId;
    const projected = await projector.projectHop({
      venueId: resolvedVenueId,
      mailId,
      kind: 'tell',
      fromAgent: agentOf(fromActor),
      content,
      isStart: true,
    });
    if (projected) {
      await this.#journal.append({
        engagementId,
        at: this.#now(),
        type: 'venue_projected',
        data: {
          venueId: resolvedVenueId,
          actor: agentOf(fromActor),
          mailId,
          kind: 'tell',
        },
      });
    }
  }

  async #maybeProjectAdmittedMail(engagementId: EngagementId, mailId: string | undefined): Promise<void> {
    if (!mailId) return;
    const projector = this.#bindings.get(engagementId)?.venueProjector ?? this.#venueProjector;
    if (!projector) return;
    const graph = this.harness.graph(engagementId);
    const venue = graph?.engagement.venue;
    if (!graph || !venue) return;
    const mail = graph.get(mailId);
    if (!mail || mail.from.kind !== 'actor') return;
    if (mail.kind !== 'ask' && mail.kind !== 'delegate' && mail.kind !== 'tell' && mail.kind !== 'result') return;
    const content = mail.body.kind === 'ask'
      ? mail.body.question
      : mail.body.kind === 'delegate'
        ? mail.body.brief
        : mail.body.kind === 'tell' || mail.body.kind === 'result'
          ? mail.body.content
          : '';
    if (!content) return;
    const prevHops = this.#venueHopsSeen.get(engagementId) ?? 0;
    const nextHops = prevHops + 1;
    this.#venueHopsSeen.set(engagementId, nextHops);
    const isStart = prevHops === 0 && (mail.kind === 'ask' || mail.kind === 'delegate' || mail.kind === 'tell');
    const fromAgent = agentOf(mail.from.actor);
    const toAgent = agentOf(mail.to);
    try {
      const projected = await projector.projectHop({
        venueId: venue.id,
        mailId: mail.id,
        kind: mail.kind,
        fromAgent,
        toAgent,
        content,
        isStart,
        isConclusion: false,
      });
      if (projected) {
        await this.#journal.append({
          engagementId,
          at: this.#now(),
          type: 'venue_projected',
          data: {
            venueId: venue.id,
            actor: fromAgent,
            to: toAgent,
            mailId: mail.id,
            kind: mail.kind,
          },
        });
      }
    } catch (error) {
      logger.warn(`venue projection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Sender of the batch currently running on `sessionKey`, if any. */
  runningSender(sessionKey: string): string | undefined {
    for (const [key, sender] of this.#running) if (key.endsWith(`\u0000${sessionKey}`)) return sender;
    return undefined;
  }

  /** Mails waiting on `sessionKey` (all actors). */
  queuedMails(sessionKey: string): number {
    let count = 0;
    for (const [key, list] of this.#queued) if (key.endsWith(`\u0000${sessionKey}`)) count += list.length;
    return count;
  }

  /** Turns waiting on `sessionKey`: a merge or danmaku window counts once (ADR 0038). */
  queuedTurns(sessionKey: string): number {
    let count = 0;
    for (const [key, list] of this.#queued) {
      if (key.endsWith(`\u0000${sessionKey}`)) count += groupInbox(list, this.#grouping).length;
    }
    return count;
  }

  /**
   * Posts the message as a `human` (or `event`) Mail on the session lane and
   * resolves once the Mailbox decided: `run` when this call carries the
   * batch that starts, `merged` when another call answers it, `rejected`
   * otherwise.
   */
  async admit(request: TurnAdmissionRequest): Promise<TurnAdmission> {
    if (this.#closed) return Object.freeze({ kind: 'rejected', reason: 'stopped' });
    const actor = request.entry ?? DEFAULT_ENTRY_ACTOR;
    const lane = request.sessionKey;
    let resolveAdmission!: (admission: TurnAdmission) => void;
    const admission = new Promise<TurnAdmission>((resolve) => { resolveAdmission = resolve; });
    const laneKey = this.#laneKey(actor, lane);
    let ticket: Ticket | undefined;
    const outcome = await this.harness.open({
      principal: this.#principal(request),
      entry: actor,
      lane,
      body: this.#body(request),
      budget: request.budget ?? this.#budget,
      ...(request.venue ? { venue: request.venue } : {}),
      // The inbox may start the turn before `open` resolves: register the caller first.
      onPosting: (root) => {
        ticket = { mailId: root.id, lane, actor, request, resolve: resolveAdmission, settled: false, detached: false };
        this.#tickets.set(root.id, ticket);
        const queued = this.#queued.get(laneKey) ?? [];
        queued.push({ mail: root, seq: this.#seq++, postedAt: this.#now() });
        this.#queued.set(laneKey, queued);
      },
    });
    if (!outcome.ok) {
      if (ticket) {
        this.#tickets.delete(ticket.mailId);
        this.#unqueue(laneKey, new Set([ticket.mailId]));
      }
      const reason: TurnAdmissionRejectReason = outcome.code === 'not_addressed' ? 'not_addressed'
        : outcome.code === 'queue_full' ? 'queue_full' : 'stopped';
      if (outcome.code !== 'queue_full' && outcome.code !== 'not_addressed' && outcome.code !== 'closed') {
        logger.debug(`mail not admitted: ${outcome.code} ${outcome.reason}`);
      }
      return Object.freeze({ kind: 'rejected', reason });
    }
    const mail = outcome.root;
    if (outcome.disposition === 'merged' && ticket) this.#settle(ticket, Object.freeze({ kind: 'merged' }));
    if (request.onWindowJoined && classifyMail(mail, this.#grouping) === 'merge') {
      request.onWindowJoined(this.#windowOf(laneKey, mail));
    }
    return admission;
  }

  /**
   * Explicit stop (a stop word). The running turn's initiator or the master
   * stops the running turn (and drops both senders' queued mails); anyone
   * may drop their own queued mails.
   */
  async stop(sessionKey: string, senderId: string, isMaster: boolean, entry: string = DEFAULT_ENTRY_ACTOR): Promise<TurnStopResult> {
    if (this.#closed) return 'not_running';
    const outcome = await this.harness.open({
      principal: Object.freeze({ kind: 'human', id: senderId, trust: isMaster ? 'master' : 'group_member' }),
      entry,
      lane: sessionKey,
      body: Object.freeze({
        kind: 'human', text: 'stop', venue: { kind: 'turn', id: sessionKey }, senderId, isStop: true, ...(isMaster ? { isMaster: true } : {}),
      }),
      budget: this.#budget,
    });
    if (outcome.ok) return 'stopped';
    // Another member's turn is running: never touch it or anything queued.
    if (outcome.code === 'forbidden') return 'forbidden';
    // Nothing running: the sender's own waiting messages are still theirs to stop.
    const dropped = this.harness.cancelSender(entry, sessionKey, senderId, 'stopped');
    return dropped > 0 ? 'stopped' : 'not_running';
  }

  /**
   * Registers the collaboration of the turn that carries `engagementId`
   * (peers present). Kept until the engagement closes, so delegated results
   * still find their runner after the root turn ended.
   */
  bindCollaboration(engagementId: EngagementId, binding: CollaborationBinding): void {
    this.#bindings.set(engagementId, binding);
  }

  /**
   * Resolves once no collaboration engagement (a turn with peers and the
   * delegated work it started) is open. Ordinary human turns of the lanes do
   * not count, so a turn may await it (H2 `collaborationIdle`).
   */
  idle(): Promise<void> {
    if (this.#bindings.size === 0 || this.#closed) return Promise.resolve();
    return new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  /** Rejects queued mail, aborts running turns (generation shutdown). */
  async close(reason = 'disposed'): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.harness.close(reason);
    } finally {
      for (const ticket of this.#tickets.values()) this.#settle(ticket, Object.freeze({ kind: 'rejected', reason: 'stopped' }));
      this.#tickets.clear();
      this.#queued.clear();
      this.#bindings.clear();
      for (const waiter of this.#idleWaiters.splice(0)) waiter();
      this.#release();
    }
  }

  /** Synchronous variant for disposal paths that cannot await. */
  dispose(): void {
    void this.close().catch((error) => logger.warn(`mailbox close failed: ${String(error)}`));
  }

  #laneKey(actor: string, lane: string): string {
    return `${actor}\u0000${lane}`;
  }

  #principal(request: TurnAdmissionRequest): Principal {
    return Object.freeze({
      kind: 'human',
      id: request.senderId,
      trust: request.trust ?? (request.isMaster ? 'master' : 'group_member'),
      ...(request.venue ? { venue: request.venue } : {}),
    });
  }

  #body(request: TurnAdmissionRequest) {
    const venue = request.venue ?? { kind: 'turn', id: request.sessionKey };
    if (request.kind === 'event') {
      return Object.freeze({
        kind: 'event' as const,
        event: request.event ?? 'scene',
        data: Object.freeze({ text: request.text, senderId: request.senderId, venue }),
      });
    }
    if (request.kind === 'timer') {
      const timerId = request.timerId?.trim();
      if (!timerId) throw new Error('timer admission needs timerId');
      return Object.freeze({
        kind: 'timer' as const,
        timerId,
        content: request.text,
      });
    }
    return Object.freeze({
      kind: 'human' as const,
      text: request.text,
      venue,
      senderId: request.senderId,
      ...(request.messageId ? { messageId: request.messageId } : {}),
      ...(request.senderName ? { senderName: request.senderName } : {}),
      plainText: request.plainText,
      ...(request.mergeable ? { mergeable: true } : {}),
      ...(request.live ? { live: true } : {}),
      ...(request.isMaster ? { isMaster: true } : {}),
      ...(request.unaddressed ? { unaddressed: true } : {}),
    });
  }

  #settle(ticket: Ticket, admission: TurnAdmission): void {
    if (ticket.settled) return;
    ticket.settled = true;
    ticket.resolve(admission);
  }

  #windowOf(laneKey: string, mail: Mail): TurnMergeWindowSnapshot {
    const entries: InboxEntry[] = (this.#queued.get(laneKey) ?? []).map((q) => ({ mail: q.mail, seq: q.seq, postedAt: q.postedAt }));
    const group = groupInbox(entries, this.#grouping).find((g) => g.entries.some((e) => e.mail === mail));
    return Object.freeze({
      senders: Object.freeze([...(group?.senders ?? [senderOf(mail)])]),
      messages: group?.entries.length ?? 1,
    });
  }

  #unqueue(laneKey: string, ids: ReadonlySet<MailId>): void {
    const list = this.#queued.get(laneKey);
    if (!list) return;
    const rest = list.filter((q) => !ids.has(q.mail.id));
    if (rest.length) this.#queued.set(laneKey, rest);
    else this.#queued.delete(laneKey);
  }

  /** The inbox reported a finished batch (also a dropped mail). */
  #onFinished(key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult): void {
    const laneKey = this.#laneKey(key.actor, key.lane);
    this.#unqueue(laneKey, new Set(batch.map((mail) => mail.id)));
    for (const mail of batch) {
      const ticket = this.#tickets.get(mail.id);
      if (!ticket) continue;
      if (!ticket.settled && result.reason !== undefined) {
        const reason = result.reason;
        // A group opener whose own mail left keeps carrying the rest of its
        // group: queued mails that were merged into it have no caller of their own.
        if ((reason === 'stopped' || reason === 'evicted') && this.#hasOrphans(laneKey)) {
          ticket.detached = true;
          continue;
        }
        this.#settle(ticket, Object.freeze({ kind: 'rejected', reason: reason === 'expired' ? 'expired' : 'stopped' }));
      }
      if (ticket.settled) this.#tickets.delete(mail.id);
    }
    if ((this.#queued.get(laneKey)?.length ?? 0) === 0) {
      for (const [id, ticket] of this.#tickets) {
        if (ticket.detached && !ticket.settled && this.#laneKey(ticket.actor, ticket.lane) === laneKey) {
          this.#settle(ticket, Object.freeze({ kind: 'rejected', reason: 'stopped' }));
          this.#tickets.delete(id);
        }
      }
    }
  }

  /** Queued mails of the lane whose caller was merged away (they need a carrier). */
  #hasOrphans(laneKey: string): boolean {
    return (this.#queued.get(laneKey) ?? []).some((q) => {
      const ticket = this.#tickets.get(q.mail.id);
      return !ticket || ticket.settled;
    });
  }

  async #run(actor: string, batch: readonly Mail[], signal: AbortSignal, control?: ActorTurnControl): Promise<ActorTurnResult> {
    const lane = batch[0]?.lane;
    const laneKey = lane !== undefined ? this.#laneKey(actor, lane) : undefined;
    const carrier = this.#carrierOf(batch, laneKey);
    if (!carrier) {
      const binding = this.#bindings.get(batch[0]!.engagementId);
      if (!binding) {
        if (batch.some((mail) => this.#tickets.has(mail.id))) return { status: 'cancelled' };
        return { status: 'failed', content: `no runner for ${actor}` };
      }
      return binding.runTurn(actor, batch, signal, control);
    }
    if (laneKey) this.#unqueue(laneKey, new Set(batch.map((mail) => mail.id)));
    for (const mail of batch) {
      const other = this.#tickets.get(mail.id);
      if (other && other !== carrier) this.#settle(other, Object.freeze({ kind: 'merged' }));
    }
    if (laneKey) this.#running.set(laneKey, senderOf(batch[0]!));
    try {
      return await new Promise<ActorTurnResult>((resolveTurn) => {
        this.#settle(carrier, this.#runAdmission(carrier, batch, signal, control, resolveTurn));
      });
    } finally {
      if (laneKey && this.#running.get(laneKey) === senderOf(batch[0]!)) this.#running.delete(laneKey);
      for (const mail of batch) {
        if (this.#tickets.get(mail.id)?.settled) this.#tickets.delete(mail.id);
      }
      this.#tickets.delete(carrier.mailId);
    }
  }

  #carrierOf(batch: readonly Mail[], laneKey: string | undefined): Ticket | undefined {
    for (const mail of batch) {
      const ticket = this.#tickets.get(mail.id);
      if (ticket && !ticket.settled) return ticket;
    }
    if (laneKey === undefined) return undefined;
    for (const ticket of this.#tickets.values()) {
      if (ticket.detached && !ticket.settled && this.#laneKey(ticket.actor, ticket.lane) === laneKey) return ticket;
    }
    return undefined;
  }

  #runAdmission(
    carrier: Ticket,
    batch: readonly Mail[],
    mailboxSignal: AbortSignal,
    control: ActorTurnControl | undefined,
    resolveTurn: (result: ActorTurnResult) => void,
  ): TurnAdmission {
    const sessionKey = carrier.lane;
    const controller = new AbortController();
    const forward = () => {
      const reason = mailboxSignal.reason;
      controller.abort(reason === 'superseded' ? new TurnSupersededError(sessionKey) : new TriggerCancelledError(sessionKey));
    };
    if (mailboxSignal.aborted) forward();
    else mailboxSignal.addEventListener('abort', forward, { once: true });

    const kind = classifyMail(batch[0]!, this.#grouping);
    const windowed = kind !== 'single';
    const accessOf = new Map<string, NonNullable<TurnAdmissionRequest['access']>>();
    for (const mail of batch) {
      const access = this.#tickets.get(mail.id)?.request.access;
      const sender = mailSender(mail);
      if (access && !accessOf.has(sender)) accessOf.set(sender, access);
    }
    if (carrier.request.access && !accessOf.has(carrier.request.senderId)) accessOf.set(carrier.request.senderId, carrier.request.access);
    const participants = participantsOfBatch(batch, windowed, accessOf);
    const texts = participants.flatMap((p) => p.texts);
    const inboxFacts = control?.facts;
    const queuedMs = inboxFacts?.queuedMs ?? 0;
    const facts: TurnAdmissionFacts = Object.freeze({
      queuedMs,
      mergedMessages: texts.length,
      supersededPrevious: inboxFacts?.supersededPrevious ?? false,
      ...(kind === 'live' ? {
        liveWindow: Object.freeze({
          candidates: texts.length + (inboxFacts?.evicted ?? 0),
          kept: texts.length,
          senders: participants.length,
          waitedMs: queuedMs,
        }),
      } : kind === 'merge' ? {
        mergeWindow: Object.freeze({
          senders: Object.freeze(participants.map((p) => p.senderId)),
          messages: texts.length,
          waitedMs: queuedMs,
        }),
      } : {}),
    });
    // Q2: the first mail carries the turn; a merged batch acts with the intersection of its senders' authority.
    const first = batch[0]!;
    const authority = batch.length > 1 ? mergedAuthority(batch) ?? first.authority : first.authority;
    const mail: Mail = authority === first.authority ? first : Object.freeze({ ...first, authority });
    let released = false;
    return Object.freeze({
      kind: 'run' as const,
      text: renderInboxText(participants.map((p) => ({ ...p, mails: [] }))),
      facts,
      participants,
      signal: controller.signal,
      markDelivered: () => { control?.markDelivered(); },
      markActed: () => { control?.markActed(); },
      staleCheck: (): TurnStaleVerdict => control?.staleCheck() ?? Object.freeze({ kind: 'fresh' as const }),
      release: (status = 'completed') => {
        if (released) return;
        released = true;
        mailboxSignal.removeEventListener('abort', forward);
        resolveTurn({ status: controller.signal.aborted ? 'cancelled' : status });
      },
      batch,
      mail,
      harness: this.harness,
    });
  }
}
