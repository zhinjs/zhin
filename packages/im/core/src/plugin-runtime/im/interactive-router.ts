import type { ConversationRef } from '@zhin.js/im-contract';
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

function interactiveConversationKey(conversation: ConversationRef, generation: number): string {
  const base = `${String(conversation.endpoint.id)}~${conversation.kind}:${conversation.id}`;
  const parent = conversation.parent
    ? `@${conversation.parent.kind}:${conversation.parent.id}`
    : '';
  const thread = conversation.threadId ? `#${conversation.threadId}` : '';
  return `${generation}:${base}${parent}${thread}`;
}

/**
 * One ImRuntime-owned authority for interactive routing and keyboard fallback state.
 * No handler or conversation state escapes to another runtime instance.
 */
export class RuntimeInteractiveRouter<Admission = never> {
  readonly #handlers: RegisteredRuntimeInteractiveHandler<Admission>[] = [];
  readonly #fallbacks = new Map<string, InteractiveFallbackEntry>();

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
  ): void {
    if (Object.keys(map).length === 0) return;
    this.#pruneFallbacks();
    this.#fallbacks.set(interactiveConversationKey(conversation, generation), Object.freeze({
      map: Object.freeze({ ...map }),
      expiresAt: Date.now() + ttlMs,
    }));
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
    const entry = this.#fallbacks.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.#fallbacks.delete(key);
      return undefined;
    }
    return entry.map;
  }

  #pruneFallbacks(): void {
    const now = Date.now();
    for (const [key, entry] of this.#fallbacks) {
      if (entry.expiresAt < now) this.#fallbacks.delete(key);
    }
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
