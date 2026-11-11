/**
 * GitHub webhook HTTP: verify → parse → admit inbound comments.
 */
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { readTextBody } from '@zhin.js/host-http-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  headerValue,
  parseIssueCommentInbound,
  parsePrReviewCommentInbound,
  parsePrReviewInbound,
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
  admitPlatform(name: string, event: unknown): void;
  admit(comment: GithubInboundComment, nativeEvent?: unknown): void;
}

export function registerGithubWebhookRoutes(
  http: HttpHost,
  handler: GithubWebhookHandler,
): HttpRouteRegistration[] {
  const routePath = handler.config.webhookPath;
  return [
    http.route('POST', routePath, (request) => handleGithubWebhookRequest(request, handler), { summary: 'GitHub webhook', tags: ['github'] }),
  ];
}

export async function handleGithubWebhookRequest(
  request: Request,
  handler: GithubWebhookHandler,
): Promise<Response> {
  const secret = handler.config.webhookSecret;
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  const signature = headerValue(request.headers, 'x-hub-signature-256');
  const event = headerValue(request.headers, 'x-github-event');
  const deliveryId = headerValue(request.headers, 'x-github-delivery');

  if (!signature || !event) {
    return new Response(JSON.stringify({ error: 'Missing signature or event header' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
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
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    void dispatchGithubWebhookPayload(event, payload, handler).catch((e) => {
      logger.error(`Webhook 事件处理失败 (${event}):`, e);
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    logger.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
  handler.admitPlatform(
    typeof body.action === 'string' && body.action ? `${event}.${body.action}` : event,
    payload,
  );

  if (event === 'issue_comment') {
    const inbound = parseIssueCommentInbound(payload as IssueCommentPayload);
    if (inbound) handler.admit(inbound, payload);
    return;
  }
  if (event === 'pull_request_review_comment') {
    const inbound = parsePrReviewCommentInbound(payload as PRReviewCommentPayload);
    if (inbound) handler.admit(inbound, payload);
    return;
  }
  if (event === 'pull_request_review') {
    const inbound = parsePrReviewInbound(payload as PRReviewPayload);
    if (inbound) handler.admit(inbound, payload);
  }
  // Cross-adapter subscription fan-out deferred (needs multi-adapter send in Runtime).
}
