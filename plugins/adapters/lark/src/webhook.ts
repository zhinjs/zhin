/**
 * Lark/Feishu webhook HTTP: signature → decrypt → verification token → challenge/event → admit.
 */
import type { LarkCardAction } from './cards.js';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { readTextBody } from '@zhin.js/host-http-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  decryptLarkEvent,
  headerValue,
  verifySignature,
  verifyToken,
  type LarkEventBody,
  type LarkMessage,
  type ResolvedLarkConfig,
} from './protocol.js';

const logger = getLogger('lark');

export interface LarkWebhookHandler {
  readonly config: ResolvedLarkConfig;
  readonly isOpen: boolean;
  admitPlatform(name: string, event: unknown): void;
  admit(msg: LarkMessage, nativeEvent?: unknown): void;
  admitCardAction?(event: LarkCardAction): void;
}

export function registerLarkWebhookRoutes(
  http: HttpHost,
  handler: LarkWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
  return [
    http.route('POST', path, (request) => handleLarkWebhookRequest(request, handler), { summary: 'Lark/Feishu event webhook', tags: ['lark'] }),
  ];
}

export async function handleLarkWebhookRequest(
  request: Request,
  handler: LarkWebhookHandler,
): Promise<Response> {
  try {
    const rawBody = await readTextBody(request);

    let event: LarkEventBody;
    try {
      event = JSON.parse(rawBody) as LarkEventBody;
    } catch {
      return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Signature first: it covers the raw (possibly encrypted) body.
    if (handler.config.encryptKey) {
      const timestamp = headerValue(request.headers, 'x-lark-request-timestamp');
      const nonce = headerValue(request.headers, 'x-lark-request-nonce');
      const signature = headerValue(request.headers, 'x-lark-signature');
      if (
        !timestamp
        || !nonce
        || !signature
        || !verifySignature(handler.config.encryptKey, timestamp, nonce, rawBody, signature)
      ) {
        logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid signature' }));
        return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }
    }

    if (typeof event?.encrypt === 'string') {
      if (!handler.config.encryptKey) {
        logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'encrypted event received but encryptKey is not configured' }));
        return new Response(JSON.stringify({ code: -1, msg: 'Encrypt key is not configured' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      try {
        event = JSON.parse(decryptLarkEvent(handler.config.encryptKey, event.encrypt)) as LarkEventBody;
      } catch {
        logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'event decryption failed' }));
        return new Response(JSON.stringify({ code: -1, msg: 'Decryption failed' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (!event || typeof event !== 'object') {
      return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Token and challenge live inside the decrypted event.
    if (handler.config.verificationToken) {
      const bodyToken = (event as LarkEventBody & { header?: { token?: unknown } }).header?.token ?? event.token;
      const token = typeof bodyToken === 'string' ? bodyToken : headerValue(request.headers, 'x-lark-request-token');
      if (!verifyToken(token, handler.config.verificationToken)) {
        logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid verification token' }));
        return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }
    }

    if (handler.isOpen) {
      const eventName = event.type === 'event_callback'
        ? String(event.event?.type ?? event.type)
        : String(event.type ?? 'event');
      handler.admitPlatform(eventName, event);
    }

    if (event.type === 'url_verification') {
      return new Response(JSON.stringify({ challenge: event.challenge }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const headerEventType = (event as LarkEventBody & { header?: { event_type?: string } }).header?.event_type;
    if (headerEventType === 'card.action.trigger' && handler.isOpen) handler.admitCardAction?.(event.event as LarkCardAction);

    if ((event.type === 'event_callback' || headerEventType === 'im.message.receive_v1') && event.event?.message && handler.isOpen) {
      const message: LarkMessage = {
        ...event.event.message,
        sender: event.event.message.sender ?? event.event.sender,
      };
      handler.admit(message, event);
    }

    return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    logger.error('Webhook error:', error);
    return new Response(JSON.stringify({ code: -1, msg: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
