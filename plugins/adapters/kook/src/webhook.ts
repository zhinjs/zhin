import { endpointSpec, type Endpoint } from 'zhin.js/adapter';
/**
 * KOOK webhook HTTP: verify → parse → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  isKookWebhookChallenge,
  parseKookWebhookBody,
  readRequestBody,
  verifyKookWebhookToken,
  type KookInboundMessage,
  type KookWebhookEventData,
  type KookWebhookFrame,
  type ResolvedKookWebhookConfig,
} from './protocol.js';

const logger = getLogger('kook');

export interface KookWebhookHandler extends Endpoint {
  readonly endpointConfig: ResolvedKookWebhookConfig;
  readonly isOpen: boolean;
  readonly selfId?: string;
  admit(msg: KookInboundMessage): void;
  admitEvent(event: KookWebhookEventData): Promise<void> | void;
  checkAndRememberSn(sn: number): boolean;
  forgetSn?(sn: number): void;
}

export function registerKookWebhookRoutes(
  http: HttpHost,
  handler: KookWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.endpointConfig.webhookPath;
  return [
    http.route('POST', path, async (request, response) => {
      await handleKookWebhookRequest(request, response, handler);
    }, { summary: 'KOOK webhook callback', tags: ['kook'] }),
  ];
}

export async function handleKookWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: KookWebhookHandler,
): Promise<void> {
  try {
    const rawBody = await readRequestBody(request);
    let frame: KookWebhookFrame;
    try {
      frame = parseKookWebhookBody(rawBody, handler.endpointConfig.encryptKey);
    } catch (error) {
      logger.warn(formatCompact({
        op: 'kook_webhook',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return new Response(JSON.stringify({ message: 'Invalid webhook payload' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const event = frame.d;
    if (!event || typeof event !== 'object') {
      return new Response(JSON.stringify({ message: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (isKookWebhookChallenge(event)) {
      if (!verifyKookWebhookToken(handler.endpointConfig.verifyToken, event.verify_token)) {
        return new Response(JSON.stringify({ message: 'Invalid verify_token' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ challenge: event.challenge ?? '' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (!verifyKookWebhookToken(handler.endpointConfig.verifyToken, event.verify_token)) {
      return new Response(JSON.stringify({ message: 'Invalid verify_token' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    if (!handler.isOpen) {
      return new Response(JSON.stringify({ message: 'Endpoint unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    await handler[endpointSpec].events.run(async () => {
      if (frame.sn != null) {
        if (!handler.checkAndRememberSn(frame.sn)) {
          return new Response(JSON.stringify({ message: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }

      try {
        await handler.admitEvent(event);
      } catch {
        if (frame.sn != null) handler.forgetSn?.(frame.sn);
        return new Response(JSON.stringify({ message: 'Admission unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ message: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  } catch (error) {
    logger.error('KOOK webhook error:', error);
    return new Response(JSON.stringify({ message: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}
