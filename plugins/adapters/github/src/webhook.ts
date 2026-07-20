/**
 * GitHub webhook HTTP: verify → parse → admit inbound comments.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  headerValue,
  parseIssueCommentInbound,
  parsePrReviewCommentInbound,
  parsePrReviewInbound,
  readTextBody,
  verifyWebhookSignature,
  type GithubInboundComment,
  type IssueCommentPayload,
  type PRReviewCommentPayload,
  type PRReviewPayload,
  type ResolvedGithubConfig,
} from './protocol.js';

const logger = getLogger('github');

export interface GithubWebhookHandler {
  readonly config: ResolvedGithubConfig;
  admit(comment: GithubInboundComment): void;
}

export function registerGithubWebhookRoutes(
  http: HttpHost,
  handler: GithubWebhookHandler,
): HttpRouteRegistration[] {
  const routePath = handler.config.webhookPath;
  return [
    http.route('POST', routePath, async (request, response) => {
      await handleGithubWebhookRequest(request, response, handler);
    }, { summary: 'GitHub webhook', tags: ['github'] }),
  ];
}

export async function handleGithubWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: GithubWebhookHandler,
): Promise<void> {
  const secret = handler.config.webhookSecret;
  if (!secret) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Webhook not configured' }));
    return;
  }

  const signature = headerValue(request.headers, 'x-hub-signature-256');
  const event = headerValue(request.headers, 'x-github-event');
  const deliveryId = headerValue(request.headers, 'x-github-delivery');

  if (!signature || !event) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Missing signature or event header' }));
    return;
  }

  try {
    const rawBody = await readTextBody(request);
    if (!verifyWebhookSignature(secret, rawBody, signature)) {
      logger.warn(formatCompact({
        op: 'webhook',
        ok: false,
        error: 'invalid signature',
        delivery: deliveryId,
      }));
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Invalid signature' }));
      return;
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));

    void dispatchGithubWebhookPayload(event, payload, handler).catch((e) => {
      logger.error(`Webhook 事件处理失败 (${event}):`, e);
    });
  } catch (error) {
    logger.error('Webhook error:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
}

export async function dispatchGithubWebhookPayload(
  event: string,
  payload: unknown,
  handler: GithubWebhookHandler,
): Promise<void> {
  if (!payload || typeof payload !== 'object') return;
  const body = payload as Record<string, unknown>;
  const repo = (body.repository as { full_name?: string } | undefined)?.full_name;
  logger.debug(`Webhook: ${event}${(body.action as string) ? `.${body.action}` : ''} ${repo || ''}`);

  if (event === 'issue_comment') {
    const inbound = parseIssueCommentInbound(payload as IssueCommentPayload);
    if (inbound) handler.admit(inbound);
    return;
  }
  if (event === 'pull_request_review_comment') {
    const inbound = parsePrReviewCommentInbound(payload as PRReviewCommentPayload);
    if (inbound) handler.admit(inbound);
    return;
  }
  if (event === 'pull_request_review') {
    const inbound = parsePrReviewInbound(payload as PRReviewPayload);
    if (inbound) handler.admit(inbound);
  }
  // Cross-adapter subscription fan-out deferred (needs multi-adapter send in Runtime).
}
