/**
 * LINE webhook HTTP: signature → parse → admit.
 */
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { readTextBody } from '@zhin.js/host-http-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  verifySignature,
  type LineEvent,
  type LineWebhookBody,
  type ResolvedLineConfig,
} from './protocol.js';

const logger = getLogger('line');

export interface LineWebhookHandler {
  readonly config: ResolvedLineConfig;
  readonly isOpen: boolean;
  admit(event: LineEvent): void;
  admitAccepted(event: LineEvent): Promise<void>;
}

export function registerLineWebhookRoutes(
  http: HttpHost,
  handler: LineWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
  return [
    http.route('POST', path, (request) => handleLineWebhookRequest(request, handler), { summary: 'LINE Messaging API webhook', tags: ['line'] }),
  ];
}

export async function handleLineWebhookRequest(
  request: Request,
  handler: LineWebhookHandler,
): Promise<Response> {
  try {
    const signatureValue = request.headers.get('x-line-signature');
    if (!signatureValue) {
      return new Response(JSON.stringify({ message: 'Missing signature' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const rawBody = await readTextBody(request);
    if (!verifySignature(handler.config.channelSecret, rawBody, signatureValue)) {
      logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid signature' }));
      return new Response(JSON.stringify({ message: 'Invalid signature' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody) as LineWebhookBody;
    } catch {
      return new Response(JSON.stringify({ message: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!body || !Array.isArray(body.events) || body.events.some(event => !event || typeof event.type !== 'string' || !event.source || !['user', 'group', 'room'].includes(event.source.type) || (event.type === 'message' && !('message' in event && event.message && typeof event.message.id === 'string')))) {
      return new Response(JSON.stringify({ message: 'Invalid events' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (body.events.length && !handler.isOpen) {
      return new Response(JSON.stringify({ message: 'Endpoint unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    for (const event of body.events) {
      await handler.admitAccepted(event);
    }

    return new Response(JSON.stringify({ message: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    logger.error('LINE webhook error:', error);
    return new Response(JSON.stringify({ message: 'Admission unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}
