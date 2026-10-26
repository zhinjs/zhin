import { resolveLocale } from '@zhin.js/plugin-runtime';
import { projectLocale } from './locale.js';
import {
  type CapabilityId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { EndpointDeliveryError, type ConversationRef, type DeliveryReceipt } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { isJsxElement, type JSXElement } from '@zhin.js/jsx';
import { createOutboundEnvelope, isComponentCall, isRawContent, type OutboundEnvelope, type SendContent, type SendRequest } from './contracts.js';
import { OutboundRenderer } from './outbound-renderer.js';
import { projectOutboundPayload, type OutboundProjection } from './outbound-projection.js';
import { flattenOutboundArray } from '../../built/outbound-content-arrays.js';
import { requireAdapters } from './endpoint-runtime.js';
import { formatConversationLog, previewMessageContent, type RuntimeMessageEvent, type RuntimeMessageRendering } from './message-events.js';
import { runRuntimeMiddleware } from './runtime-middleware.js';
import { collectButtonPayloads, type JsxButtonBatch } from './jsx-button-registry.js';
import type { RuntimeMessageDiagnostics } from './message-diagnostics.js';
import { resolveOutboundPresentation } from './outbound-presentation.js';

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
  record(request: SendRequest, receipt: DeliveryReceipt): Promise<void>;
  /** Side-channel correlation ledger for inbound origin; failures never affect the receipt. */
  ledger?(conversation: ConversationRef, receipt: DeliveryReceipt, payload: unknown): void;
  rememberFallback(
    conversation: ConversationRef,
    generation: number,
    map: Record<string, string>,
  ): Record<string, string> | void;
  publish(event: RuntimeMessageEvent): void;
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

  async deliver(request: SendRequest, snapshot: RuntimeSnapshot): Promise<DeliveryReceipt> {
    let rendering: RuntimeMessageRendering | undefined;
    const receipt = await this.#deliver(request, snapshot, value => { rendering = value; });
    this.context.diagnostics?.delivery(snapshot.generation, request.conversation, receipt, rendering);
    return receipt;
  }

  async #deliver(
    request: SendRequest,
    snapshot: RuntimeSnapshot,
    observeRendering: (rendering: RuntimeMessageRendering) => void,
  ): Promise<DeliveryReceipt> {
    const adapter = request.conversation.endpoint.id as CapabilityId;
    const presentation = resolveOutboundPresentation(snapshot, request.conversation, request.requester);
    const jsxCache = new WeakMap<JSXElement, Promise<unknown>>();
    const buttons = this.context.prepareButtons?.(request, snapshot);
    const renderOptions = { jsxCache, bindButton: buttons?.bind };
    let initialPayload: unknown;
    let initialProjection: OutboundProjection;
    try {
      const rendered = await this.#renderer.render(
        request.content,
        request.requester,
        snapshot,
        request.conversation,
        request.incoming,
        renderOptions,
      );
      initialProjection = await projectOutboundPayload(rendered, request.conversation, snapshot, { deferInteractive: true, presentation });
      initialPayload = initialProjection.payload;
    } catch (error) {
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
    }, initialPayload, () => adapters.clientById(adapter));
    // Record identities and fallback text before middleware can mutate the array
    // or its segments. Do not copy/serialize media buffers or streams.
    const initialItems = Array.isArray(initialPayload) ? initialPayload.map(item => ({
      item, type: item?.type, text: item?.type === 'text' ? item.data?.text : undefined,
    })) : undefined;
    const retainsInitialProjection = (value: unknown): boolean => value === initialPayload
      && (!initialItems || (Array.isArray(value) && value.length === initialItems.length
        && initialItems.every(({ item, type, text }, index) => value[index] === item
          && item?.type === type && (type !== 'text' || item.data?.text === text))));
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
            // Native payload replacements remain possible; only authoring values need evaluation.
            const replacement = envelope.payload;
            const replaced = replacement !== initialPayload && needsAuthoringRender(replacement)
              ? await this.#renderer.render(replacement as SendContent, request.requester, snapshot, request.conversation, request.incoming, renderOptions)
              : replacement;
            projection = await projectOutboundPayload(replaced, request.conversation, snapshot, {
              presentation,
              inheritedFallbacks: retainsInitialProjection(replacement) ? initialProjection.rendering.fallbacks : [],
              rememberFallback: (map) => {
                for (const value of Object.values(map)) buttonPayloads.add(value);
                return this.context.rememberFallback(request.conversation, snapshot.generation, map);
              },
            });
            payload = projection.payload;
            observeRendering(projection.rendering);
            for (const value of collectButtonPayloads(payload)) buttonPayloads.add(value);
          } catch (error) {
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
          try {
            const result = await requireAdapters(snapshot).send(adapter, {
              conversation: request.conversation,
              locale: resolveLocale(request.locale ?? projectLocale(snapshot)),
              payload,
            });
            receipt = receiptFromEndpointResult(result, request.conversation);
          } catch (error) {
            receipt = receiptFromEndpointError(error);
          }

          if (receipt.status !== 'sent' && !receipt.failure?.deliveryUnknown) revokeButtons?.();

          if (receipt.status === 'sent') {
            await this.context.record(request, receipt);
            try {
              this.context.ledger?.(request.conversation, receipt, payload);
            } catch (error) {
              logger.warn(`outbound ledger write failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            this.context.publish({
              direction: 'outbound',
              rendering: projection.rendering,
              conversation: request.conversation,
              requester: request.requester,
              contentPreview: previewMessageContent(payload),
              ...(receipt.message?.id ? { messageId: receipt.message.id } : {}),
              timestamp: Date.now(),
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
  const isAuthoring = (item: unknown) => isJsxElement(item) || isComponentCall(item) || isRawContent(item);
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
  messageId: string,
  conversation: ConversationRef,
): DeliveryReceipt {
  if (typeof messageId !== 'string' || messageId.trim() === '') {
    return unknownDeliveryReceipt('delivery_unconfirmed');
  }
  return Object.freeze({
    status: 'sent' as const,
    message: Object.freeze({ conversation, id: messageId }),
  });
}

function receiptFromEndpointError(error: unknown, attempted = true): DeliveryReceipt {
  if (error instanceof EndpointDeliveryError) {
    // Disposition is transport evidence; an error code alone cannot override it.
    if (error.disposition === 'unknown') return unknownDeliveryReceipt(error.code);
    if (error.disposition === 'rejected') return rejectedDeliveryReceipt(error.code, 'Endpoint rejected outbound delivery.');
    if (error.code === 'outbound_unsupported' || error.code === 'endpoint_not_found') {
      return unsupportedDeliveryReceipt('outbound_unsupported');
    }
    if (error.code === 'unsupported_operation' && error.disposition === 'not_sent') {
      return unsupportedDeliveryReceipt(error.code);
    }
    return failedDeliveryReceipt(error.code);
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
