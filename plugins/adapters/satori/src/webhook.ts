/**
 * Satori webhook HTTP: token → opcode → parse → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { getLogger } from '@zhin.js/logger';
import {
  SatoriOpcode,
  type ResolvedSatoriWebhookConfig,
  type SatoriEventBody,
  type SatoriLogin,
} from './protocol.js';

const logger = getLogger('satori');

export interface SatoriWebhookHandler {
  readonly config: ResolvedSatoriWebhookConfig;
  readonly isOpen: boolean;
  admit(body: SatoriEventBody): void;
  setLogin(login: SatoriLogin): void;
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
    const raw = await readRequestBody(request);
    let body: SatoriEventBody;
    try {
      body = JSON.parse(raw) as SatoriEventBody;
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Invalid JSON' }));
      return;
    }
    if (opcode === SatoriOpcode.EVENT && handler.isOpen) {
      handler.admit(body);
    } else if (opcode === SatoriOpcode.META && body.login && handler.isOpen) {
      handler.setLogin(body.login);
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'OK' }));
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
  return auth === `Bearer ${token}`;
}

export async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) {
      request.destroy();
      throw new Error('Request body exceeds 1MB');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
