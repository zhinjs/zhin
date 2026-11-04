import type { AiOutboundSegmentProfile } from '@zhin.js/core';
import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import type { MessageAliasTable } from '@zhin.js/ai';
import { createStructuredReplyStreamParser } from '../outbound/structured-reply-stream.js';

/** One public answering phase; provider consumption never waits for platform requests. */
export class ReplyStreamRun {
  readonly stream: CoreReplyStream;
  #parser: ReturnType<typeof createStructuredReplyStreamParser>;
  readonly #profile?: AiOutboundSegmentProfile;
  readonly #aliases?: MessageAliasTable;
  #epoch = 0;
  #revision = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #parsing?: Promise<void>;
  #pending = false;
  #offered = false;
  #error?: unknown;
  #snapshot?: ReplyStreamSnapshot;
  #lastParse = -Infinity;
  #closed = false;
  readonly #failureController = new AbortController();

  constructor(stream: CoreReplyStream, profile?: AiOutboundSegmentProfile, aliases?: MessageAliasTable) {
    this.stream = stream;
    this.#profile = profile;
    this.#parser = createStructuredReplyStreamParser(profile);
    this.#aliases = aliases;
  }

  get failureSignal(): AbortSignal { return this.#failureController.signal; }
  get offered(): boolean { return this.#offered; }
  get error(): unknown { return this.#error; }
  get snapshot(): ReplyStreamSnapshot | undefined { return this.#snapshot; }

  /** A retry before publication starts a new candidate, never concatenates two attempts. */
  begin(): number {
    if (this.#offered) throw new Error('A published reply cannot be regenerated');
    this.#clearTimer();
    this.#epoch += 1;
    this.#parser = createStructuredReplyStreamParser(this.#profile);
    this.#snapshot = undefined;
    this.#error = undefined;
    this.#lastParse = -Infinity;
    this.#pending = false;
    return this.#epoch;
  }

  append(text: string, epoch = this.#epoch): void {
    if (epoch !== this.#epoch) return;
    if (this.#closed) return;
    if (this.#error) throw this.#error;
    if (this.stream.receipt.status === 'failed' || this.stream.receipt.status === 'rejected') {
      throw new Error(this.stream.receipt.failure?.code ?? 'Reply delivery stopped');
    }
    this.#parser.append(text);
    this.#pending = true;
    this.#schedule();
  }

  async complete(raw: string): Promise<ReplyStreamSnapshot | undefined> {
    this.#closed = true;
    this.#clearTimer();
    await this.#parsing;
    if (this.#error) throw this.#error;
    const snapshot = await this.#parser.finish(raw, ++this.#revision);
    if (snapshot) this.#snapshot = this.#resolve(snapshot);
    return snapshot ? this.#snapshot : undefined;
  }

  async stop(): Promise<void> {
    this.#closed = true;
    this.#clearTimer();
    await this.#parsing;
  }

  #schedule(): void {
    if (this.#closed || this.#timer || this.#parsing) return;
    // JSON-only prefixes must not consume the first public content's refresh interval.
    const wait = this.#offered ? Math.max(0, this.#lastParse + (this.stream.minIntervalMs ?? 0) - Date.now()) : 0;
    // Native Node timers cannot represent a longer single delay; each timer firing rechecks the deadline.
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#offered && this.#lastParse + (this.stream.minIntervalMs ?? 0) > Date.now()) {
        this.#schedule();
        return;
      }
      const candidate = this.#parser;
      const epoch = this.#epoch;
      this.#pending = false;
      this.#lastParse = Date.now();
      this.#parsing = candidate.snapshot(++this.#revision).then(snapshot => {
        if (this.#closed || epoch !== this.#epoch || !snapshot) return;
        const resolved = this.#resolve(snapshot);
        this.#snapshot = resolved;
        if (resolved.messages.some(message => message.segments.some(part =>
          (part.value.type === 'text' || part.value.type === 'markdown')
            ? String((part.value.data as Readonly<Record<string, unknown>>)[part.value.type === 'text' ? 'text' : 'content'] ?? '').length > 0 : part.complete))) {
          // Conservative: even a queued update may already be on the wire when an attempt fails.
          this.#offered = true;
          this.stream.update(resolved);
          const receipt = this.stream.receipt;
          if (receipt.status === 'failed' || receipt.status === 'rejected') {
            throw new Error(receipt.failure?.code ?? 'Reply delivery stopped');
          }
        }
      }).catch(error => {
        if (epoch === this.#epoch) {
          this.#error = error;
          this.#failureController.abort(error);
        }
      }).finally(() => {
        this.#parsing = undefined;
        if (this.#pending && !this.#error) this.#schedule();
      });
    }, Math.min(wait, 2_147_483_647));
    this.#timer.unref?.();
  }

  #resolve(snapshot: ReplyStreamSnapshot): ReplyStreamSnapshot {
    if (!this.#aliases) return snapshot;
    return { ...snapshot, messages: snapshot.messages.map(message => ({ ...message,
      segments: message.segments.map(part => part.value.type === 'reply' && typeof part.value.data.message_id === 'string'
        ? { ...part, value: { ...part.value, data: { ...part.value.data, message_id: this.#aliases!.resolve(part.value.data.message_id) } } }
        : part),
    })) };
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
