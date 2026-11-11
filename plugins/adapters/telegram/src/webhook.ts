/**
 * Telegram webhook HTTP: secret token → parse → handle update.
 */
import { timingSafeEqual } from 'node:crypto';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { readTextBody } from '@zhin.js/host-http-contract';
import { getLogger } from '@zhin.js/logger';
import { type ResolvedTelegramConfig, type TelegramUpdate } from './protocol.js';

const logger = getLogger('telegram');

/** 等长时才 timingSafeEqual，避免长度差异直接抛异常。 */
export function safeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export interface TelegramWebhookHandler {
  readonly config: ResolvedTelegramConfig;
  readonly isOpen: boolean;
  handleUpdate(update: TelegramUpdate): void | Promise<void>;
}

export function registerTelegramWebhookRoutes(
  http: HttpHost,
  handler: TelegramWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhook!.path;
  return [
    http.route('POST', path, (request) => handleTelegramWebhookRequest(request, handler), { summary: 'Telegram Bot API webhook', tags: ['telegram'] }),
  ];
}

export async function handleTelegramWebhookRequest(
  request: Request,
  handler: TelegramWebhookHandler,
): Promise<Response> {
  try {
    const secret = handler.config.webhook?.secretToken;
    if (secret) {
      const token = request.headers.get('x-telegram-bot-api-secret-token');
      if (!token || !safeTokenEqual(token, secret)) {
        return new Response(JSON.stringify({ ok: false, description: 'Invalid secret token' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    }

    const rawBody = await readTextBody(request);
    let update: TelegramUpdate;
    try {
      update = JSON.parse(rawBody) as TelegramUpdate;
    } catch {
      return new Response(JSON.stringify({ ok: false, description: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
      return new Response(JSON.stringify({ ok: false, description: 'Invalid update_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!handler.isOpen) throw new Error('Telegram endpoint is not accepting updates');
    await handler.handleUpdate(update);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    logger.error('Telegram webhook error:', error);
    return new Response(JSON.stringify({ ok: false, description: 'Update was not admitted' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}
