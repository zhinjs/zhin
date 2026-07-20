/**
 * LINE webhook HTTP: signature → parse → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  readTextBody,
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
}

export function registerLineWebhookRoutes(
  http: HttpHost,
  handler: LineWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
  return [
    http.route('POST', path, async (request, response) => {
      await handleLineWebhookRequest(request, response, handler);
    }, { summary: 'LINE Messaging API webhook', tags: ['line'] }),
  ];
}

export async function handleLineWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: LineWebhookHandler,
): Promise<void> {
  try {
    const signature = request.headers['x-line-signature'];
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;
    if (!signatureValue) {
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Missing signature' }));
      return;
    }

    const rawBody = await readTextBody(request);
    if (!verifySignature(handler.config.channelSecret, rawBody, signatureValue)) {
      logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid signature' }));
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Invalid signature' }));
      return;
    }

    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody) as LineWebhookBody;
    } catch {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'OK' }));
      return;
    }

    if (handler.isOpen && Array.isArray(body.events)) {
      for (const event of body.events) {
        handler.admit(event);
      }
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'OK' }));
  } catch (error) {
    logger.error('LINE webhook error:', error);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'OK' }));
  }
}
