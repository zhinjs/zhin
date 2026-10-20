/**
 * WeCom webhook HTTP: URL verification (GET) + encrypted inbound (POST).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  decryptMessage,
  extractEncryptFromXml,
  normalizeEchostrParam,
  parseXmlMessage,
  queryParam,
  readTextBody,
  verifySignature,
  type ResolvedWecomConfig,
  type WecomMessage,
} from './protocol.js';

const logger = getLogger('wecom');

export interface WecomWebhookHandler {
  readonly config: ResolvedWecomConfig;
  readonly isOpen: boolean;
  admit(msg: WecomMessage): void;
}

export function registerWecomWebhookRoutes(
  http: HttpHost,
  handler: WecomWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
  return [
    http.route('GET', path, (request, response, url) => {
      handleWecomVerificationRequest(request, response, url, handler);
    }, { summary: 'WeCom URL verification', tags: ['wecom'] }),
    http.route('POST', path, async (request, response, url) => {
      await handleWecomWebhookRequest(request, response, url, handler);
    }, { summary: 'WeCom inbound webhook', tags: ['wecom'] }),
  ];
}

export function handleWecomVerificationRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  handler: WecomWebhookHandler,
): void {
  try {
    const msgSignature = queryParam(url.searchParams.get('msg_signature'));
    const timestamp = queryParam(url.searchParams.get('timestamp'));
    const nonce = queryParam(url.searchParams.get('nonce'));
    const echostr = normalizeEchostrParam(queryParam(url.searchParams.get('echostr')));
    const { token, encodingAESKey, corpId } = handler.config;

    if (!msgSignature || !timestamp || !nonce || !echostr) {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('Missing required query parameters');
      return;
    }

    if (!verifySignature(token, timestamp, nonce, echostr, msgSignature)) {
      logger.warn(formatCompact({ op: 'verify', ok: false, error: 'invalid signature' }));
      response.writeHead(403, { 'Content-Type': 'text/plain' });
      response.end('Forbidden');
      return;
    }

    const decrypted = decryptMessage(echostr, encodingAESKey, corpId);
    if (!decrypted) {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('Decryption failed');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(decrypted);
  } catch (error) {
    logger.error('URL verification error:', error);
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Internal Server Error');
  }
}

export async function handleWecomWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  handler: WecomWebhookHandler,
): Promise<void> {
  try {
    const msgSignature = queryParam(url.searchParams.get('msg_signature'));
    const timestamp = queryParam(url.searchParams.get('timestamp'));
    const nonce = queryParam(url.searchParams.get('nonce'));
    const { token, encodingAESKey, corpId } = handler.config;

    const rawBody = await readTextBody(request);
    const encrypted = extractEncryptFromXml(rawBody);
    if (!encrypted) {
      logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'no Encrypt field' }));
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('success');
      return;
    }

    if (!verifySignature(token, timestamp, nonce, encrypted, msgSignature)) {
      logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid signature' }));
      response.writeHead(403, { 'Content-Type': 'text/plain' });
      response.end('Forbidden');
      return;
    }

    const decryptedXml = decryptMessage(encrypted, encodingAESKey, corpId);
    if (!decryptedXml) {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('success');
      return;
    }

    const message = parseXmlMessage(decryptedXml);
    if (message && handler.isOpen) {
      handler.admit(message);
    }

    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('success');
  } catch (error) {
    logger.error('Webhook error:', error);
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('success');
  }
}
