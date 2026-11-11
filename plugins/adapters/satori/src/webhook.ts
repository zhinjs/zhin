/**
 * Satori webhook HTTP: token → opcode → parse → admit.
 */
import { timingSafeEqual } from 'node:crypto';
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
  acceptHttp(request: Request): Promise<Response>;
}

export function registerSatoriWebhookRoutes(
  http: HttpHost,
  handler: SatoriWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.path;
  return [
    http.route('POST', path, (request) => handleSatoriWebhookRequest(request, handler), { summary: 'Satori webhook callback', tags: ['satori'] }),
  ];
}

export async function handleSatoriWebhookRequest(
  request: Request,
  handler: SatoriWebhookHandler,
): Promise<Response> {
  try {
    if (!verifySatoriToken(handler.config.token, request)) {
      return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const opcode = resolveSatoriOpcode(request);
    if (opcode !== SatoriOpcode.EVENT && opcode !== SatoriOpcode.META) {
      return new Response(JSON.stringify({ message: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (handler.isOpen) return await handler.acceptHttp(request);
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    logger.error('Satori webhook error:', error);
    return new Response(JSON.stringify({ message: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export function resolveSatoriOpcode(request: { readonly headers: Headers }): number | undefined {
  const value = request.headers.get('satori-opcode');
  if (value == null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function verifySatoriToken(token: string | undefined, request: { readonly headers: Headers }): boolean {
  if (!token) return true;
  const auth = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  const actual = Buffer.from(auth, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
