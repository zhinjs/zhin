/**
 * ADR 0061 §4.1: the inbound outcome ledger. `InboundRuntime.#receiveMessage` opens one ledger per
 * message, every stage reports candidates through {@link reportInboundOutcome}, and the `finally`
 * block settles exactly one {@link MessageOutcomeRecord}. Settled records go to the process-local
 * {@link MessageOutcomeLog} (ring buffer, ADR 0061 §2 "无数据库"); persistence in
 * `im_message_outcomes` is a later phase (P3).
 */
import { randomUUID } from 'node:crypto';
import type { ConversationRef } from '@zhin.js/im-contract';
import { redactSecretText } from '@zhin.js/kernel';
import {
  defaultOutcomeReply,
  defaultOutcomeVisibility,
  messageOutcomePriority,
  QUIET_MESSAGE_OUTCOMES,
  type MessageOutcome,
  type MessageOutcomeCandidate,
  type MessageOutcomeRecord,
  type MessageOutcomeStage,
} from './message-outcome.js';

/** Symbol of the `RuntimeMessage` method returning its ledger port. @internal */
export const inboundOutcomeSink = Symbol('zhin.im.inbound-outcome-sink');

/** What a message view exposes of its ledger. @public */
export interface InboundOutcomeSink {
  report(candidate: MessageOutcomeCandidate): boolean;
  enter(stage: MessageOutcomeStage): void;
}

const MAX_DETAIL_CHARS = 200;
const MAX_FACETS = 16;
const MAX_CODE_CHARS = 120;

function boundedCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[^\w:./-]/gu, '_').slice(0, MAX_CODE_CHARS);
  return text || undefined;
}

/** Administrator detail: secrets masked (same patterns as the decision audit), one line, ≤ 200 chars. */
export function boundedOutcomeDetail(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = redactSecretText(value).replace(/\p{Cc}+/gu, ' ').trim();
  const chars = [...text];
  return chars.length > MAX_DETAIL_CHARS ? `${chars.slice(0, MAX_DETAIL_CHARS - 1).join('')}…` : text;
}

export interface InboundOutcomeLedgerInit {
  readonly conversation: ConversationRef;
  readonly senderId?: string;
  readonly messageId?: string;
  readonly receivedAt: number;
  readonly generation?: number;
  readonly addressed?: boolean;
  readonly now?: () => number;
}

/** Listener for `unrecorded` outcomes (tests fail on stages outside the allowlist, ADR 0061 §4.3). */
export type UnrecordedOutcomeListener = (record: MessageOutcomeRecord) => void;
const unrecordedListeners = new Set<UnrecordedOutcomeListener>();

/** Observes every `unrecorded` outcome in this process; returns the unsubscribe function. @public */
export function onUnrecordedInboundOutcome(listener: UnrecordedOutcomeListener): () => void {
  unrecordedListeners.add(listener);
  return () => unrecordedListeners.delete(listener);
}

/** One inbound message's outcome accumulator; settles once. @public */
export class InboundOutcomeLedger implements InboundOutcomeSink {
  readonly id = randomUUID();
  readonly #init: InboundOutcomeLedgerInit;
  #addressed: boolean;
  #diagnosticId: string | undefined;
  #best: MessageOutcomeCandidate | undefined;
  readonly #facets: string[] = [];
  #lastStage: MessageOutcomeStage = 'ingress';
  #settled: MessageOutcomeRecord | undefined;

  constructor(init: InboundOutcomeLedgerInit) {
    this.#init = init;
    this.#addressed = init.addressed === true;
  }

  get settled(): MessageOutcomeRecord | undefined { return this.#settled; }
  get addressed(): boolean { return this.#addressed; }
  get lastStage(): MessageOutcomeStage { return this.#lastStage; }
  /** Current winning candidate (before settle). */
  get current(): MessageOutcomeCandidate | undefined { return this.#best; }

  markAddressed(addressed: boolean): void { if (addressed) this.#addressed = true; }
  linkDiagnostic(id: string | undefined): void { if (id) this.#diagnosticId = id; }

  enter(stage: MessageOutcomeStage): void {
    if (!this.#settled) this.#lastStage = stage;
  }

  /** Adds one candidate; the highest priority wins, ties keep the earlier one. False after settle. */
  report(candidate: MessageOutcomeCandidate): boolean {
    if (this.#settled) return false;
    this.#lastStage = candidate.stage;
    for (const facet of candidate.facets ?? []) this.#addFacet(facet);
    const best = this.#best;
    if (!best) { this.#best = candidate; return true; }
    if (messageOutcomePriority(candidate.outcome) > messageOutcomePriority(best.outcome)) {
      this.#addFacet(facetOf(best));
      this.#best = { ...candidate, ...(candidate.turnId === undefined && best.turnId ? { turnId: best.turnId } : {}) };
    } else {
      this.#addFacet(facetOf(candidate));
      if (best.turnId === undefined && candidate.turnId) this.#best = { ...best, turnId: candidate.turnId };
    }
    return true;
  }

  #addFacet(value: string): void {
    const facet = boundedCode(value);
    if (facet && !this.#facets.includes(facet) && this.#facets.length < MAX_FACETS) this.#facets.push(facet);
  }

  /**
   * Settles the message once. With `error`, the outcome is `internal_error` (the caller logs and
   * rethrows); without any candidate it is `unrecorded`.
   */
  settle(input: Readonly<{ error?: Readonly<{ errorId: string; name?: string; message?: string; owner?: string }> }> = {}): MessageOutcomeRecord {
    if (this.#settled) return this.#settled;
    const init = this.#init;
    let candidate: MessageOutcomeCandidate = this.#best ?? { outcome: 'unrecorded', reason: 'missing_outcome', stage: this.#lastStage };
    if (input.error) {
      if (this.#best) this.#addFacet(facetOf(this.#best));
      candidate = {
        outcome: 'internal_error',
        reason: `${stageThrow(this.#lastStage)}`,
        stage: this.#lastStage,
        errorId: input.error.errorId,
        ...(input.error.owner ? { owner: input.error.owner } : {}),
        detail: [input.error.name, input.error.message].filter(Boolean).join(': '),
      };
    }
    const outcome: MessageOutcome = candidate.outcome;
    const conversation = init.conversation;
    const detail = boundedOutcomeDetail(candidate.detail);
    const record: MessageOutcomeRecord = Object.freeze({
      id: this.id,
      receivedAt: init.receivedAt,
      settledAt: (init.now ?? Date.now)(),
      ...(init.generation !== undefined ? { generation: init.generation } : {}),
      conversation,
      platform: conversation.endpoint.adapter,
      sceneId: `${conversation.kind}:${conversation.id}`,
      ...(init.senderId ? { senderId: init.senderId } : {}),
      ...(init.messageId ? { messageId: init.messageId } : {}),
      addressed: this.#addressed,
      outcome,
      ...(boundedCode(candidate.reason) ? { reason: boundedCode(candidate.reason) } : {}),
      facets: Object.freeze([...this.#facets]),
      stage: candidate.stage,
      visibility: candidate.visibility ?? defaultOutcomeVisibility(outcome, this.#addressed),
      reply: candidate.reply ?? defaultOutcomeReply(outcome),
      ...(candidate.command ? { command: String(candidate.command).slice(0, 200) } : {}),
      ...(candidate.owner ? { owner: String(candidate.owner).slice(0, 200) } : {}),
      ...(candidate.turnId ? { turnId: String(candidate.turnId).slice(0, 200) } : {}),
      ...(this.#diagnosticId ? { diagnosticId: this.#diagnosticId } : {}),
      ...(candidate.errorId ? { errorId: candidate.errorId } : {}),
      ...(candidate.mergedInto ? { mergedInto: String(candidate.mergedInto).slice(0, 200) } : {}),
      ...(detail ? { detail } : {}),
      ...(outcome === 'unrecorded' ? { lastStage: this.#lastStage } : {}),
    });
    this.#settled = record;
    if (outcome === 'unrecorded') {
      for (const listener of unrecordedListeners) {
        try { listener(record); } catch (error) { if (process.env.NODE_ENV === 'test') throw error; }
      }
    }
    return record;
  }
}

function facetOf(candidate: MessageOutcomeCandidate): string {
  return candidate.reason ? `${candidate.outcome}:${candidate.reason}` : candidate.outcome;
}

function stageThrow(stage: MessageOutcomeStage): string {
  switch (stage) {
    case 'command': return 'command_threw';
    case 'handlers': return 'handler_threw';
    case 'middleware': return 'middleware_threw';
    case 'agent_gate': case 'ambient': case 'admission': case 'model': case 'tool': return 'agent_threw';
    default: return 'inbound_threw';
  }
}

/**
 * Reports one outcome candidate for an inbound message (ADR 0061 §4.1). Agent and plugins call it
 * with the message they received; a message without a ledger (outbound, synthetic) is ignored.
 * @public
 */
export function reportInboundOutcome(message: unknown, candidate: MessageOutcomeCandidate): boolean {
  return inboundOutcomeSinkOf(message)?.report(candidate) ?? false;
}

/** Marks the stage a message is entering, for `unrecorded` diagnosis. @public */
export function enterInboundOutcomeStage(message: unknown, stage: MessageOutcomeStage): void {
  inboundOutcomeSinkOf(message)?.enter(stage);
}

function inboundOutcomeSinkOf(message: unknown): InboundOutcomeSink | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const method = (message as { [inboundOutcomeSink]?: () => InboundOutcomeSink | undefined })[inboundOutcomeSink];
  return typeof method === 'function' ? method.call(message) : undefined;
}

/** Filters of {@link MessageOutcomeReader.list}. @public */
export interface MessageOutcomeQuery {
  readonly conversation?: Pick<ConversationRef, 'endpoint' | 'kind' | 'id'>;
  readonly senderId?: string;
  readonly messageId?: string;
  readonly outcome?: MessageOutcome;
  readonly since?: number;
  readonly limit?: number;
}

/** Read side of settled outcomes. @public */
export interface MessageOutcomeReader {
  /** False: process memory only (no `im_message_outcomes` persistence yet). */
  readonly persistent: boolean;
  list(query?: MessageOutcomeQuery): readonly MessageOutcomeRecord[];
  get(id: string): MessageOutcomeRecord | undefined;
}

export interface MessageOutcomeLogOptions {
  readonly capacity?: number;
  readonly ttlMs?: number;
  /** Quiet rows per conversation per minute before aggregation (`im.outcomes.quietSampleLimit`, default 30). */
  readonly quietSampleLimit?: number;
  readonly now?: () => number;
}

interface QuietWindow { minute: number; count: number; aggregate?: { id: string; reason?: string; outcome: MessageOutcome; n: number } }

/**
 * Process-local outcome log: 2000 rows / 24 hours by default. Quiet outcomes (`not_addressed`,
 * `ignored_bot`, `ignored_self`, `dropped_duplicate`) of one conversation beyond the per-minute
 * limit collapse into one aggregated row per minute (`facets: ['aggregated:<n>']`, no message id);
 * addressed messages and other outcomes are never sampled (ADR 0061 §2).
 * @public
 */
export class MessageOutcomeLog implements MessageOutcomeReader {
  readonly persistent = false;
  readonly #records = new Map<string, MessageOutcomeRecord>();
  readonly #quiet = new Map<string, QuietWindow>();
  constructor(private readonly options: MessageOutcomeLogOptions = {}) {}

  #now(): number { return (this.options.now ?? Date.now)(); }

  record(record: MessageOutcomeRecord): MessageOutcomeRecord {
    this.#prune();
    let stored = record;
    if (!record.addressed && QUIET_MESSAGE_OUTCOMES.has(record.outcome)) {
      const key = `${conversationKey(record.conversation)}\0${record.outcome}\0${record.reason ?? ''}`;
      const minute = Math.floor(record.settledAt / 60_000);
      let window = this.#quiet.get(key);
      if (!window || window.minute !== minute) {
        window = { minute, count: 0 };
        this.#quiet.set(key, window);
        if (this.#quiet.size > 4096) this.#quiet.delete(this.#quiet.keys().next().value!);
      }
      window.count += 1;
      const limit = this.options.quietSampleLimit ?? 30;
      if (window.count > limit) {
        const n = window.count - limit;
        const id = window.aggregate?.id ?? randomUUID();
        const { messageId: _messageId, senderId: _senderId, ...rest } = record;
        stored = Object.freeze({ ...rest, id, facets: Object.freeze([...record.facets.filter(f => !f.startsWith('aggregated:')), `aggregated:${n}`]) });
        window.aggregate = { id, outcome: record.outcome, ...(record.reason ? { reason: record.reason } : {}), n };
        this.#records.delete(id);
      }
    }
    this.#records.set(stored.id, stored);
    const capacity = this.options.capacity ?? 2000;
    while (this.#records.size > capacity) this.#records.delete(this.#records.keys().next().value!);
    return stored;
  }

  list(query: MessageOutcomeQuery = {}): readonly MessageOutcomeRecord[] {
    this.#prune();
    const limit = Number.isSafeInteger(query.limit) ? Math.min(500, Math.max(1, query.limit!)) : 50;
    const key = query.conversation ? conversationKey(query.conversation) : undefined;
    const out: MessageOutcomeRecord[] = [];
    for (const record of [...this.#records.values()].reverse()) {
      if (key !== undefined && conversationKey(record.conversation) !== key) continue;
      if (query.senderId !== undefined && record.senderId !== query.senderId) continue;
      if (query.messageId !== undefined && record.messageId !== query.messageId) continue;
      if (query.outcome !== undefined && record.outcome !== query.outcome) continue;
      if (query.since !== undefined && record.settledAt < query.since) continue;
      out.push(record);
      if (out.length >= limit) break;
    }
    return Object.freeze(out);
  }

  get(id: string): MessageOutcomeRecord | undefined {
    this.#prune();
    return this.#records.get(id);
  }

  #prune(): void {
    const threshold = this.#now() - (this.options.ttlMs ?? 24 * 60 * 60_000);
    for (const [id, record] of this.#records) {
      if (record.settledAt >= threshold) break;
      this.#records.delete(id);
    }
  }
}

function conversationKey(conversation: Pick<ConversationRef, 'endpoint' | 'kind' | 'id'>): string {
  return JSON.stringify([conversation.endpoint.id, conversation.kind, conversation.id]);
}
