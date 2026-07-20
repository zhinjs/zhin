/**
 * KOOK webhook HTTP: verify → parse → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  isKookWebhookChallenge,
  normalizeKookWebhookEvent,
  parseKookWebhookBody,
  readRequestBody,
  verifyKookWebhookToken,
  type KookInboundMessage,
  type KookWebhookEventData,
  type KookWebhookFrame,
  type ResolvedKookWebhookConfig,
} from './protocol.js';

const logger = getLogger('kook');

export interface KookWebhookHandler {
  readonly config: ResolvedKookWebhookConfig;
  readonly isOpen: boolean;
  readonly selfId?: string;
  admit(msg: KookInboundMessage): void;
  checkAndRememberSn(sn: number): boolean;
}

export function registerKookWebhookRoutes(
  http: HttpHost,
  handler: KookWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
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
      frame = parseKookWebhookBody(rawBody, handler.config.encryptKey);
    } catch (error) {
      logger.warn(formatCompact({
        op: 'kook_webhook',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Invalid webhook payload' }));
      return;
    }

    const event = frame.d;
    if (!event || typeof event !== 'object') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'OK' }));
      return;
    }

    if (isKookWebhookChallenge(event)) {
      if (!verifyKookWebhookToken(handler.config.verifyToken, event.verify_token)) {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Invalid verify_token' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ challenge: event.challenge ?? '' }));
      return;
    }

    if (!verifyKookWebhookToken(handler.config.verifyToken, event.verify_token)) {
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Invalid verify_token' }));
      return;
    }

    if (frame.sn != null) {
      if (!handler.checkAndRememberSn(frame.sn)) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'OK' }));
        return;
      }
    }

    if (handler.isOpen) {
      handleKookWebhookEvent(event, handler);
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'OK' }));
  } catch (error) {
    logger.error('KOOK webhook error:', error);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'OK' }));
  }
}

function handleKookWebhookEvent(
  event: KookWebhookEventData,
  handler: KookWebhookHandler,
): void {
  const msg = normalizeKookWebhookEvent(event, {
    ignore: handler.config.ignore,
    selfId: handler.selfId,
  });
  if (msg) handler.admit(msg);
}
