/**
 * DingTalk webhook HTTP: signature → parse → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  headerValue,
  readTextBody,
  verifySignature,
  type DingTalkEvent,
  type ResolvedDingTalkConfig,
} from './protocol.js';

const logger = getLogger('dingtalk');

export interface DingTalkWebhookHandler {
  readonly config: ResolvedDingTalkConfig;
  readonly isOpen: boolean;
  admit(event: DingTalkEvent): void;
}

export function registerDingTalkWebhookRoutes(
  http: HttpHost,
  handler: DingTalkWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
  return [
    http.route('POST', path, async (request, response) => {
      await handleDingTalkWebhookRequest(request, response, handler);
    }, { summary: 'DingTalk robot webhook', tags: ['dingtalk'] }),
  ];
}

export async function handleDingTalkWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: DingTalkWebhookHandler,
): Promise<void> {
  try {
    // DingTalk outgoing callbacks put timestamp/sign on the URL query;
    // headers are accepted as a fallback for legacy senders.
    const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const timestamp = query.get('timestamp') || headerValue(request.headers, 'timestamp');
    const sign = query.get('sign') || headerValue(request.headers, 'sign');
    if (timestamp && sign) {
      if (!verifySignature(handler.config.appSecret, timestamp, sign)) {
        logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid signature' }));
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ code: -1, msg: 'Forbidden' }));
        return;
      }
    }

    const rawBody = await readTextBody(request);
    let event: DingTalkEvent;
    try {
      event = JSON.parse(rawBody) as DingTalkEvent;
    } catch {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ code: 0, msg: 'success' }));
      return;
    }

    if (event.msgtype && handler.isOpen) {
      handler.admit(event);
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 0, msg: 'success' }));
  } catch (error) {
    logger.error('Webhook error:', error);
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: -1, msg: 'Internal Server Error' }));
  }
}
