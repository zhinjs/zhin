import { isDeepStrictEqual } from 'node:util';
import { createEndpointOperation, type EndpointStreaming, type EndpointStreamAcknowledgement, type EndpointMessageStream, type EndpointChildLease, type EndpointStreamSource } from '@zhin.js/adapter';
import { EndpointDeliveryError, isMediaRef, type DeliveryPart, type DeliveryReceipt, type MessageRef, type Segment } from '@zhin.js/im-contract';
import type { Locale } from '@zhin.js/plugin-runtime';
import { untrustedContent, type SendContent, type SendRequest } from './contracts.js';
import type { OutboundMediaTrust } from '../../built/outbound-media-trust.js';
import { receiptFromEndpointError, type OutboundDeliveryExecution } from './outbound-delivery-runtime.js';

/** Host-owned keys identify content, independently of model-authored or platform identifiers. */
export interface ReplyStreamSnapshot {
  readonly revision: number;
  readonly messages: readonly {
    readonly key: string;
    readonly complete: boolean;
    readonly segments: readonly {
      readonly key: string;
      readonly complete: boolean;
      readonly value: Segment;
    }[];
  }[];
}

export interface OpenReplyStreamOptions {
  readonly locale?: Locale;
  readonly source?: EndpointStreamSource;
  readonly maxBufferedBytes?: number;
  /** Revalidate trusted reply admission immediately before every platform submission. */
  readonly beforeSubmit?: () => void;
  /** Resource authorization/materialization; this must not submit an external message. */
  readonly prepare?: (segments: readonly Segment[], signal: AbortSignal) => Promise<readonly Segment[]>;
  /**
   * The streamed segments come from an untrusted source (Agent model output): every submission is
   * delivered as {@link untrustedContent} under this policy, after `prepare`.
   */
  readonly mediaTrust?: OutboundMediaTrust;
}

export interface ConfirmedReplyContent {
  /** Stable physical container key; one logical message can produce several containers. */
  readonly key: string;
  readonly segments: readonly Segment[];
  readonly message?: MessageRef;
}

export interface CoreReplyStream {
  readonly minIntervalMs?: number;
  readonly receipt: DeliveryReceipt;
  readonly confirmed: readonly ConfirmedReplyContent[];
  /** Coalesces replaceable candidates; does not allocate a Promise for every model token. */
  update(snapshot: ReplyStreamSnapshot): void;
  finish(snapshot: ReplyStreamSnapshot): Promise<DeliveryReceipt>;
  cancel(): Promise<DeliveryReceipt>;
}

interface ReplyGroup {
  readonly key: string;
  readonly segments: readonly Segment[];
  readonly format?: 'text' | 'markdown';
  readonly complete: boolean;
}
interface PhysicalReply {
  readonly key: string;
  readonly native: EndpointMessageStream;
  readonly format: 'text' | 'markdown';
  readonly prefixKey: string;
  accepted: string;
  revision: number;
  message?: MessageRef;
  closed: boolean;
}
interface ReplyGroupState {
  committed?: { readonly position: number; readonly source: ReplyGroup };
  consumed: number;
  containers: number;
  accepted: string;
  replyTo?: string;
  physical?: PhysicalReply;
  unsupported?: boolean;
  done?: boolean;
}
interface ProgressiveReplyContext {
  readonly endpoint: EndpointChildLease;
  readonly streaming: EndpointStreaming;
  readonly options: OpenReplyStreamOptions;
  readonly deliver: (content: SendContent, execution: OutboundDeliveryExecution) => Promise<DeliveryReceipt>;
  readonly release: () => void;
}

/** One producer, one sending pump, and one replaceable candidate rather than a queue per token. */
export function createCoreReplyStream(context: ProgressiveReplyContext): CoreReplyStream {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([context.endpoint.signal, cancellation.signal]);
  const groups = new Map<string, ReplyGroupState>();
  const confirmed = new Map<string, ConfirmedReplyContent>();
  const maxBufferedBytes = context.options.maxBufferedBytes ?? 1024 * 1024;
  let receipt: DeliveryReceipt = { status: 'suppressed' };
  let failure: DeliveryReceipt | undefined;
  let pending: ReplyStreamSnapshot | undefined, pumping: Promise<void> | undefined, terminal: Promise<DeliveryReceipt> | undefined;
  let revision = -1, cancelled = false, finished = false, settled = false, released = false, submitted = false, lastSubmission = 0;

  const parts = (): readonly DeliveryPart[] => [...confirmed.values()].map(part => ({ ...(part.message ? { message: part.message } : {}) }));
  const decorate = (value: DeliveryReceipt): DeliveryReceipt => ({ ...value, ...(parts().length ? { parts: parts(), message: parts().find(part => part.message)?.message } : {}) });
  const release = () => {
    if (released) return;
    released = true;
    context.endpoint.signal.removeEventListener('abort', onAbort);
    context.release();
  };
  const fail = (value: DeliveryReceipt) => { if (failure) return; failure = value; receipt = decorate(value); pending = undefined;
    // Local teardown cannot replace the original delivery evidence or prevent cancellation.
    for (const state of groups.values()) { try { state.physical?.native.cancel(); } catch { /* No external operation is retried. */ } } };
  const remember = (key: string, part: DeliveryPart, content: readonly Segment[] | undefined) => {
    confirmed.set(key, Object.freeze({ key, segments: content ?? [], ...(part.message ? { message: part.message } : {}) }));
  };
  const prepareSegments = (segments: readonly Segment[]) => context.options.prepare
    ? createEndpointOperation({ signal }).prepare(() => context.options.prepare!(segments, signal)) : Promise.resolve(segments);
  const mediaTrust = context.options.mediaTrust;
  const prepare = async (segments: readonly Segment[]): Promise<SendContent> => {
    const prepared = await prepareSegments(segments);
    return mediaTrust ? untrustedContent([...prepared], mediaTrust) : prepared;
  };
  const wait = async () => {
    if (!lastSubmission) return;
    for (;;) {
      const remaining = (context.streaming.minIntervalMs ?? 0) - (Date.now() - lastSubmission);
      if (remaining <= 0) return;
      await new Promise<void>((resolve, reject) => {
        // Node clamps larger delays to 1 ms; keep the original deadline across timer chunks.
        const timer = setTimeout(done, Math.min(remaining, 2_147_483_647));
        function done() { signal.removeEventListener('abort', abort); resolve(); }
        function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new EndpointDeliveryError('endpoint_inactive', 'Reply stream ended', 'not_sent')); }
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  };
  const external = async <T>(call: () => Promise<T>): Promise<T> => {
    await wait(); signal.throwIfAborted();
    context.endpoint.assertActive(); context.options.beforeSubmit?.();
    lastSubmission = Date.now(); submitted = true;
    try { return await createEndpointOperation({ signal }).run(call); } finally { submitted = false; }
  };

  const finishPhysical = async (physical: PhysicalReply, text: string, conversation: MessageRef['conversation']): Promise<{
    ack: EndpointStreamAcknowledgement; failure?: DeliveryReceipt;
  }> => {
    try { return { ack: await external(() => physical.native.finish(text)) }; }
    catch (error) {
      let ack: EndpointStreamAcknowledgement | undefined;
      try { ack = physical.native.lastAcknowledgement; } catch { /* A local inspection must preserve the original close error. */ }
      if (!ack || ack.status !== 'sent' || typeof ack.messageId !== 'string' || !ack.messageId.trim() || typeof ack.acceptedText !== 'string'
        || !text.startsWith(ack.acceptedText) || !ack.acceptedText.startsWith(physical.accepted)
        || physical.message && (ack.messageId !== physical.message.id || ack.acceptedText === physical.accepted)) throw error;
      // Persist a verified body update through normal delivery, while keeping the close failure terminal.
      return { ack, failure: receiptFromEndpointError(error, true, conversation) };
    }
  };

  const sendAtomic = async (group: ReplyGroup, state: ReplyGroupState) => {
    if (!group.complete || state.done) return;
    const content = await prepare(group.segments);
    let index = 0;
    const result = await context.deliver(content, {
      send: async request => ({ result: await external(() => context.endpoint.send({ ...request, signal })) }),
      history: () => 'create', confirmed: (part, value) => remember(`${group.key}/${index++}`, part, value),
    });
    if (result.status !== 'sent') { fail(result); return; }
    state.done = true; receipt = decorate(failure ?? { status: 'sent' });
  };

  const sendText = async (group: ReplyGroup, state: ReplyGroupState) => {
    if (state.done) return;
    const prepared = await prepare(group.segments);
    let continueContainer = true;
    while (continueContainer && !cancelled && !failure) {
      continueContainer = false;
      let ack: EndpointStreamAcknowledgement | undefined;
      let closeFailure: DeliveryReceipt | undefined;
      let history: ReturnType<OutboundDeliveryExecution['history']> = 'skip';
      let physicalKey = `${group.key}/${state.containers}`;
      let confirmedPart = 0;
      let renderedLength = state.consumed;
      const result = await context.deliver(prepared, {
        send: async request => {
          const projection = streamText(request.payload);
          if (!projection) throw new EndpointDeliveryError('unsupported_stream_payload', 'Incremental middleware produced an incompatible message', 'rejected');
          const full = projection.text;
          renderedLength = full.length;
          if (!full.startsWith(state.accepted)) throw new EndpointDeliveryError('stream_prefix_changed', 'A published source prefix cannot be rewritten', 'rejected');
          if (!state.physical && state.consumed === full.length && state.consumed > 0) {
            state.done = group.complete;
            ack = { status: 'buffered', acceptedText: '' }; return {};
          }
          if (state.unsupported) {
            ack = { status: 'buffered', acceptedText: '' };
            if (!group.complete) return {};
            history = 'create'; state.done = true;
            return { result: await external(() => context.endpoint.send({ ...request, signal })) };
          }
          const originOffset = state.consumed;
          const remaining = full.slice(originOffset);
          const prefix = state.consumed ? [] : projection.prefix;
          const prefixKey = JSON.stringify(prefix);
          if (!state.physical) {
            if (!state.consumed) {
              const reply = projection.prefix.find(segment => segment.type === 'reply');
              const data: Readonly<Record<string, unknown>> | undefined = reply?.data;
              state.replyTo = typeof data?.message_id === 'string' ? data.message_id : undefined;
            }
            const native = context.streaming.open({ conversation: request.conversation, format: projection.format,
              prefix, source: context.options.source, locale: request.locale, signal,
              ...(state.consumed ? { continuation: { precedingText: full.slice(0, state.consumed),
                ...(state.replyTo ? { replyTo: state.replyTo } : {}) } } : {}),
            });
            if (!native) {
              if (state.consumed) throw new EndpointDeliveryError('stream_continuation_unsupported',
                'A confirmed reply cannot fall back by replaying its source prefix', 'not_sent');
              state.unsupported = true;
              ack = { status: 'buffered', acceptedText: '' };
              if (!group.complete) return {};
              history = 'create'; state.done = true;
              return { result: await external(() => context.endpoint.send({ ...request, signal })) };
            }
            state.physical = { key: physicalKey, native, format: projection.format, prefixKey, accepted: '', revision: 0, closed: false };
          }
          const physical = state.physical;
          if (physical.format !== projection.format || physical.prefixKey !== prefixKey) {
            throw new EndpointDeliveryError('stream_projection_changed', 'A physical stream cannot change its format or addressing prefix', 'rejected');
          }
          physicalKey = physical.key;
          const close = group.complete;
          const text = remaining;
          if (!close && text === physical.accepted) { ack = { status: 'buffered', acceptedText: physical.accepted }; return {}; }
          if (close) {
            const completed = await finishPhysical(physical, text, request.conversation);
            ack = completed.ack; closeFailure = completed.failure;
          } else ack = await external(() => physical.native.write(text));
          if (!text.startsWith(ack.acceptedText) || !ack.acceptedText.startsWith(physical.accepted)) {
            throw new EndpointDeliveryError('stream_ack_invalid', 'Endpoint returned an invalid confirmed prefix', 'unknown');
          }
          if (ack.status === 'buffered' && ack.acceptedText !== physical.accepted) {
            throw new EndpointDeliveryError('stream_ack_invalid', 'A buffered update cannot confirm new content', 'unknown');
          }
          if (ack.status === 'sent' && !ack.messageId?.trim()) throw new EndpointDeliveryError('delivery_unconfirmed', 'Stream returned no confirmed message identity', 'unknown');
          if (ack.status === 'sent' && physical.message && physical.message.id !== ack.messageId) {
            throw new EndpointDeliveryError('stream_identity_changed', 'A physical stream changed its message identity', 'unknown');
          }
          if (close && ack.status !== 'sent') throw new EndpointDeliveryError('delivery_unconfirmed', 'Final reply was not confirmed as a saved message', 'unknown');
          physical.accepted = ack.acceptedText;
          state.accepted = full.slice(0, state.consumed) + ack.acceptedText;
          if (ack.status === 'sent') {
            history = physical.message ? { revision: physical.revision + 1 } : 'create';
            physical.revision += 1;
            physical.message = { conversation: request.conversation, id: ack.messageId! };
          }
          if (!closeFailure && close && !ack.exhausted && ack.acceptedText === text) {
            physical.closed = true; state.consumed += ack.acceptedText.length; state.physical = undefined;
            state.containers += 1;
            state.done = group.complete && state.consumed === full.length;
          } else if (!closeFailure && ack.exhausted) {
            if (!ack.acceptedText.length) throw new EndpointDeliveryError('stream_capacity_exhausted', 'No source progress is possible in this container', 'not_sent');
            if (close) {
              physical.closed = true; state.consumed += ack.acceptedText.length; state.physical = undefined; state.containers += 1;
              state.done = group.complete && state.consumed === full.length;
            }
            continueContainer = !state.done;
          }
          const confirmedContent = [...(originOffset ? [] : projection.prefix),
            projection.format === 'text' ? { type: 'text', data: { text: ack.acceptedText } }
              : { type: 'markdown', data: { content: ack.acceptedText } }];
          return ack.status === 'sent' ? { result: ack.messageId!,
            ...(ack.contentUnavailable || !ack.confirmedContent && projection.format === 'markdown' && (originOffset > 0 || ack.exhausted)
              ? { contentUnavailable: true as const }
              : { confirmedContent: ack.confirmedContent ?? confirmedContent }),
          } : {};
        },
        history: () => history,
        confirmed: (part, value) => remember(confirmedPart++ ? `${physicalKey}/${confirmedPart}` : physicalKey, part, value),
      });
      if (closeFailure) { fail(closeFailure); return; }
      if (result.status !== 'sent' && (!ack || result.failure)) { fail(result); return; }
      if (result.status === 'sent') receipt = decorate(failure ?? { status: 'sent' });
      if (ack?.exhausted && state.physical && !state.physical.closed) {
        // Finish this exact accepted prefix before attempting another physical container.
        const physical = state.physical;
        const body = physical.accepted;
        const result = await context.deliver(prepared, {
          send: async request => {
            const projection = streamText(request.payload);
            if (!projection) throw new EndpointDeliveryError('unsupported_stream_payload', 'Cannot close transformed reply', 'rejected');
            if (!projection.text.startsWith(state.accepted) || projection.format !== physical.format
              || JSON.stringify(state.consumed ? [] : projection.prefix) !== physical.prefixKey) {
              throw new EndpointDeliveryError('stream_projection_changed', 'Container completion changed previously accepted content or addressing', 'rejected');
            }
            const completed = await finishPhysical(physical, body, request.conversation);
            const end = completed.ack; closeFailure = completed.failure;
            if (end.acceptedText !== body || end.status !== 'sent' || !end.messageId) throw new EndpointDeliveryError('delivery_unconfirmed', 'Container completion is unconfirmed', 'unknown');
            if (physical.message && end.messageId !== physical.message.id) throw new EndpointDeliveryError('stream_identity_changed', 'Container completion changed its message identity', 'unknown');
            return { result: end.messageId,
              ...(end.contentUnavailable || !end.confirmedContent && projection.format === 'markdown'
                ? { contentUnavailable: true as const }
                : { confirmedContent: end.confirmedContent ?? [...(state.consumed ? [] : projection.prefix),
                  projection.format === 'text' ? { type: 'text', data: { text: body } } : { type: 'markdown', data: { content: body } }] }),
            };
          },
          history: () => physical.message ? { revision: physical.revision + 1 } : 'create',
          confirmed: (part, value) => remember(physical.key, part, value),
        });
        if (closeFailure) { fail(closeFailure); return; }
        if (result.status !== 'sent') { fail(result); return; }
        receipt = decorate({ status: 'sent' });
        physical.closed = true; state.consumed += body.length; state.physical = undefined; state.containers += 1;
        state.done = group.complete && state.consumed === renderedLength;
        continueContainer = state.consumed < renderedLength;
      }
    }
  };

  const pump = async () => {
    try {
      while (pending && !cancelled && !failure) {
        await wait();
        if (cancelled) break;
        const current = pending; pending = undefined;
        const candidates = replyGroups(current);
        // Validate the entire published prefix before a newly inserted group can submit anything.
        for (const state of groups.values()) {
          if (!state.committed) continue;
          const { position, source } = state.committed, candidate = candidates[position];
          if (!candidate || candidate.key !== source.key || candidate.format !== source.format
            || state.done && !isDeepStrictEqual(candidate.segments, source.segments)) {
            throw new EndpointDeliveryError('stream_prefix_changed', 'A published reply group cannot be rewritten, removed or reordered', 'rejected');
          }
        }
        for (const [position, group] of candidates.entries()) {
          if (cancelled || failure) break;
          const state = groups.get(group.key) ?? { consumed: 0, containers: 0, accepted: '' };
          groups.set(group.key, state);
          if (group.format) await sendText(group, state); else await sendAtomic(group, state);
          if (state.done || state.physical) state.committed = { position, source: group };
          if (!group.complete) break;
        }
      }
    } catch (error) { if (!cancelled) fail(receiptFromEndpointError(error, submitted)); }
    finally {
      pumping = undefined;
      if (cancelled || finished || failure) release();
      else if (pending) start();
    }
  };
  const start = () => { pumping ??= pump(); };
  const admit = (snapshot: ReplyStreamSnapshot) => {
    if (semanticSnapshotBytes(snapshot) > maxBufferedBytes) {
      fail({ status: 'failed', failure: { code: 'stream_buffer_limit', message: 'Reply snapshot exceeds the configured resource limit', retryable: false,
        ...(submitted ? { deliveryUnknown: true as const } : {}) } });
      cancellation.abort(); if (!pumping) release(); return;
    }
    revision = snapshot.revision; pending = snapshot; start();
  };
  const update = (snapshot: ReplyStreamSnapshot) => {
    if (cancelled || finished || failure || snapshot.revision <= revision) return;
    admit(snapshot);
  };
  const cancel = (): Promise<DeliveryReceipt> => {
    if (settled) return terminal ?? Promise.resolve(receipt);
    if (!cancelled) {
      cancelled = true; pending = undefined;
      fail({ status: 'failed', failure: { code: 'cancelled', message: 'Reply stream cancelled', retryable: false,
        ...(submitted ? { deliveryUnknown: true as const } : {}) } });
      cancellation.abort(); release();
    }
    return Promise.resolve(receipt);
  };
  const onAbort = () => { void cancel(); };
  context.endpoint.signal.addEventListener('abort', onAbort, { once: true });
  if (context.endpoint.signal.aborted) void cancel();
  return Object.freeze({
    minIntervalMs: context.streaming.minIntervalMs,
    get receipt() { return receipt; }, get confirmed() { return Object.freeze([...confirmed.values()]); },
    update,
    finish(snapshot: ReplyStreamSnapshot) {
      if (terminal) return terminal;
      if (cancelled || failure) return Promise.resolve(receipt);
      if (snapshot.messages.some(message => !message.complete || message.segments.some(segment => !segment.complete))) {
        fail({ status: 'failed', failure: { code: 'incomplete_reply', message: 'Final reply contains incomplete content', retryable: false,
          ...(submitted ? { deliveryUnknown: true as const } : {}) } });
        cancellation.abort();
        finished = true; settled = true; release(); return Promise.resolve(receipt);
      }
      if (snapshot.revision >= revision) admit(snapshot);
      finished = true;
      terminal = (async () => {
        await pumping;
        if (!failure && pending) { start(); await pumping; }
        for (const state of groups.values()) if (!failure && !state.done && state.physical) {
          fail({ status: 'failed', failure: { code: 'incomplete_reply', message: 'Final reply did not close all content', retryable: false } }); break;
        }
        settled = true; release(); return decorate(receipt);
      })();
      return terminal;
    }, cancel,
  });
}

function semanticSnapshotBytes(snapshot: ReplyStreamSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot, (key, value: unknown) => key === 'media' && isMediaRef(value)
    && (value.kind === 'base64' || value.value.startsWith('data:')) ? { ...value, value: '[inline media]' } : value));
}

function streamText(payload: unknown): { format: 'text' | 'markdown'; text: string; prefix: Segment[] } | undefined {
  const segments: readonly Segment[] = typeof payload === 'string' ? [{ type: 'text', data: { text: payload } }]
    : Array.isArray(payload) ? payload : [];
  const prefix: Segment[] = [], text: string[] = [];
  let format: 'text' | 'markdown' | undefined;
  for (const segment of segments) {
    if (!format && (segment.type === 'reply' || segment.type === 'mention')) { prefix.push(segment); continue; }
    if (segment.type !== 'text' && segment.type !== 'markdown' || format && format !== segment.type) return undefined;
    format = segment.type;
    const data: Readonly<Record<string, unknown>> = segment.data;
    const value = segment.type === 'text' ? data.text : data.content;
    if (typeof value !== 'string') return undefined;
    text.push(value);
  }
  return format ? { format, text: text.join(''), prefix } : undefined;
}

function replyGroups(snapshot: ReplyStreamSnapshot): ReplyGroup[] {
  const groups: ReplyGroup[] = [];
  for (const message of snapshot.messages) {
    // Rendered buttons are canonical keyboards and must remain attached to their logical body.
    if (message.segments.some(segment => segment.value.type === 'keyboard')) {
      const complete = message.complete && message.segments.every(segment => segment.complete);
      groups.push({ key: `${message.key}/interactive`, segments: message.segments.map(segment => segment.value), complete });
      if (!complete) break;
      continue;
    }
    let prefix: Segment[] = [], current: { key: string; segments: Segment[]; format: 'text' | 'markdown'; complete: boolean } | undefined;
    const flush = (closed: boolean) => { if (current) { groups.push({ ...current, complete: closed && current.complete }); current = undefined; } };
    for (const segment of message.segments) {
      const value = segment.value;
      if (value.type === 'text' || value.type === 'markdown') {
        if (current && current.format !== value.type) flush(true);
        current ??= { key: `${message.key}/${segment.key}`, segments: prefix, format: value.type, complete: true };
        prefix = []; current.segments.push(value); current.complete &&= segment.complete;
      } else {
        flush(true);
        if (value.type === 'mention' || value.type === 'reply') prefix.push(value);
        else { groups.push({ key: `${message.key}/${segment.key}`, segments: [...prefix, value], complete: segment.complete }); prefix = []; }
      }
      if (!segment.complete) { flush(false); return groups; }
    }
    flush(message.complete);
    if (prefix.length && message.complete) groups.push({ key: `${message.key}/prefix`, segments: prefix, complete: true });
    if (!message.complete) break;
  }
  return groups;
}
