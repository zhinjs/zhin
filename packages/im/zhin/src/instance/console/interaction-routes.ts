import { jsonResponse } from '@zhin.js/host-http';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { parseBoundSandboxSession, SandboxWorkspaceBindingError, sandboxScopeForbiddenResponse, withSandboxWorkspaceScope } from './sandbox-workspace-scope.js';
import { noStore } from './no-store.js';

/** One prompt per subject; a bound response never grows with the number of simulated speakers. */
const MAX_PENDING_INTERACTIONS = 20;

type PendingUserInteraction = ReturnType<ImRuntime['listPendingInteractions']>[number];

/** ADR 0060 §5.4: a simulation writes a client-chosen sender id as `~sim:<id>`. */
const SIMULATED_SENDER_PREFIX = '~sim:';

/**
 * Who may answer one pending prompt, as seen by the requesting connection (#1250 b114 L2):
 * - `anyone`: any sender of the conversation;
 * - `self`: the requester's own chat identity (answered with 「以我的聊天身份发言」);
 * - `simulated`: a simulated sender, whose `~sim:` id any page may speak as;
 * - `other`: someone else's real identity — the page shows the card read-only, and that id is
 *   never sent to it.
 */
export type PendingInteractionAnswerer =
  | Readonly<{ kind: 'anyone' }>
  | Readonly<{ kind: 'self' }>
  | Readonly<{ kind: 'simulated'; senderId: string }>
  | Readonly<{ kind: 'other' }>;

/** The redacted projection a page receives: no conversation ref, claim owner or internal subject marker. */
export interface PendingInteractionView {
  readonly id: string;
  readonly generation: number;
  readonly expiresAt: number;
  readonly segments: PendingUserInteraction['segments'];
  readonly answerAs: PendingInteractionAnswerer;
}

/** `self`: the chat identity the requesting connection speaks as here, if it has one. */
export function projectPendingInteraction(pending: PendingUserInteraction, self?: string): PendingInteractionView {
  return { id: pending.id, generation: pending.generation, expiresAt: pending.expiresAt, segments: pending.segments,
    answerAs: pendingAnswerer(pending, self) };
}

function pendingAnswerer(pending: PendingUserInteraction, self: string | undefined): PendingInteractionAnswerer {
  if (pending.answeredBy === 'anyone') return { kind: 'anyone' };
  if (pending.subjectId.startsWith(SIMULATED_SENDER_PREFIX)) return { kind: 'simulated', senderId: pending.subjectId };
  return self !== undefined && pending.subjectId === self ? { kind: 'self' } : { kind: 'other' };
}

/**
 * Current prompts only; responses still enter through the original Sandbox IM interaction path.
 * Lists every prompt of the bound conversation, not only one asked of the connection owner: a
 * Sandbox page speaks as a simulated sender or as the viewer's chat identity (ADR 0060 §5.4), never
 * as the owner, so an owner-only read never found the prompt the page itself raised (#1250 b114).
 */
export function registerInteractionRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  snapshots?: SnapshotReader;
  im?: Pick<ImRuntime, 'listPendingInteractions'>;
}>): void {
  const { http, base, snapshots, im } = options;
  http.route('GET', `${base}/interactions/pending`, noStore(async (_request, { url, principal }) => {
    const connectionId = url.searchParams.get('connectionId')?.trim() ?? '';
    const sessionKey = url.searchParams.get('sessionKey');
    if (!connectionId || !sessionKey) {
      return jsonResponse(400, { success: false, code: 'invalid_interaction_query', error: '请提供有效的连接和会话' });
    }
    if (!im) {
      return jsonResponse(503, { success: false, code: 'interactions_unavailable', error: '交互读取尚未就绪' });
    }
    try {
      return await withSandboxWorkspaceScope(snapshots, { connectionId, principal }, async (scope, snapshot, live) => {
        const session = parseBoundSandboxSession(scope, sessionKey);
        if (session.status === 'scope_mismatch') {
          return jsonResponse(403, { success: false, code: 'interaction_scope_mismatch', error: '会话不属于当前 Sandbox 账号' });
        }
        if (session.status === 'invalid') {
          return jsonResponse(400, { success: false, code: 'invalid_interaction_query', error: '请提供有效的连接和会话' });
        }
        const conversation = { endpoint: scope.endpoint, kind: session.kind, id: session.id };
        const pending = im.listPendingInteractions(conversation, snapshot.generation);
        const self = pending.length ? live.chatIdentityOf(conversation) : undefined;
        return jsonResponse(200, { success: true, data: { generation: snapshot.generation,
          pending: pending.slice(0, MAX_PENDING_INTERACTIONS).map(item => projectPendingInteraction(item, self)) } });
      });
    } catch (error) {
      const forbidden = sandboxScopeForbiddenResponse(error);
      if (forbidden) return forbidden;
      if (error instanceof SandboxWorkspaceBindingError) {
        return jsonResponse(503, { success: false, code: error.code, error: error.message });
      } else {
        return jsonResponse(500, { success: false, code: 'interactions_read_failed', error: '待处理交互读取失败' });
      }
    }
  }), { summary: 'Read current Sandbox interaction', tags: ['console', 'interaction'] });
}
