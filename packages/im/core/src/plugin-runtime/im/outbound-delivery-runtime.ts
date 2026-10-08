import {
  htmlRendererToken,
  type CapabilityId,
  type HtmlRendererHost,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { EndpointDeliveryError, type ConversationRef, type DeliveryReceipt } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createOutboundEnvelope, type OutboundEnvelope, type SendRequest } from './contracts.js';
import { OutboundRenderer } from './outbound-renderer.js';
import {
  applyOutboundInteractivePolicy,
  applyOutboundMarkdownPolicy,
  normalizeOutboundPayload,
  resolveOutboundInteractivePolicy,
  resolveOutboundMarkdownPolicy,
  resolveOutboundMediaPolicy,
  resolveOutboundSupportedSegments,
} from './outbound-segments.js';
import { assertCanonicalSegments } from '../../built/segment-contract/assert.js';
import { adapterTypeName, requireAdapters } from './endpoint-runtime.js';
import { formatConversationLog, previewMessageContent, type RuntimeMessageEvent } from './message-events.js';
import { runRuntimeMiddleware } from './runtime-middleware.js';

const logger = getLogger('im.outbound');

interface OutboundDeliveryContext {
  record(request: SendRequest, receipt: DeliveryReceipt): Promise<void>;
  rememberFallback(
    conversation: ConversationRef,
    generation: number,
    map: Record<string, string>,
  ): void;
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
    const adapter = request.conversation.endpoint.id as CapabilityId;
    let initialPayload: unknown;
    try {
      const rendered = await this.#renderer.render(
        request.content,
        request.requester,
        snapshot,
        request.conversation,
        request.incoming,
      );
      initialPayload = await prepareOutboundPayload(rendered, request.conversation, snapshot);
    } catch (error) {
      if (error instanceof EndpointDeliveryError && error.code === 'unsupported_operation' && error.disposition === 'not_sent') return receiptFromEndpointError(error, false);
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
    let terminalEntered = false;
    let receipt: DeliveryReceipt | undefined;

    try {
      await runRuntimeMiddleware<OutboundEnvelope>(
        snapshot,
        envelope,
        async () => {
          terminalEntered = true;
          let payload: unknown;
          try {
            payload = await prepareOutboundPayload(
              envelope.payload,
              request.conversation,
              snapshot,
              (map) => this.context.rememberFallback(
                request.conversation,
                snapshot.generation,
                map,
              ),
            );
          } catch (error) {
            receipt = error instanceof EndpointDeliveryError && error.code === 'unsupported_operation' && error.disposition === 'not_sent'
              ? receiptFromEndpointError(error, false) : rejectedDeliveryReceipt('outbound_payload_rejected');
            return;
          }

          try {
            const result = await requireAdapters(snapshot).send(adapter, {
              conversation: request.conversation,
              payload,
            });
            receipt = receiptFromEndpointResult(result, request.conversation);
          } catch (error) {
            receipt = receiptFromEndpointError(error);
          }

          if (receipt.status === 'sent') {
            await this.context.record(request, receipt);
            this.context.publish({
              direction: 'outbound',
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

async function prepareOutboundPayload(
  rendered: unknown,
  conversation: ConversationRef,
  snapshot: RuntimeSnapshot,
  rememberInteractiveFallback?: (map: Record<string, string>) => void,
): Promise<unknown> {
  const adapter = conversation.endpoint.id as CapabilityId;
  const directHtml = isDirectHtmlConsumer(snapshot, adapter);
  const markdownResolved = applyOutboundMarkdownPolicy(
    rendered,
    resolveOutboundMarkdownPolicy(adapter, snapshot),
  );
  let payload = directHtml
    ? markdownResolved
    : await normalizeOutboundPayload(markdownResolved, resolveHtmlRenderer(snapshot), {
      mediaPolicy: resolveOutboundMediaPolicy(adapter, snapshot),
    });
  if (rememberInteractiveFallback) {
    payload = applyOutboundInteractivePolicy(
      payload,
      resolveOutboundInteractivePolicy(adapter, snapshot),
      rememberInteractiveFallback,
    );
  }
  if (!directHtml && Array.isArray(payload)) assertCanonicalSegments(payload);
  const supported = resolveOutboundSupportedSegments(adapter, snapshot);
  const supportedPayload = rememberInteractiveFallback ? payload : applyOutboundInteractivePolicy(payload, resolveOutboundInteractivePolicy(adapter, snapshot));
  if (supported && Array.isArray(supportedPayload)) {
    const unsupported = supportedPayload.find(segment => segment && typeof segment === 'object' && typeof segment.type === 'string' && !supported.includes(segment.type));
    if (unsupported) throw new EndpointDeliveryError('unsupported_operation', `Adapter does not support canonical segment ${unsupported.type}`, 'not_sent');
  }
  return payload;
}

function resolveHtmlRenderer(snapshot: RuntimeSnapshot): HtmlRendererHost | undefined {
  const host = snapshot.resources.get(snapshot.root)?.get(htmlRendererToken.id);
  return host && typeof (host as HtmlRendererHost).render === 'function'
    ? host as HtmlRendererHost
    : undefined;
}

function isDirectHtmlConsumer(snapshot: RuntimeSnapshot, adapter: CapabilityId): boolean {
  const owner = snapshot.capabilities.get(adapter)?.owner;
  const packageName = owner ? snapshot.tree.get(owner)?.packageName : undefined;
  return adapterTypeName(packageName) === 'sandbox';
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
    if (error.code === 'outbound_unsupported' || error.code === 'endpoint_not_found') {
      return unsupportedDeliveryReceipt('outbound_unsupported');
    }
    if (error.code === 'unsupported_operation' && error.disposition === 'not_sent') {
      return unsupportedDeliveryReceipt(error.code);
    }
    if (error.disposition === 'unknown') return unknownDeliveryReceipt(error.code);
    return failedDeliveryReceipt(error.code);
  }
  // imhelper ProtocolError exposes stable protocol facts without a Core SDK dependency.
  if (error && typeof error === 'object' && 'protocol' in error && 'kind' in error && 'response' in error
    && error.protocol === 'onebot-v11' && error.kind === 'protocol') {
    const response = error.response;
    if (response && typeof response === 'object' && 'status' in response && response.status === 'failed') {
      return failedDeliveryReceipt('platform_rejected');
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

function rejectedDeliveryReceipt(code: string): DeliveryReceipt {
  return Object.freeze({
    status: 'rejected' as const,
    failure: Object.freeze({ code, message: 'Outbound payload was rejected.' }),
  });
}
