import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';
import { resolvePayloadFromText } from '../../built/interactive-segments/action.js';
import type { Segment } from '../../built/segment-contract/types.js';
import type { Message } from './contracts.js';

const DEFAULT_FALLBACK_TTL_MS = 60 * 60 * 1000;

type RuntimeInteractiveHandler = (message: Message) => Promise<boolean> | boolean;

interface RegisteredRuntimeInteractiveHandler<Admission> {
  readonly prefix: string;
  readonly handler: RuntimeInteractiveHandler;
  readonly admission?: Admission;
}

interface InteractiveFallbackEntry {
  readonly map: Readonly<Record<string, string>>;
  readonly expiresAt: number;
}

interface ExpiredFallbackEntry {
  readonly conversationKey: string;
  readonly map: Readonly<Record<string, string>>;
  readonly expiresAt: number;
}

const MAX_EXPIRED_BATCHES = 1000;

function interactiveConversationKey(conversation: ConversationRef, generation: number): string {
  return `${generation}:${conversationRefKey(conversation)}`;
}

/**
 * One ImRuntime-owned authority for interactive routing and keyboard fallback state.
 * No handler or conversation state escapes to another runtime instance.
 */
export class RuntimeInteractiveRouter<Admission = never> {
  readonly #handlers: RegisteredRuntimeInteractiveHandler<Admission>[] = [];
  readonly #fallbacks = new Map<string, InteractiveFallbackEntry[]>();
  readonly #expired: ExpiredFallbackEntry[] = [];

  #nextNumber = 1;

  constructor(private readonly fallbackTtlMs = DEFAULT_FALLBACK_TTL_MS) {}

  register(
    prefix: string,
    handler: RuntimeInteractiveHandler,
    admission?: Admission,
  ): () => void {
    if (!prefix) throw new TypeError('Interactive handler prefix must not be empty');
    const entry: RegisteredRuntimeInteractiveHandler<Admission> = Object.freeze({
      prefix,
      handler,
      admission,
    });
    this.#handlers.push(entry);
    return () => {
      const index = this.#handlers.indexOf(entry);
      if (index >= 0) this.#handlers.splice(index, 1);
    };
  }

  rememberFallback(
    conversation: ConversationRef,
    generation: number,
    map: Record<string, string>,
    ttlMs = this.fallbackTtlMs,
  ): Record<string, string> {
    this.#pruneFallbacks();
    const key = interactiveConversationKey(conversation, generation);
    const allocated: Record<string, string> = {};
    for (const [label, payload] of Object.entries(map)) {
      allocated[/^\d+$/.test(label) ? String(this.#nextNumber++) : label] = payload;
    }
    // One runtime counter survives expiry/generation changes without retaining conversation IDs.
    const entries = this.#fallbacks.get(key) ?? [];
    entries.push(Object.freeze({ map: Object.freeze({ ...allocated }), expiresAt: Date.now() + ttlMs }));
    this.#fallbacks.set(key, entries);
    return allocated;
  }

  resolvePayload(message: Message): string | undefined {
    const fromSegments = actionPayloadFromSegments(message.segments);
    if (fromSegments) return fromSegments;
    const raw = message.content.trim();
    if (!raw) return undefined;
    return resolvePayloadFromText(
      raw,
      this.#fallbackMap(message.conversation, message.generation),
    );
  }

  /** Bounded label-only history: stale text buttons are not mistaken for new input. */
  isExpiredFallback(message: Message): boolean {
    if (actionPayloadFromSegments(message.segments) || this.resolvePayload(message)) return false;
    const key = conversationRefKey(message.conversation);
    const currentKey = interactiveConversationKey(message.conversation, message.generation);
    const matches = (map: Readonly<Record<string, string>>) =>
      resolvePayloadFromText(message.content, map) !== undefined;
    if (this.#expired.some(entry => entry.conversationKey === key && matches(entry.map))) return true;
    // A generation change invalidates even a keyboard whose TTL has not elapsed.
    for (const [batchKey, entries] of this.#fallbacks) {
      if (batchKey !== currentKey && batchKey.slice(batchKey.indexOf(':') + 1) === key
        && entries.some(entry => matches(entry.map))) return true;
    }
    return false;
  }

  async dispatch(message: Message, admission?: Admission): Promise<boolean> {
    const payload = this.resolvePayload(message);
    if (!payload) return false;
    let match: RegisteredRuntimeInteractiveHandler<Admission> | undefined;
    for (const entry of this.#handlers) {
      if (entry.admission && entry.admission !== admission) continue;
      if (payload.startsWith(entry.prefix)
        && (!match || entry.prefix.length > match.prefix.length)) {
        match = entry;
      }
    }
    return match ? Boolean(await match.handler(message)) : false;
  }

  #fallbackMap(
    conversation: ConversationRef,
    generation: number,
  ): Readonly<Record<string, string>> | undefined {
    const key = interactiveConversationKey(conversation, generation);
    this.#pruneFallbacks();
    const entries = this.#fallbacks.get(key);
    return entries ? Object.assign({}, ...entries.map(entry => entry.map)) : undefined;
  }

  #pruneFallbacks(): void {
    const now = Date.now();
    for (const [key, entries] of this.#fallbacks) {
      const active = entries.filter(entry => entry.expiresAt > now);
      for (const entry of entries) {
        if (entry.expiresAt > now || entry.expiresAt + this.fallbackTtlMs <= now) continue;
        this.#expired.push({
          conversationKey: key.slice(key.indexOf(':') + 1),
          map: Object.freeze(Object.fromEntries(Object.keys(entry.map).map(label => [label, 'expired']))),
          expiresAt: entry.expiresAt + this.fallbackTtlMs,
        });
      }
      if (active.length) this.#fallbacks.set(key, active);
      else this.#fallbacks.delete(key);
    }
    for (let i = this.#expired.length - 1; i >= 0; i--) {
      if (this.#expired[i]!.expiresAt <= now) this.#expired.splice(i, 1);
    }
    if (this.#expired.length > MAX_EXPIRED_BATCHES) this.#expired.splice(0, this.#expired.length - MAX_EXPIRED_BATCHES);
  }
}

function actionPayloadFromSegments(segments: readonly Segment[] | undefined): string | undefined {
  for (const segment of segments ?? []) {
    if (segment.type !== 'action') continue;
    const payload = (segment.data as { payload?: unknown } | undefined)?.payload;
    if (typeof payload === 'string' && payload) return payload;
  }
  return undefined;
}
