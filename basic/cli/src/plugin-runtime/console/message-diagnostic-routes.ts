import type { RuntimeMessageDiagnosticsReader } from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { HttpHost } from '@zhin.js/host-http';
import type { ConsoleMessageDiagnostic } from '@zhin.js/console-protocol';
import { parseBoundedInteger, writeJson } from './http-response.js';

/** Reads operational facts only; it never replays a message or runs plugin code. */
export function registerMessageDiagnosticRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  diagnostics?: RuntimeMessageDiagnosticsReader;
}>): void {
  const { http, base, diagnostics } = options;
  http.route('GET', `${base}/messages/diagnostics`, (request, response, url, authScope) => {
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (authScope !== 'full' || http.tokenRegistry.resolve(bearer) !== 'full') {
      writeJson(response, 403, { success: false, error: '需要显式配置并验证 full scope Token 才能读取消息诊断' });
      return;
    }
    if (!diagnostics) {
      writeJson(response, 503, { success: false, error: 'IM 消息诊断尚未就绪' });
      return;
    }
    response.setHeader('cache-control', 'no-store');
    const id = url.searchParams.get('id');
    if (id !== null) {
      if (!id || id.length > 128) {
        writeJson(response, 400, { success: false, error: '诊断 ID 无效' });
        return;
      }
      const record: ConsoleMessageDiagnostic | undefined = diagnostics.get(id);
      writeJson(response, record ? 200 : 404, record
        ? { success: true, data: record }
        : { success: false, error: '记录不存在或已过期；诊断仅保留最近的进程内记录' });
      return;
    }
    let conversation: ConversationRef | undefined;
    const encoded = url.searchParams.get('conversation');
    if (encoded !== null) {
      conversation = parseDiagnosticConversation(encoded);
      if (!conversation) {
        writeJson(response, 400, { success: false, error: '请提供完整且有效的会话标识（含 Endpoint、父容器和话题）' });
        return;
      }
    }
    const messageId = url.searchParams.get('messageId');
    if (messageId !== null && (!conversation || !messageId || messageId.length > 2048)) {
      writeJson(response, 400, { success: false, error: '按消息查询需要完整会话及有效的 messageId' });
      return;
    }
    const records: readonly ConsoleMessageDiagnostic[] = diagnostics.list({
      limit: parseBoundedInteger(url.searchParams.get('limit'), 50, 1, 100),
      ...(conversation ? { conversation } : {}),
      ...(messageId !== null ? { messageId } : {}),
    });
    writeJson(response, 200, { success: true, data: records });
  }, {
    summary: 'Read bounded message processing diagnostics',
    tags: ['messages', 'diagnostics'],
    description: 'Full-scope, read-only operational facts. No message replay or message bodies. Process restart clears records.',
  });
}

function parseDiagnosticConversation(encoded: string): ConversationRef | undefined {
  if (encoded.length > 8192) return undefined;
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { return undefined; }
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const endpoint = item.endpoint as Record<string, unknown> | null | undefined;
  const parent = item.parent as Record<string, unknown> | null | undefined;
  const string = (field: unknown): field is string => typeof field === 'string' && field.length > 0 && field.length <= 2048;
  const kind = (field: unknown): field is ConversationRef['kind'] => field === 'private' || field === 'group' || field === 'channel';
  if (!endpoint || !string(endpoint.id) || !string(endpoint.adapter) || !kind(item.kind) || !string(item.id)) return undefined;
  if (item.parent !== undefined && (!parent || !kind(parent.kind) || !string(parent.id))) return undefined;
  if (item.threadId !== undefined && !string(item.threadId)) return undefined;
  return {
    endpoint: { id: endpoint.id, adapter: endpoint.adapter }, kind: item.kind, id: item.id,
    ...(parent ? { parent: { kind: parent.kind as ConversationRef['kind'], id: parent.id as string } } : {}),
    ...(item.threadId !== undefined ? { threadId: item.threadId as string } : {}),
  };
}
