import type { ImRuntime } from '@zhin.js/core/runtime';
import { readJsonBody, type HttpHost, jsonResponse } from '@zhin.js/host-http';
import { internalErrorResponse } from './internal-error.js';

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
      return jsonResponse(503, { success: false, error: 'IM runtime 尚未就绪' });
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
      return jsonResponse(400, {
        success: false,
        error: 'adapter, endpoint, id, content are required; type must be private | group | channel',
      });
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
      if (error instanceof Error && error.message === 'endpoint not found') {
        return jsonResponse(404, { success: false, error: 'endpoint not found' });
      }
      return internalErrorResponse(502, 'console_message_send_failed', error);
    }
  }, {
    summary: 'Send a message through an Endpoint',
    tags: ['message'],
  });
}
