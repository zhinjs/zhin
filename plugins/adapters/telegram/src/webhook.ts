/**
 * Telegram webhook HTTP: secret token → parse → handle update.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { getLogger } from '@zhin.js/logger';
import { readTextBody, type ResolvedTelegramConfig, type TelegramUpdate } from './protocol.js';

const logger = getLogger('telegram');

export interface TelegramWebhookHandler {
  readonly config: ResolvedTelegramConfig;
  readonly isOpen: boolean;
  handleUpdate(update: TelegramUpdate): void;
}

export function registerTelegramWebhookRoutes(
  http: HttpHost,
  handler: TelegramWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhook!.path;
  return [
    http.route('POST', path, async (request, response) => {
      await handleTelegramWebhookRequest(request, response, handler);
    }, { summary: 'Telegram Bot API webhook', tags: ['telegram'] }),
  ];
}

export async function handleTelegramWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: TelegramWebhookHandler,
): Promise<void> {
  try {
    const secret = handler.config.webhook?.secretToken;
    if (secret) {
      const header = request.headers['x-telegram-bot-api-secret-token'];
      const token = Array.isArray(header) ? header[0] : header;
      if (token !== secret) {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false, description: 'Invalid secret token' }));
        return;
      }
    }

    const rawBody = await readTextBody(request);
    let update: TelegramUpdate;
    try {
      update = JSON.parse(rawBody) as TelegramUpdate;
    } catch {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (handler.isOpen) {
      handler.handleUpdate(update);
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  } catch (error) {
    logger.error('Telegram webhook error:', error);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  }
}
