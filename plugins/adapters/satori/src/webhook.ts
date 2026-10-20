/**
 * Satori webhook HTTP: token → opcode → parse → admit.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { getLogger } from '@zhin.js/logger';
import {
  SatoriOpcode,
  type ResolvedSatoriWebhookConfig,
} from './protocol.js';

const logger = getLogger('satori');

export interface SatoriWebhookHandler {
  readonly config: ResolvedSatoriWebhookConfig;
  readonly isOpen: boolean;
  acceptHttp(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

export function registerSatoriWebhookRoutes(
  http: HttpHost,
  handler: SatoriWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.path;
  return [
    http.route('POST', path, async (request, response) => {
      await handleSatoriWebhookRequest(request, response, handler);
    }, { summary: 'Satori webhook callback', tags: ['satori'] }),
  ];
}

export async function handleSatoriWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: SatoriWebhookHandler,
): Promise<void> {
  try {
    if (!verifySatoriToken(handler.config.token, request)) {
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Unauthorized' }));
      return;
    }
    const opcode = resolveSatoriOpcode(request);
    if (opcode !== SatoriOpcode.EVENT && opcode !== SatoriOpcode.META) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'OK' }));
      return;
    }
    if (handler.isOpen) {
      await handler.acceptHttp(request, response);
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
    }
  } catch (error) {
    logger.error('Satori webhook error:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Internal Server Error' }));
    }
  }
}

export function resolveSatoriOpcode(request: IncomingMessage): number | undefined {
  const raw = request.headers['satori-opcode'] ?? request.headers['Satori-Opcode'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function verifySatoriToken(token: string | undefined, request: IncomingMessage): boolean {
  if (!token) return true;
  const auth = request.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  const actual = Buffer.from(auth, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
