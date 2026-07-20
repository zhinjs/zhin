/**
 * Slack webhook HTTP: signature → parse → admit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  headerValue,
  readTextBody,
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
      response.writeHead(401, { 'Content-Type': 'text/plain' });
      response.end('Invalid signature');
      return;
    }

    const contentType = headerValue(request.headers, 'content-type');
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody);
      const payloadStr = params.get('payload');
      if (payloadStr) {
        response.writeHead(200);
        response.end('');
        handler.admitInteraction(JSON.parse(payloadStr) as SlackInteractionPayload);
        return;
      }
      const body = Object.fromEntries(params) as unknown as SlackSlashCommand;
      if (body.command) {
        response.writeHead(200);
        response.end('');
        handler.admitSlashCommand(body);
        return;
      }
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      response.writeHead(200);
      response.end('');
      return;
    }

    if (envelope.type === 'url_verification') {
      const challenge = (envelope as unknown as SlackUrlVerification).challenge;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ challenge }));
      return;
    }

    if (envelope.type === 'event_callback' && envelope.event) {
      response.writeHead(200);
      response.end('');
      handler.handleEnvelope(envelope);
      return;
    }

    response.writeHead(200);
    response.end('');
  } catch (error) {
    logger.error('Slack webhook error:', error);
    response.writeHead(200);
    response.end('');
  }
}
