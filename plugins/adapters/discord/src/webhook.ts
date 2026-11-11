import { endpointSpec, type Endpoint } from 'zhin.js/adapter';
/**
 * Discord interactions HTTP: signature → parse → admit.
 */
import { createMessages } from 'zhin.js/i18n';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  interactionToInboundMessage,
  verifyDiscordInteractionSignature,
  type DiscordInboundMessage,
  type DiscordButtonInbound,
  type ResolvedDiscordInteractionsConfig,
} from './protocol.js';

const logger = getLogger('discord');
const messages = createMessages({
  processing: { 'zh-CN': '处理命令: {command}', en: 'Processing command: {command}' },
});

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const INTERACTION_RESPONSE_PONG = 1;
const INTERACTION_RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE = 4;
/** EPHEHEMERAL — 仅发起者可见（对齐旧 endpoint-interactions 默认响应）。 */
const INTERACTION_FLAG_EPHEMERAL = 64;

export interface DiscordInteractionsHandler extends Endpoint {
  readonly config: ResolvedDiscordInteractionsConfig;
  readonly isOpen: boolean;
  admit(msg: DiscordInboundMessage): void;
  admitButton(interaction: DiscordButtonInbound): void;
  admitPlatform(event: Record<string, unknown>): void;
}

export function registerDiscordInteractionRoutes(
  http: HttpHost,
  handler: DiscordInteractionsHandler,
): HttpRouteRegistration[] {
  const path = handler.config.interactionsPath;
  return [
    http.route('POST', path, (request) => handleDiscordInteractionRequest(request, handler), { summary: 'Discord interactions callback', tags: ['discord'] }),
  ];
}

export async function handleDiscordInteractionRequest(
  request: Request,
  handler: DiscordInteractionsHandler,
): Promise<Response> {
  try {
    const signature = headerValue(request.headers['x-signature-ed25519']);
    const timestamp = headerValue(request.headers['x-signature-timestamp']);
    const rawBody = await readInteractionBody(request);
    if (!signature || !timestamp) {
      return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain' } });
    }
    if (!verifyDiscordInteractionSignature(
      handler.config.publicKey,
      rawBody,
      signature,
      timestamp,
    )) {
      return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain' } });
    }
    const interaction = JSON.parse(rawBody) as Record<string, unknown>;
    if (!interaction || interaction.application_id !== handler.config.applicationId) {
      return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain' } });
    }
    // A verified protocol challenge is not a business message and keeps its immediate ACK.
    if (interaction.type === INTERACTION_TYPE_PING) {
      if (handler.isOpen) void handler[endpointSpec].events.run(() => handler.admitPlatform(interaction))
        .catch(() => logger.debug('Protocol event dispatch did not complete'));
      writeJson(response, 200, { type: INTERACTION_RESPONSE_PONG });
      return;
    }
    await handler[endpointSpec].events.run(async () => {
      if (handler.isOpen) handler.admitPlatform(interaction);
      if (interaction.type === 3) {
        const data = interaction.data as { component_type?: number; custom_id?: string } | undefined;
        if (data?.component_type === 2 && typeof data.custom_id === 'string') {
          if (!handler.isOpen) { return new Response('Unavailable', { status: 503 }); }
          const message = interactionToInboundMessage(interaction);
          handler.admitButton({ event: interaction, id: message.id, customId: data.custom_id, channelId: message.channelId, channelKind: message.channelKind, userId: message.authorId, userName: message.authorName, ...(message.guildId ? { guildId: message.guildId } : {}), sourceMessageId: (interaction.message as { id?: string } | undefined)?.id });
          writeJson(response, 200, { type: 6 });
          return;
        }
      }
      if (interaction.type === INTERACTION_TYPE_APPLICATION_COMMAND) {
        const message = interactionToInboundMessage(interaction);
        if (handler.isOpen) {
          handler.admit(message);
        }
        const locale = await handler[endpointSpec].resolveLocale(message.authorId);
        // 即时响应（type 4）：defer(type 5) 需要 followup PATCH，未实现会让用户端一直转圈
        const commandName = String(
          (interaction.data as { name?: unknown } | undefined)?.name ?? '',
        );
        writeJson(response, 200, {
          type: INTERACTION_RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: messages(locale, 'processing', { command: commandName }),
            flags: INTERACTION_FLAG_EPHEMERAL,
          },
        });
        return;
      }
      return new Response('Unsupported interaction type', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    });
  } catch (error) {
    logger.error('Discord interactions error:', error);
    return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
  }
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

async function readInteractionBody(request: Request): Promise<string> {
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

function writeJson( status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
}
