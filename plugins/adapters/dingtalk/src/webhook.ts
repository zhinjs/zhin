/**
 * DingTalk webhook HTTP: signature → parse → hand off to the Runtime → 200.
 */
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { readTextBody } from '@zhin.js/host-http-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  headerValue,
  verifySignature,
  type DingTalkEvent,
  type ResolvedDingTalkConfig,
} from './protocol.js';

const logger = getLogger('dingtalk');

export interface DingTalkWebhookHandler {
  readonly config: ResolvedDingTalkConfig;
  readonly isOpen: boolean;
  admit(event: DingTalkEvent): void | Promise<void>;
}

export function registerDingTalkWebhookRoutes(
  http: HttpHost,
  handler: DingTalkWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
  return [
    http.route('POST', path, (request) => handleDingTalkWebhookRequest(request, handler), { summary: 'DingTalk robot webhook', tags: ['dingtalk'] }),
  ];
}

export async function handleDingTalkWebhookRequest(
  request: Request,
  handler: DingTalkWebhookHandler,
): Promise<Response> {
  try {
    // DingTalk outgoing callbacks put timestamp/sign on the URL query;
    // headers are accepted as a fallback for legacy senders.
    const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const timestamp = query.get('timestamp') || headerValue(request.headers, 'timestamp');
    const sign = query.get('sign') || headerValue(request.headers, 'sign');
    // Missing credentials must never be admitted: verify unconditionally.
    if (!timestamp || !sign || !verifySignature(handler.config.appSecret, timestamp, sign)) {
      logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid signature' }));
      return new Response(JSON.stringify({ code: -1, msg: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const rawBody = await readTextBody(request);
    let event: DingTalkEvent;
    try {
      event = JSON.parse(rawBody) as DingTalkEvent;
    } catch {
      return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (event.msgtype && handler.isOpen) {
      // Waits for the hand-off to the Runtime only, never for the Agent turn (#1250 b115).
      // A refused hand-off keeps the previous answer: logged, still 200.
      try { await handler.admit(event); } catch (error) {
        logger.warn(formatCompact({ op: 'dingtalk_gateway_receive_failed',
          error: error instanceof Error ? error.message : String(error) }));
      }
    }

    return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    logger.error('Webhook error:', error);
    return new Response(JSON.stringify({ code: -1, msg: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
