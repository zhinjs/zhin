import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ConversationRef, DeliveryReceipt } from '@zhin.js/im-contract';
import type { RuntimeMessageRendering } from './message-events.js';

export interface RuntimeMessageDiagnosticStep {
  readonly stage: 'received' | 'origin' | 'prefix' | 'middleware' | 'handlers' | 'dispatch' | 'delivery';
  readonly status: 'accepted' | 'human' | 'member' | 'peer_bot' | 'self' | 'unclassified'
    | 'matched' | 'mismatch' | 'empty_input' | 'commands_unavailable' | 'started'
    | 'entered' | 'stopped' | 'replaced' | 'completed' | 'unmatched' | 'invalid' | 'denied' | 'executed'
    | 'interaction' | 'middleware' | 'command' | 'agent' | 'self_echo' | 'duplicate' | 'bot_origin' | 'dedup_error'
    | 'sent' | 'failed' | 'unsupported' | 'rejected' | 'suppressed' | 'unknown';
  readonly at: number;
}

export interface RuntimeMessageDiagnosticDelivery {
  readonly conversation: ConversationRef;
  readonly status: DeliveryReceipt['status'];
  readonly failureCode?: string;
  readonly deliveryUnknown?: boolean;
  readonly rendering?: RuntimeMessageRendering;
}

/** Operational facts only: no message body, sender profile, config, or raw exception. */
export interface RuntimeMessageDiagnostic {
  readonly id: string;
  readonly generation: number;
  readonly conversation: ConversationRef;
  readonly messageId?: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly status: 'processing' | 'completed' | 'failed';
  readonly route?: 'interaction' | 'middleware' | 'command' | 'agent' | 'unmatched'
    | 'self_echo' | 'duplicate' | 'bot_origin' | 'dedup_error';
  readonly command?: string;
  readonly dispatchStatus?: 'unmatched' | 'invalid' | 'denied' | 'executed';
  /** Some evidence exceeded the per-operation bound; the record is not a complete timeline. */
  readonly truncated: boolean;
  readonly steps: readonly RuntimeMessageDiagnosticStep[];
  readonly deliveries: readonly RuntimeMessageDiagnosticDelivery[];
}

export interface RuntimeMessageDiagnosticsReader {
  list(options?: Readonly<{ limit?: number; conversation?: ConversationRef; messageId?: string }>): readonly RuntimeMessageDiagnostic[];
  get(id: string): RuntimeMessageDiagnostic | undefined;
}

type MutableDiagnostic = { -readonly [K in keyof RuntimeMessageDiagnostic]: RuntimeMessageDiagnostic[K] };
interface Operation { active: boolean; record?: MutableDiagnostic }
const MAX_STEPS = 32;
const MAX_DELIVERIES = 32;

/** One ImRuntime owns this bounded projection; it never retains a Snapshot or publication authority. */
export class RuntimeMessageDiagnostics implements RuntimeMessageDiagnosticsReader {
  readonly #records = new Map<string, MutableDiagnostic>();
  readonly #operation = new AsyncLocalStorage<Operation>();
  constructor(private readonly options: Readonly<{ now?: () => number; ttlMs?: number; capacity?: number }> = {}) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const scope: Operation = { active: true };
    return this.#operation.run(scope, async () => {
      let failed = false;
      try { return await operation(); } catch (error) { failed = true; throw error; } finally {
        scope.active = false;
        if (scope.record) {
          scope.record.status = failed ? 'failed' : 'completed';
          scope.record.endedAt = this.#now();
        }
      }
    });
  }

  begin(generation: number, conversation: ConversationRef, messageId?: string): void {
    const scope = this.#operation.getStore();
    if (!scope?.active) return;
    this.#prune();
    const record: MutableDiagnostic = {
      id: randomUUID(), generation, conversation: freezeConversation(conversation),
      ...(messageId ? { messageId } : {}), startedAt: this.#now(), status: 'processing', truncated: false, steps: [], deliveries: [],
    };
    scope.record = record;
    this.#records.set(record.id, record);
    const capacity = this.options.capacity ?? 500;
    while (this.#records.size > capacity) this.#records.delete(this.#records.keys().next().value!);
    this.step('received', 'accepted');
  }

  step(stage: RuntimeMessageDiagnosticStep['stage'], status: RuntimeMessageDiagnosticStep['status']): void {
    const record = this.#current();
    if (!record) return;
    if (record.steps.length < MAX_STEPS) record.steps = [...record.steps, { stage, status, at: this.#now() }];
    else record.truncated = true;
  }

  dispatch(result: Readonly<{ matched: boolean; command?: string; status?: RuntimeMessageDiagnostic['dispatchStatus'] }>): void {
    const record = this.#current();
    if (!record) return;
    record.route ??= result.matched ? 'command' : 'unmatched';
    if (result.command) record.command = result.command.slice(0, 200);
    if (result.status) record.dispatchStatus = result.status;
    this.step('dispatch', result.status ?? record.route);
  }

  route(route: NonNullable<RuntimeMessageDiagnostic['route']>): void {
    const record = this.#current();
    if (record) record.route = route;
  }

  delivery(generation: number, conversation: ConversationRef, receipt: DeliveryReceipt, rendering?: RuntimeMessageRendering): void {
    const record = this.#current();
    if (!record || record.generation !== generation) return;
    if (record.deliveries.length < MAX_DELIVERIES) record.deliveries = [...record.deliveries, {
      conversation: freezeConversation(conversation),
      status: receipt.status,
      ...(receipt.failure ? { failureCode: safeCode(receipt.failure.code), deliveryUnknown: receipt.failure.deliveryUnknown === true } : {}),
      ...(rendering ? { rendering: { forms: [...rendering.forms], fallbacks: [...rendering.fallbacks] } } : {}),
    }];
    else record.truncated = true;
    this.step('delivery', receipt.failure?.deliveryUnknown ? 'unknown' : receipt.status);
  }

  list(options: Readonly<{ limit?: number; conversation?: ConversationRef; messageId?: string }> = {}): readonly RuntimeMessageDiagnostic[] {
    this.#prune();
    const limit = Number.isSafeInteger(options.limit) ? Math.min(100, Math.max(1, options.limit!)) : 50;
    const key = options.conversation ? conversationKey(options.conversation) : undefined;
    return Object.freeze([...this.#records.values()].reverse()
      .filter((record) => key === undefined || conversationKey(record.conversation) === key)
      .filter((record) => options.messageId === undefined || record.messageId === options.messageId)
      .slice(0, limit).map(snapshot));
  }

  get(id: string): RuntimeMessageDiagnostic | undefined {
    this.#prune();
    const record = this.#records.get(id);
    return record ? snapshot(record) : undefined;
  }

  #current(): MutableDiagnostic | undefined {
    const scope = this.#operation.getStore();
    return scope?.active ? scope.record : undefined;
  }
  #now(): number { return (this.options.now ?? Date.now)(); }
  #prune(): void {
    const threshold = this.#now() - (this.options.ttlMs ?? 15 * 60_000);
    for (const [id, record] of this.#records) if ((record.endedAt ?? record.startedAt) < threshold) this.#records.delete(id);
  }
}

function safeCode(code: string): string {
  return deliveryCodes.has(code) ? code : 'delivery_failed';
}
const deliveryCodes = new Set(['outbound_payload_rejected', 'outbound_middleware_failed', 'outbound_delivery_incomplete',
  'delivery_unconfirmed', 'outbound_unsupported', 'platform_rejected', 'endpoint_send_failed', 'endpoint_not_found',
  'endpoint_inactive', 'endpoint_disconnected', 'endpoint_timeout', 'unsupported_operation', 'unsupported_media',
  'invalid_destination', 'invalid_payload', 'invalid_recipient', 'invalid_response', 'invalid_message_id',
  'empty_message', 'http_error', 'media_download_failed', 'partial_delivery', 'session_unavailable',
  'token_unavailable', 'endpoint_identity_mismatch', 'card_context_required', 'card_template_required']);
function freezeConversation(conversation: ConversationRef): ConversationRef {
  return Object.freeze({ endpoint: Object.freeze({ id: conversation.endpoint.id, adapter: conversation.endpoint.adapter }),
    kind: conversation.kind, id: conversation.id,
    ...(conversation.parent ? { parent: Object.freeze({ kind: conversation.parent.kind, id: conversation.parent.id }) } : {}),
    ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}),
  });
}
function conversationKey(conversation: ConversationRef): string {
  return JSON.stringify([conversation.endpoint.id, conversation.endpoint.adapter, conversation.kind, conversation.id,
    conversation.parent?.kind, conversation.parent?.id, conversation.threadId]);
}
function snapshot(record: MutableDiagnostic): RuntimeMessageDiagnostic {
  return Object.freeze({ ...record, steps: Object.freeze(record.steps.map(step => Object.freeze({ ...step }))),
    deliveries: Object.freeze(record.deliveries.map(delivery => Object.freeze({ ...delivery,
      ...(delivery.rendering ? { rendering: Object.freeze({ forms: Object.freeze([...delivery.rendering.forms]),
        fallbacks: Object.freeze([...delivery.rendering.fallbacks]) }) } : {}),
    }))),
  });
}
