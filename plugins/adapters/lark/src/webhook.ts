/**
 * Lark/Feishu webhook HTTP: verification → signature → challenge/event → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  headerValue,
  readTextBody,
  verifySignature,
  type LarkEventBody,
  type LarkMessage,
  type ResolvedLarkConfig,
} from './protocol.js';

const logger = getLogger('lark');

export interface LarkWebhookHandler {
  readonly config: ResolvedLarkConfig;
  readonly isOpen: boolean;
  admit(msg: LarkMessage): void;
}

export function registerLarkWebhookRoutes(
  http: HttpHost,
  handler: LarkWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
  return [
    http.route('POST', path, async (request, response) => {
      await handleLarkWebhookRequest(request, response, handler);
    }, { summary: 'Lark/Feishu event webhook', tags: ['lark'] }),
  ];
}

export async function handleLarkWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: LarkWebhookHandler,
): Promise<void> {
  try {
    const rawBody = await readTextBody(request);

    if (handler.config.verificationToken) {
      const token = headerValue(request.headers, 'x-lark-request-token');
      if (token !== handler.config.verificationToken) {
        logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid verification token' }));
        response.writeHead(403, { 'Content-Type': 'text/plain' });
        response.end('Forbidden');
        return;
      }
    }

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
        response.writeHead(403, { 'Content-Type': 'text/plain' });
        response.end('Forbidden');
        return;
      }
    }

    let event: LarkEventBody;
    try {
      event = JSON.parse(rawBody) as LarkEventBody;
    } catch {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ code: 0, msg: 'success' }));
      return;
    }

    if (event.type === 'url_verification') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ challenge: event.challenge }));
      return;
    }

    if (event.type === 'event_callback' && event.event?.message && handler.isOpen) {
      const message: LarkMessage = {
        ...event.event.message,
        sender: event.event.message.sender ?? event.event.sender,
      };
      handler.admit(message);
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 0, msg: 'success' }));
  } catch (error) {
    logger.error('Webhook error:', error);
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: -1, msg: 'Internal Server Error' }));
  }
}
