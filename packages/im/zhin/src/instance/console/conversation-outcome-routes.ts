/**
 * zhinjs/zhin#1250 (`unaddressed-message-no-record`): the settled inbound outcomes (ADR 0061) of the
 * live Sandbox conversation, so the Sandbox page can say why a message got no reply ("not addressed",
 * "muted here", "feature disabled", …) instead of leaving the sender waiting. Reads the process-local
 * outcome log only: no message body is kept or returned, nothing is replayed or sent.
 *
 * Like the task results route, only the live connection owner's messages are listed: a record whose
 * sender is neither the owner nor the owner's simulated id (ADR 0060 §5.4) is never returned.
 */
import { invalidLocaleResponse, jsonResponse, type HttpHost } from '@zhin.js/host-http';
import { formatMessageOutcome, type MessageOutcomeReader, type MessageOutcomeRecord } from '@zhin.js/core/runtime';
import { queryLocale, type Locale, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { ConsoleConversationOutcome } from '@zhin.js/console-protocol';
import { parseBoundSandboxSession, SandboxWorkspaceBindingError, sandboxScopeForbiddenResponse, withSandboxWorkspaceScope } from './sandbox-workspace-scope.js';
import { noStore } from './no-store.js';

const MAX_MESSAGE_ID = 2048;
const LIMIT = 20;
/** ADR 0060 §5.4: a simulation writes a client-chosen sender id as `~sim:<id>`. */
const SIMULATED_SENDER_PREFIX = '~sim:';

/** The sender ids the connection owner speaks as: their own id and its simulated form. */
function ownerSenderIds(ownerId: string): readonly string[] {
  return ownerId.startsWith(SIMULATED_SENDER_PREFIX) ? [ownerId] : [ownerId, `${SIMULATED_SENDER_PREFIX}${ownerId}`];
}

/**
 * One record as the Sandbox shows it: codes and the sender-facing text. The operator text (plugin
 * names, stage) is never returned: this route needs only `endpoint.view`.
 */
export function consoleConversationOutcome(record: MessageOutcomeRecord, locale: Locale): ConsoleConversationOutcome {
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
  });
}

export function registerConversationOutcomeRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  outcomes?: MessageOutcomeReader;
  snapshots?: SnapshotReader;
}>): void {
  options.http.route('GET', `${options.base}/conversations/outcomes`, noStore(async (_request, { url, principal }) => {
    const sessionKey = url.searchParams.get('sessionKey') ?? '';
    const connectionId = url.searchParams.get('connectionId') ?? '';
    const messageId = url.searchParams.get('messageId');
    const locale = queryLocale(url.searchParams);
    if (!locale) return invalidLocaleResponse();
    if (!connectionId || !sessionKey || (messageId !== null && (!messageId || messageId.length > MAX_MESSAGE_ID))) {
      return jsonResponse(400, { success: false, code: 'invalid_outcome_query', error: '请提供当前连接和有效的 Sandbox 会话' });
    }
    if (!options.outcomes) {
      return jsonResponse(503, { success: false, code: 'outcomes_unavailable', error: 'IM 消息结局尚未就绪' });
    }
    const outcomes = options.outcomes;
    try {
      return await withSandboxWorkspaceScope(options.snapshots, { connectionId, principal }, async scope => {
        const session = parseBoundSandboxSession(scope, sessionKey);
        if (session.status === 'scope_mismatch') {
          return jsonResponse(403, { success: false, code: 'outcome_scope_mismatch', error: '会话不属于当前 Sandbox 账号' });
        }
        if (session.status === 'invalid') {
          return jsonResponse(400, { success: false, code: 'invalid_outcome_query', error: '请提供当前连接和有效的 Sandbox 会话' });
        }
        const conversation = { endpoint: scope.endpoint, kind: session.kind, id: session.id };
        // Newest first across the owner's sender ids; another principal's messages are not listed.
        const records = ownerSenderIds(scope.ownerId)
          .flatMap(senderId => outcomes.list({ conversation, senderId, ...(messageId !== null ? { messageId } : {}), limit: LIMIT }))
          .sort((a, b) => b.settledAt - a.settledAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
          .slice(0, LIMIT);
        return jsonResponse(200, { success: true, data: {
          sessionKey, persistent: outcomes.persistent,
          outcomes: records.map(record => consoleConversationOutcome(record, locale)),
        } });
      });
    } catch (error) {
      const forbidden = sandboxScopeForbiddenResponse(error);
      if (forbidden) return forbidden;
      if (!(error instanceof SandboxWorkspaceBindingError)) throw error;
      return jsonResponse(503, { success: false, code: error.code, error: error.message });
    }
  }), { summary: 'Read why recent messages of the live Sandbox conversation got (or did not get) a reply', tags: ['conversations'] });
}
