/**
 * zhinjs/zhin#1250 (`unaddressed-message-no-record`): the settled inbound outcomes (ADR 0061) of the
 * live Sandbox conversation, so the Sandbox page can say why a message got no reply ("not addressed",
 * "muted here", "feature disabled", …) instead of leaving the sender waiting. Reads the process-local
 * outcome log only: no message body is kept or returned, nothing is replayed or sent.
 */
import { jsonResponse, type HttpHost } from '@zhin.js/host-http';
import { formatMessageOutcome, type MessageOutcomeReader, type MessageOutcomeRecord } from '@zhin.js/core/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import type { ConsoleConversationOutcome } from '@zhin.js/console-protocol';
import { parseBoundSandboxSession, SandboxWorkspaceBindingError, withSandboxWorkspaceScope } from './sandbox-workspace-scope.js';
import { noStore } from './no-store.js';

const MAX_MESSAGE_ID = 2048;

/** One record as the Sandbox shows it: codes, sender-facing text (never the administrator detail). */
export function consoleConversationOutcome(record: MessageOutcomeRecord, locale: 'zh-CN' | 'en'): ConsoleConversationOutcome {
  return Object.freeze({
    id: record.id,
    ...(record.messageId ? { messageId: record.messageId } : {}),
    settledAt: record.settledAt,
    outcome: record.outcome,
    ...(record.reason ? { reason: record.reason } : {}),
    stage: record.stage,
    addressed: record.addressed,
    reply: record.reply,
    ...(record.command ? { command: record.command } : {}),
    ...(record.turnId ? { turnId: record.turnId } : {}),
    ...(record.errorId ? { errorId: record.errorId } : {}),
    text: formatMessageOutcome(record, { audience: 'sender', locale }),
    adminText: formatMessageOutcome(record, { audience: 'admin', locale }),
  });
}

export function registerConversationOutcomeRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  outcomes?: MessageOutcomeReader;
  snapshots?: SnapshotReader;
}>): void {
  options.http.route('GET', `${options.base}/conversations/outcomes`, noStore(async (_request, { url }) => {
    const sessionKey = url.searchParams.get('sessionKey') ?? '';
    const connectionId = url.searchParams.get('connectionId') ?? '';
    const messageId = url.searchParams.get('messageId');
    const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'zh-CN';
    if (!connectionId || !sessionKey || (messageId !== null && (!messageId || messageId.length > MAX_MESSAGE_ID))) {
      return jsonResponse(400, { success: false, code: 'invalid_outcome_query', error: '请提供当前连接和有效的 Sandbox 会话' });
    }
    if (!options.outcomes) {
      return jsonResponse(503, { success: false, code: 'outcomes_unavailable', error: 'IM 消息结局尚未就绪' });
    }
    const outcomes = options.outcomes;
    try {
      return await withSandboxWorkspaceScope(options.snapshots, connectionId, async scope => {
        const session = parseBoundSandboxSession(scope, sessionKey);
        if (session.status === 'scope_mismatch') {
          return jsonResponse(403, { success: false, code: 'outcome_scope_mismatch', error: '会话不属于当前 Sandbox 账号' });
        }
        if (session.status === 'invalid') {
          return jsonResponse(400, { success: false, code: 'invalid_outcome_query', error: '请提供当前连接和有效的 Sandbox 会话' });
        }
        const records = outcomes.list({
          conversation: { endpoint: scope.endpoint, kind: session.kind, id: session.id },
          ...(messageId !== null ? { messageId } : {}),
          limit: 20,
        });
        return jsonResponse(200, { success: true, data: {
          sessionKey, persistent: outcomes.persistent,
          outcomes: records.map(record => consoleConversationOutcome(record, locale)),
        } });
      });
    } catch (error) {
      if (!(error instanceof SandboxWorkspaceBindingError)) throw error;
      return jsonResponse(503, { success: false, code: error.code, error: error.message });
    }
  }), { summary: 'Read why recent messages of the live Sandbox conversation got (or did not get) a reply', tags: ['conversations'] });
}
