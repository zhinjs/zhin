import type { ImRuntime } from '@zhin.js/core/runtime';
import { readJsonBody, type HttpHost, jsonResponse } from '@zhin.js/host-http';
import { CONSOLE_SEND_FAILURE_MESSAGES } from '@zhin.js/console-protocol';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { expectedErrorResponse, internalErrorResponse } from './internal-error.js';
import { consoleSendFailure } from './send-failure.js';

const logger = getLogger('console');

type EndpointSender = Pick<ImRuntime['endpoints'], 'send'>;

const CONVERSATION_KINDS = ['private', 'group', 'channel'] as const;
type ConversationKind = typeof CONVERSATION_KINDS[number];

function isConversationKind(value: unknown): value is ConversationKind {
  return typeof value === 'string' && (CONVERSATION_KINDS as readonly string[]).includes(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/**
 * `POST {base}/message/send` — operator send used by `zhin send`.
 * Delivery goes through `im.endpoints.send`, i.e. the regular outbound chain.
 */
export function registerMessageSendRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  im?: { readonly endpoints: EndpointSender };
}>): void {
  const { http, base, im } = options;
  http.route('POST', `${base}/message/send`, async (request) => {
    if (!im) {
      return expectedErrorResponse(503, 'unavailable', 'IM runtime 尚未就绪');
    }
    // HttpBodyError (400/413) is mapped to its status by the Host.
    const body: unknown = await readJsonBody(request);
    const data = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const adapter = text(data.adapter);
    const endpointKey = text(data.endpoint);
    const id = text(data.id);
    const kind = data.type ?? 'private';
    const content = data.content;
    if (!adapter || !endpointKey || !id || !isConversationKind(kind)
      || content === undefined || content === null || content === '') {
      return expectedErrorResponse(400, 'invalid_argument',
        '参数不合法：adapter、endpoint、id、content 必填，type 只能是 private | group | channel');
    }
    try {
      const result = await im.endpoints.send({
        adapter,
        endpointKey,
        conversation: { kind, id },
        content,
      });
      return jsonResponse(200, { success: true, data: { messageId: result.messageId } });
    } catch (error) {
      // An expected delivery failure: classified code + user-facing reason; the detail stays in the log.
      const failure = consoleSendFailure(error);
      if (!failure) return internalErrorResponse(502, 'console_message_send_failed', error);
      logger.warn(formatCompact({
        op: 'console_message_send_failed', adapter, endpoint: endpointKey, code: failure.code, reason: failure.reason,
        error: error instanceof Error ? error.message : String(error),
      }));
      return failure.reason === 'endpoint_not_found'
        ? expectedErrorResponse(404, 'endpoint_not_found', CONSOLE_SEND_FAILURE_MESSAGES.endpoint_not_found, failure)
        : expectedErrorResponse(502, 'delivery_failed', CONSOLE_SEND_FAILURE_MESSAGES[failure.reason], failure);
    }
  }, {
    summary: 'Send a message through an Endpoint',
    tags: ['message'],
  });
}
