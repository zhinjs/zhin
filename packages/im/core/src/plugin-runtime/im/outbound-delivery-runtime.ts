import { createHash } from 'node:crypto';
import { projectLocale, runRuntimeMiddleware } from './inbound-spine.js';
import {
  resolveLocale,
  type CapabilityId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { EndpointDeliveryError, type ConversationRef, type DeliveryReceipt, type DeliveryPart, type EndpointSendPart, type EndpointSendResult, type Segment, type TextSegment } from '@zhin.js/im-contract';
import { isCanonicalSegment } from '../../built/segment-contract/assert.js';
import { collectSegmentMedia } from '../../built/segment-contract/media.js';
import { isStrictCanonicalSegment } from '../../built/segment-contract/validate.js';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { isJsxElement, type JSXElement } from '@zhin.js/jsx';
import { createOutboundEnvelope, isComponentCall, isRawContent, isUntrustedContent, operationEndpoint, type OutboundEnvelope, type SendContent, type SendRequest } from './contracts.js';
import { OutboundRenderer, projectOutboundPayload, resolveOutboundPresentation, type OutboundProjection } from './outbound-renderer.js';
import { flattenOutboundArray } from '../../built/outbound-content-arrays.js';
import { requireAdapters } from './endpoint-runtime.js';
import { formatConversationLog, previewMessageContent, type RuntimeMessageEvent, type RuntimeMessageRendering } from './message-events.js';
import { collectButtonPayloads, type JsxButtonBatch, type PluginIncarnationRef, type RememberFallbackContext } from './interactive-router.js';
import type { RuntimeMessageDiagnostics } from './message-diagnostics.js';

const logger = getLogger('im.outbound');

/** A payload that cannot be rendered is not sent; say why, or the failure is invisible to the operator. */
function logRejectedPayload(conversation: ConversationRef, stage: 'render' | 'middleware_render', error: unknown): void {
  logger.warn(formatCompact({
    op: 'outbound_payload_rejected',
    stage,
    conv: formatConversationLog(conversation),
    error: error instanceof Error ? error.message : String(error),
  }));
}

interface OutboundDeliveryContext {
  readonly diagnostics?: RuntimeMessageDiagnostics;
  prepareButtons?(request: SendRequest, snapshot: RuntimeSnapshot): JsxButtonBatch;
  record(request: SendRequest, receipt: DeliveryReceipt, canonicalContent?: readonly Segment[] | 'unavailable'): Promise<number | undefined | void>;
  recordUpdate?(request: SendRequest, receipt: DeliveryReceipt, revision: number, canonicalContent?: readonly Segment[] | 'unavailable'): Promise<number | undefined | void>;
  /** Side-channel correlation ledger for inbound origin; failures never affect the receipt. */
  ledger?(conversation: ConversationRef, receipt: DeliveryReceipt, payload: unknown): void;
  rememberFallback(
    conversation: ConversationRef,
    generation: number,
    map: Record<string, string>,
    context?: number | RememberFallbackContext | PluginIncarnationRef,
  ): Record<string, string> | void;
  publish(event: RuntimeMessageEvent): void;
}

/** Internal transport continuation. Rendering, policy and middleware still own every submitted revision. */
export interface OutboundDeliveryExecution {
  send(request: import('@zhin.js/adapter').EndpointSendRequest): Promise<{
    readonly result?: EndpointSendResult;
    readonly confirmedContent?: readonly Segment[];
    readonly contentUnavailable?: true;
  }>;
  history(): 'create' | 'skip' | Readonly<{ revision: number }>;
  confirmed(part: DeliveryPart, content: readonly Segment[] | undefined): void;
}

/** Owns rendering, policy projection, middleware, Endpoint delivery, and delivery facts. */
export class OutboundDeliveryRuntime {
  readonly #renderer: OutboundRenderer;

  constructor(
    private readonly context: OutboundDeliveryContext,
    renderer: OutboundRenderer = new OutboundRenderer(),
  ) {
    this.#renderer = renderer;
  }

  async deliver(request: SendRequest, snapshot: RuntimeSnapshot, execution?: OutboundDeliveryExecution): Promise<DeliveryReceipt> {
    let rendering: RuntimeMessageRendering | undefined;
    const receipt = await this.#deliver(request, snapshot, value => { rendering = value; }, execution);
    this.context.diagnostics?.delivery(snapshot.generation, request.conversation, receipt, rendering);
    return receipt;
  }

  async #deliver(
    request: SendRequest,
    snapshot: RuntimeSnapshot,
    observeRendering: (rendering: RuntimeMessageRendering) => void,
    execution?: OutboundDeliveryExecution,
  ): Promise<DeliveryReceipt> {
    const adapter = request.conversation.endpoint.id as CapabilityId;
    const boundEndpoint = request[operationEndpoint];
    if (boundEndpoint && boundEndpoint.canonicalId !== adapter) throw new Error('Outbound Endpoint binding does not match its conversation');
    const presentation = resolveOutboundPresentation(snapshot, request.conversation, request.requester);
    const jsxCache = new WeakMap<JSXElement, Promise<unknown>>();
    const buttons = this.context.prepareButtons?.(request, snapshot);
    const renderOptions = { jsxCache, bindButton: buttons?.bind, signal: boundEndpoint?.signal };
    let initialPayload: unknown;
    let initialProjection: OutboundProjection;
    try {
      const rendered = await this.#renderer.render(request.content, {
        requester: request.requester,
        snapshot: snapshot,
        conversation: request.conversation,
        incoming: request.incoming,
        ...renderOptions,
      });
      initialProjection = await projectOutboundPayload(rendered, request.conversation, snapshot, { deferInteractive: true, presentation, signal: renderOptions.signal });
      initialPayload = initialProjection.payload;
    } catch (error) {
      // Preparation precedes the transport boundary; cancellation here is confirmed not sent.
      if (renderOptions.signal?.aborted) return failedDeliveryReceipt('endpoint_inactive');
      if (error instanceof EndpointDeliveryError && error.code === 'unsupported_operation' && error.disposition === 'not_sent') return receiptFromEndpointError(error, false);
      logRejectedPayload(request.conversation, 'render', error);
      return rejectedDeliveryReceipt('outbound_payload_rejected');
    }

    let adapters;
    try {
      adapters = requireAdapters(snapshot);
    } catch (error) {
      return receiptFromEndpointError(error, false);
    }
    const envelope = createOutboundEnvelope({
      conversation: request.conversation,
      requester: request.requester,
      generation: snapshot.generation,
      clientAdapter: adapters.clientAdapter(adapter),
    }, initialPayload, () => {
      if (!boundEndpoint) return adapters.clientById(adapter);
      boundEndpoint.assertActive();
      return boundEndpoint.endpoint;
    });
    // Record identities and fallback text before middleware can mutate the array
    // or its segments. Do not copy/serialize media buffers or streams.
    const initialSegmentSet = new Set<unknown>(Array.isArray(initialPayload) ? initialPayload : []);
    const initialItems = Array.isArray(initialPayload) ? initialPayload.map(item => ({
      item, type: item?.type, text: item?.type === 'text' ? item.data?.text : undefined,
    })) : undefined;
    const retainsInitialProjection = (value: unknown): boolean =>
      (value === initialPayload && !initialItems)
      || (!!initialItems && initialItems.length > 0 && Array.isArray(value)
        && value.length === initialItems.length
        && initialItems.every(({ item, type, text }, index) => value[index] === item
          && item?.type === type && (type !== 'text' || item.data?.text === text)));
    const retainsInitialSegments = (value: unknown): boolean =>
      retainsInitialProjection(value)
      || (!!initialItems && initialItems.length > 0 && Array.isArray(value)
        && initialItems.every(({ item, type, text }) => value.includes(item)
          && item?.type === type && (type !== 'text' || item.data?.text === text)));
    const fallbackIncarnation: PluginIncarnationRef = {
      requester: request.requester,
      snapshot,
      node: snapshot.tree.get(request.requester),
      ...(boundEndpoint?.signal ? { signal: boundEndpoint.signal } : {}),
    };
    let terminalEntered = false;
    let receipt: DeliveryReceipt | undefined;

    try {
      await runRuntimeMiddleware<OutboundEnvelope>(
        snapshot,
        envelope,
        async () => {
          terminalEntered = true;
          let payload: unknown;
          let projection: OutboundProjection;
          const buttonPayloads = new Set<string>();
          try {
            // Native payload replacements and in-place array mutations remain possible; only authoring values need evaluation.
            const replacement = envelope.payload;
            const renderItemOptions = {
              requester: request.requester,
              snapshot: snapshot,
              conversation: request.conversation,
              incoming: request.incoming,
              ...renderOptions,
            };
            let replaced: unknown = replacement;
            if (needsAuthoringRender(replacement)) {
              if (Array.isArray(replacement) && initialSegmentSet.size > 0 && replacement.some(item => initialSegmentSet.has(item))) {
                const renderedItems: unknown[] = [];
                for (const item of flattenOutboundArray(replacement)) {
                  if (initialSegmentSet.has(item) || !needsAuthoringRender(item)) {
                    renderedItems.push(item);
                  } else {
                    renderedItems.push(await this.#renderer.render(item as SendContent, renderItemOptions));
                  }
                }
                replaced = flattenOutboundArray(renderedItems);
              } else {
                replaced = await this.#renderer.render(replacement as SendContent, renderItemOptions);
              }
            }
            projection = await projectOutboundPayload(replaced, request.conversation, snapshot, {
              presentation, signal: renderOptions.signal,
              inheritedFallbacks: retainsInitialSegments(replaced) ? initialProjection.rendering.fallbacks : [],
              rememberFallback: (map) => {
                for (const value of Object.values(map)) buttonPayloads.add(value);
                return this.context.rememberFallback(request.conversation, snapshot.generation, map, {
                  incarnation: fallbackIncarnation,
                });
              },
            });
            payload = projection.payload;
            observeRendering(projection.rendering);
            for (const value of collectButtonPayloads(payload)) buttonPayloads.add(value);
          } catch (error) {
            if (renderOptions.signal?.aborted) {
              receipt = failedDeliveryReceipt('endpoint_inactive');
              return;
            }
            const unsupported = error instanceof EndpointDeliveryError && error.code === 'unsupported_operation' && error.disposition === 'not_sent';
            if (!unsupported) logRejectedPayload(request.conversation, 'middleware_render', error);
            receipt = unsupported ? receiptFromEndpointError(error as EndpointDeliveryError, false) : rejectedDeliveryReceipt('outbound_payload_rejected');
            return;
          }

          if (isEmptyOutboundPayload(payload)) {
            receipt = suppressedDeliveryReceipt();
            return;
          }

          const revokeButtons = buttons?.activate(buttonPayloads);
          const canonicalContent: readonly Segment[] | undefined = typeof payload === 'string'
            ? [{ type: 'text', data: { text: payload } }]
            : Array.isArray(payload) && payload.every(isCanonicalSegment) ? payload : undefined;
          // Capture known canonical content before the endpoint can mutate it.
          // Inline rendering bytes and opaque extensions never become new history.
          let contentSources = canonicalContent?.map(snapshotHistorySource);
          let contentUnavailable = false;
          const payloadLength = Array.isArray(payload) ? payload.length : 1;
          try {
            const sendRequest = {
              conversation: request.conversation,
              locale: resolveLocale(request.locale ?? projectLocale(snapshot)),
              payload,
            };
            if (execution) {
              const transported = await execution.send(sendRequest);
              if (transported.confirmedContent) {
                contentSources = transported.confirmedContent.map(snapshotHistorySource);
                // Explicit physical evidence must never fall back to the planned logical body.
                contentUnavailable = !contentSources.length || contentSources.some(source => source === undefined);
              }
              if (transported.contentUnavailable) { contentSources = undefined; contentUnavailable = true; }
              receipt = transported.result === undefined ? suppressedDeliveryReceipt()
                : receiptFromEndpointResult(transported.result, request.conversation, contentSources?.length ?? payloadLength);
            } else {
              const result = boundEndpoint ? await boundEndpoint.send(sendRequest)
                : await requireAdapters(snapshot).send(adapter, sendRequest);
              receipt = receiptFromEndpointResult(result, request.conversation, payloadLength);
            }
          } catch (error) {
            receipt = receiptFromEndpointError(error, true, request.conversation, payloadLength);
          }

          const evidence = projectPartEvidence(receipt, contentSources);
          receipt = evidence.receipt;
          if (receipt.status !== 'sent' && !receipt.failure?.deliveryUnknown && !receipt.parts?.length) revokeButtons?.();

          const recordedParts: DeliveryPart[] = [];
          let firstSequence: number | undefined;
          for (const part of evidence.parts) {
            const partReceipt: DeliveryReceipt = { status: 'sent', ...(part.part.message ? { message: part.part.message } : {}),
              ...(part.part.outboundTextDigest ? { outboundTextDigest: part.part.outboundTextDigest } : {}) };
            const history = execution?.history() ?? 'create';
            let partSequence: number | undefined;
            if (part.part.message && history !== 'skip') {
              try {
                const content = part.content ?? (contentUnavailable || receipt.parts ? 'unavailable' : undefined);
                const seq = history === 'create'
                  ? await this.context.record(request, partReceipt, content)
                  : await this.context.recordUpdate?.(request, partReceipt, history.revision, content);
                if (typeof seq === 'number') {
                  partSequence = seq;
                  firstSequence ??= seq;
                }
              } catch (error) {
                logger.warn(formatCompact({ op: 'outbound_history_failed', error: error instanceof Error ? error.message : String(error) }));
              }
            }
            const enrichedPart: DeliveryPart = partSequence !== undefined
              ? Object.freeze({ ...part.part, conversationSequence: partSequence })
              : part.part;
            recordedParts.push(enrichedPart);
            execution?.confirmed(enrichedPart, part.content);
            const enrichedPartReceipt: DeliveryReceipt = partSequence !== undefined
              ? { ...partReceipt, conversationSequence: partSequence }
              : partReceipt;
            try {
              this.context.ledger?.(request.conversation, enrichedPartReceipt,
                part.content ?? (contentUnavailable || receipt.parts ? undefined : payload));
            } catch (error) {
              logger.warn(`outbound ledger write failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (part.part.message && history !== 'skip') this.context.publish({
              direction: 'outbound',
              rendering: projection.rendering,
              conversation: request.conversation,
              requester: request.requester,
              contentPreview: part.content ? previewMessageContent(part.content)
                : contentUnavailable || receipt.parts ? '[Message content unavailable; inspect its reference.]' : previewMessageContent(payload),
              messageId: part.part.message.id,
              timestamp: Date.now(),
            });
          }
          if (firstSequence !== undefined || (receipt.parts && recordedParts.length > 0)) {
            receipt = Object.freeze({
              ...receipt,
              ...(receipt.parts ? { parts: Object.freeze(recordedParts) } : {}),
              ...(firstSequence !== undefined ? { conversationSequence: firstSequence } : {}),
            });
          }
        },
        'outbound',
      );
    } catch {
      return receipt ?? failedDeliveryReceipt('outbound_middleware_failed');
    }

    if (!terminalEntered) {
      logger.debug(formatCompact({
        op: 'replychain_runtime_send',
        status: 'suppressed',
        reason: 'middleware_stopped_before_terminal',
        conv: formatConversationLog(request.conversation),
      }));
      return suppressedDeliveryReceipt();
    }
    logger.debug(formatCompact({
      op: 'replychain_runtime_send',
      status: receipt?.status ?? 'missing',
      code: receipt?.failure?.code,
      conv: formatConversationLog(request.conversation),
    }));
    return receipt ?? failedDeliveryReceipt('outbound_delivery_incomplete');
  }
}

function isEmptyOutboundPayload(payload: unknown): boolean {
  if (payload === '') return true;
  return Array.isArray(payload) && payload.every(item => item?.type === 'text' && item.data?.text === '');
}

function needsAuthoringRender(value: unknown): boolean {
  const isAuthoring = (item: unknown) => isJsxElement(item) || isComponentCall(item) || isRawContent(item) || isUntrustedContent(item);
  return Array.isArray(value) ? flattenOutboundArray(value).some(isAuthoring) : isAuthoring(value);
}

export function failedDeliveryReceipt(code: string, retryable = false): DeliveryReceipt {
  return Object.freeze({
    status: 'failed' as const,
    failure: Object.freeze({
      code,
      message: 'Outbound delivery failed.',
      ...(retryable ? { retryable: true } : {}),
    }),
  });
}

function receiptFromEndpointResult(
  result: EndpointSendResult,
  conversation: ConversationRef,
  payloadLength: number | undefined,
): DeliveryReceipt {
  if (typeof result !== 'string') {
    const parts = normalizeEndpointParts(result?.parts, conversation, payloadLength);
    if (!parts.length) return unknownDeliveryReceipt('delivery_unconfirmed');
    const message = parts.find(part => part.message)?.message;
    if (!message) return Object.freeze({ ...unknownDeliveryReceipt('delivery_unconfirmed'), parts });
    return Object.freeze({ status: 'sent', ...(message ? { message } : {}), parts });
  }
  if (result.trim() === '') {
    return unknownDeliveryReceipt('delivery_unconfirmed');
  }
  return Object.freeze({
    status: 'sent' as const,
    message: Object.freeze({ conversation, id: result }),
  });
}

export function receiptFromEndpointError(error: unknown, attempted = true, conversation?: ConversationRef, payloadLength?: number): DeliveryReceipt {
  if (error instanceof EndpointDeliveryError) {
    const parts = attempted && conversation ? normalizeEndpointParts(error.parts, conversation, payloadLength) : [];
    // Disposition is transport evidence; an error code alone cannot override it.
    let receipt: DeliveryReceipt;
    if (error.disposition === 'unknown') receipt = unknownDeliveryReceipt(error.code);
    else if (error.disposition === 'rejected') receipt = rejectedDeliveryReceipt(error.code, 'Endpoint rejected outbound delivery.');
    else if (error.code === 'outbound_unsupported' || error.code === 'endpoint_not_found') receipt = unsupportedDeliveryReceipt('outbound_unsupported');
    else if (error.code === 'unsupported_operation') receipt = unsupportedDeliveryReceipt(error.code);
    else receipt = failedDeliveryReceipt(error.code);
    if (!parts.length) return receipt;
    const message = parts.find(part => part.message)?.message;
    return Object.freeze({ ...receipt, ...(message ? { message } : {}), parts,
      failure: Object.freeze({ ...receipt.failure!, retryable: false }) });
  }
  // imhelper ProtocolError exposes stable protocol facts without a Core SDK dependency.
  if (error && typeof error === 'object' && 'protocol' in error && 'kind' in error && 'response' in error
    && error.protocol === 'onebot-v11' && error.kind === 'protocol') {
    const response = error.response;
    if (response && typeof response === 'object' && 'status' in response && response.status === 'failed') {
      return rejectedDeliveryReceipt('platform_rejected', 'Endpoint rejected outbound delivery.');
    }
  }
  // Before the endpoint send boundary no message can have entered a transport.
  if (!attempted) return failedDeliveryReceipt('endpoint_send_failed');
  // Unknown SDK/network failures provide no evidence that replay is safe.
  return unknownDeliveryReceipt('endpoint_send_failed');
}

/** Unknown identities stay as slots; a bad mapping cannot erase a real platform id. */
function normalizeEndpointParts(parts: readonly EndpointSendPart[] | undefined, conversation: ConversationRef, payloadLength?: number): readonly DeliveryPart[] {
  if (!Array.isArray(parts)) return [];
  return Object.freeze(Array.from(parts, part => {
    const indices: unknown[] | undefined = Array.isArray(part?.sourceIndices) ? [...part.sourceIndices] : undefined;
    return Object.freeze({
      ...(typeof part?.messageId === 'string' && part.messageId.trim() !== ''
        ? { message: Object.freeze({ conversation, id: part.messageId }) } : {}),
      ...(indices && payloadLength !== undefined
        && indices.every((index): index is number => typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < payloadLength)
        ? { sourceIndices: Object.freeze(indices) } : {}),
    });
  }));
}

function snapshotHistorySource(segment: Segment): Segment | undefined {
  if (segment.type === 'markdown') {
    const data: Readonly<Record<string, unknown>> = segment.data;
    // The AI authoring contract has one closed Markdown shape. Core extensions remain opaque.
    if (Object.keys(segment).length !== 2 || !Object.hasOwn(segment, 'type') || !Object.hasOwn(segment, 'data')
      || Object.keys(data).length !== 1 || !Object.hasOwn(data, 'content') || typeof data.content !== 'string') return undefined;
    return { type: 'markdown', data: { content: data.content } };
  }
  // Forward entries and opaque card/extensions have no bounded, simple content contract here.
  if (!isStrictCanonicalSegment(segment) || segment.type === 'forward') return undefined;
  if (collectSegmentMedia([segment]).some(({ media }) => media.kind === 'base64' || media.value.startsWith('data:'))) return undefined;
  const values = [...Object.values(segment.data), ...Object.values(segment.platform ?? {})];
  if (values.some(value => ArrayBuffer.isView(value) || value instanceof ArrayBuffer)) return undefined;
  try { return structuredClone(segment); } catch { return undefined; }
}

function projectPartEvidence(receipt: DeliveryReceipt, sources: readonly (Segment | undefined)[] | undefined): {
  receipt: DeliveryReceipt;
  parts: readonly { part: DeliveryPart; content?: readonly Segment[] }[];
} {
  const parts = receipt.parts ?? (receipt.status === 'sent' ? [{ message: receipt.message,
    ...(sources ? { sourceIndices: sources.map((_, index) => index) } : {}) }] : []);
  const projected = parts.map(part => {
    const selected = part.sourceIndices?.length && sources ? part.sourceIndices.map(index => sources[index]) : undefined;
    const content = selected?.every((segment): segment is Segment => segment !== undefined) ? selected : undefined;
    const outboundTextDigest = content?.every((segment): segment is TextSegment => segment.type === 'text')
      ? createHash('sha256').update(content.map(segment => segment.data.text).join('')).digest('hex') : undefined;
    return { part: Object.freeze({ ...part, ...(outboundTextDigest ? { outboundTextDigest } : {}) }), ...(content ? { content } : {}) };
  });
  return {
    receipt: { ...receipt, ...(receipt.parts ? { parts: Object.freeze(projected.map(part => part.part)) } : {}),
      ...(receipt.status === 'sent' && projected.length === 1 && projected[0]?.part.outboundTextDigest
        ? { outboundTextDigest: projected[0].part.outboundTextDigest } : {}) },
    parts: projected,
  };
}

function unknownDeliveryReceipt(code: string): DeliveryReceipt {
  return Object.freeze({
    status: 'failed' as const,
    failure: Object.freeze({
      code,
      message: 'Message delivery is unconfirmed; resending may duplicate delivery.',
      retryable: false,
      deliveryUnknown: true as const,
    }),
  });
}

function suppressedDeliveryReceipt(): DeliveryReceipt {
  return Object.freeze({ status: 'suppressed' as const });
}

function unsupportedDeliveryReceipt(code: string): DeliveryReceipt {
  return Object.freeze({
    status: 'unsupported' as const,
    failure: Object.freeze({ code, message: 'Outbound delivery is not supported.' }),
  });
}

function rejectedDeliveryReceipt(code: string, message = 'Outbound payload was rejected.'): DeliveryReceipt {
  return Object.freeze({
    status: 'rejected' as const,
    failure: Object.freeze({ code, message }),
  });
}
