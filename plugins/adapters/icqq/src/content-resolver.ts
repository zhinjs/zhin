import type { Client } from '@icqqjs/icqq';
import type {
  EndpointContentPort,
  EndpointContentResolveContext,
} from 'zhin.js/adapter';
import type {
  ConversationMessage,
  ConversationReference,
  ForwardEntry,
  Segment,
} from '@zhin.js/im-contract';
import { normalizeForwardMsgResponse } from './forward-msg.js';

/** Owns ICQQ-observed message content and recursive merged-forward expansion. */
export class IcqqContentResolver {
  readonly #client: Client;
  readonly #messages = new Map<string, ConversationMessage>();

  readonly port: EndpointContentPort = Object.freeze({
    resolve: (
      reference: ConversationReference,
      context: EndpointContentResolveContext,
    ) => this.#resolve(reference, context),
  });

  constructor(client: Client) {
    this.#client = client;
  }

  remember(messageId: string, message: ConversationMessage): void {
    this.#messages.set(messageId, message);
  }

  async #resolve(
    reference: ConversationReference,
    context: EndpointContentResolveContext,
  ) {
    context.signal.throwIfAborted();
    if (reference.kind === 'message') {
      const cached = this.#messages.get(reference.message.id);
      return cached
        ? Object.freeze({ status: 'resolved' as const, reference, value: cached })
        : Object.freeze({ status: 'not_found' as const, code: 'icqq_message_not_observed' });
    }
    if (reference.kind === 'forward') {
      try {
        const entries = await this.#resolveForwardEntries(
          reference.forwardId,
          context,
          { remainingEntries: context.maxEntries, path: new Set<string>() },
          0,
        );
        if (entries.length === 0) {
          return Object.freeze({ status: 'not_found' as const, code: 'icqq_forward_not_found' });
        }
        return Object.freeze({
          status: 'resolved' as const,
          reference,
          value: Object.freeze(entries),
        });
      } catch (error) {
        if (context.signal.aborted) throw error;
        return Object.freeze({
          status: 'failed' as const,
          code: 'icqq_forward_fetch_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (
      reference.media.kind === 'url'
      || reference.media.kind === 'base64'
      || reference.media.kind === 'path'
    ) {
      return Object.freeze({ status: 'resolved' as const, reference, value: reference.media });
    }
    return Object.freeze({
      status: 'unsupported' as const,
      code: 'icqq_media_reference_unsupported',
    });
  }

  async #resolveForwardEntries(
    forwardId: string,
    context: EndpointContentResolveContext,
    state: { remainingEntries: number; readonly path: Set<string> },
    depth: number,
  ): Promise<readonly ForwardEntry[]> {
    context.signal.throwIfAborted();
    if (state.remainingEntries <= 0 || state.path.has(forwardId)) return Object.freeze([]);
    state.path.add(forwardId);
    try {
      // ICQQ has no cancellable getForwardMsg API. Keep the generation lease
      // until the native operation settles, then honor cancellation.
      const raw = await this.#client.getForwardMsg(forwardId);
      context.signal.throwIfAborted();
      const entries = normalizeForwardMsgResponse(raw).slice(0, state.remainingEntries);
      state.remainingEntries -= entries.length;
      const expanded: ForwardEntry[] = [];
      for (const entry of entries) {
        context.signal.throwIfAborted();
        const segments: Segment[] = [];
        for (const segment of entry.segments) {
          if (segment.type !== 'forward' || depth >= context.maxDepth) {
            segments.push(segment);
            continue;
          }
          const nestedId = String(
            (segment.data as { forward_id?: unknown }).forward_id ?? '',
          ).trim();
          if (!nestedId || state.path.has(nestedId) || state.remainingEntries <= 0) {
            segments.push(segment);
            continue;
          }
          const nested = await this.#resolveForwardEntries(nestedId, context, state, depth + 1);
          segments.push(Object.freeze({
            ...segment,
            data: Object.freeze({
              ...segment.data,
              ...(nested.length > 0 ? { entries: nested } : {}),
            }),
          }));
        }
        expanded.push(Object.freeze({ ...entry, segments: Object.freeze(segments) }));
      }
      return Object.freeze(expanded);
    } finally {
      state.path.delete(forwardId);
    }
  }
}
