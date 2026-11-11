/**
 * Slack webhook HTTP: signature → parse → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { readTextBody } from '@zhin.js/host-http-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  headerValue,
  verifySlackSignature,
  type ResolvedSlackConfig,
  type SlackInteractionPayload,
  type SlackSlashCommand,
  type SlackUrlVerification,
} from './protocol.js';

const logger = getLogger('slack');

export interface SlackWebhookHandler {
  readonly config: ResolvedSlackConfig;
  handleEnvelope(body: unknown): void;
  admitInteraction(payload: SlackInteractionPayload): void;
  admitSlashCommand(cmd: SlackSlashCommand): void;
}

export function registerSlackWebhookRoutes(
  http: HttpHost,
  handler: SlackWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.webhookPath;
  return [
    http.route('POST', path, async (request, response) => {
      await handleSlackWebhookRequest(request, response, handler);
    }, { summary: 'Slack Events API / Interactivity', tags: ['slack'] }),
  ];
}

export async function handleSlackWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: SlackWebhookHandler,
): Promise<void> {
  try {
    const rawBody = await readTextBody(request);
    const timestamp = headerValue(request.headers, 'x-slack-request-timestamp');
    const signature = headerValue(request.headers, 'x-slack-signature');

    if (!verifySlackSignature(handler.config.signingSecret, rawBody, timestamp, signature)) {
      return new Response('Invalid signature', { status: 401, headers: { 'Content-Type': 'text/plain' } });
    }

    const contentType = headerValue(request.headers, 'content-type');
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody);
      const payloadStr = params.get('payload');
      if (payloadStr) {
        const payload = JSON.parse(payloadStr) as SlackInteractionPayload;
        return new Response('', { status: 200 });
        handler.admitInteraction(payload);
        return;
      }
      const body = Object.fromEntries(params) as unknown as SlackSlashCommand;
      if (body.command) {
        return new Response('', { status: 200 });
        handler.admitSlashCommand(body);
        return;
      }
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return new Response('', { status: 200 });
    }

    if (envelope.type === 'url_verification') {
      const challenge = (envelope as unknown as SlackUrlVerification).challenge;
      return new Response(JSON.stringify({ challenge }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (envelope.type === 'event_callback' && envelope.event) {
      return new Response('', { status: 200 });
      handler.handleEnvelope(envelope);
      return;
    }

    return new Response('', { status: 200 });
  } catch (error) {
    logger.error('Slack webhook error:', error);
    if (!response.headersSent) {
      return new Response('', { status: 200 });
    }
  }
}
