/**
 * Discord interactions HTTP: signature → parse → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  interactionToInboundMessage,
  verifyDiscordInteractionSignature,
  type DiscordInboundMessage,
  type ResolvedDiscordInteractionsConfig,
} from './protocol.js';

const logger = getLogger('discord');

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const INTERACTION_RESPONSE_PONG = 1;
const INTERACTION_RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE = 4;
/** EPHEHEMERAL — 仅发起者可见（对齐旧 endpoint-interactions 默认响应）。 */
const INTERACTION_FLAG_EPHEMERAL = 64;

export interface DiscordInteractionsHandler {
  readonly config: ResolvedDiscordInteractionsConfig;
  readonly isOpen: boolean;
  admit(msg: DiscordInboundMessage): void;
}

export function registerDiscordInteractionRoutes(
  http: HttpHost,
  handler: DiscordInteractionsHandler,
): HttpRouteRegistration[] {
  const path = handler.config.interactionsPath;
  return [
    http.route('POST', path, async (request, response) => {
      await handleDiscordInteractionRequest(request, response, handler);
    }, { summary: 'Discord interactions callback', tags: ['discord'] }),
  ];
}

export async function handleDiscordInteractionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: DiscordInteractionsHandler,
): Promise<void> {
  try {
    const signature = headerValue(request.headers['x-signature-ed25519']);
    const timestamp = headerValue(request.headers['x-signature-timestamp']);
    const rawBody = await readInteractionBody(request);
    if (!signature || !timestamp) {
      response.writeHead(401, { 'Content-Type': 'text/plain' });
      response.end('Unauthorized');
      return;
    }
    if (!verifyDiscordInteractionSignature(
      handler.config.publicKey,
      rawBody,
      signature,
      timestamp,
    )) {
      response.writeHead(401, { 'Content-Type': 'text/plain' });
      response.end('Unauthorized');
      return;
    }
    const interaction = JSON.parse(rawBody) as Record<string, unknown>;
    if (interaction.type === INTERACTION_TYPE_PING) {
      writeJson(response, 200, { type: INTERACTION_RESPONSE_PONG });
      return;
    }
    if (interaction.type === INTERACTION_TYPE_APPLICATION_COMMAND) {
      if (handler.isOpen) {
        handler.admit(interactionToInboundMessage(interaction));
      }
      // 即时响应（type 4）：defer(type 5) 需要 followup PATCH，未实现会让用户端一直转圈
      const commandName = String(
        (interaction.data as { name?: unknown } | undefined)?.name ?? '',
      );
      writeJson(response, 200, {
        type: INTERACTION_RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `处理命令: ${commandName}`,
          flags: INTERACTION_FLAG_EPHEMERAL,
        },
      });
      return;
    }
    response.writeHead(400, { 'Content-Type': 'text/plain' });
    response.end('Unsupported interaction type');
  } catch (error) {
    logger.error('Discord interactions error:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('Internal Server Error');
    }
  }
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

async function readInteractionBody(request: IncomingMessage): Promise<string> {
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

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
