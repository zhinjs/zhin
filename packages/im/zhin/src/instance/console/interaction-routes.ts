import { jsonResponse } from '@zhin.js/host-http';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { parseBoundSandboxSession, SandboxWorkspaceBindingError, withSandboxWorkspaceScope } from './sandbox-workspace-scope.js';
import { noStore } from './no-store.js';

/** One prompt per subject; a bound response never grows with the number of simulated speakers. */
const MAX_PENDING_INTERACTIONS = 20;

type PendingUserInteraction = ReturnType<ImRuntime['listPendingInteractions']>[number];

/** How a page answers one pending prompt: as any sender, or as the exact sender it asked. */
export type PendingInteractionAnswerer = Readonly<{ kind: 'anyone' }> | Readonly<{ kind: 'sender'; senderId: string }>;

/** The redacted projection a page receives: no conversation ref, claim owner or internal subject marker. */
export interface PendingInteractionView {
  readonly id: string;
  readonly generation: number;
  readonly expiresAt: number;
  readonly segments: PendingUserInteraction['segments'];
  readonly answerAs: PendingInteractionAnswerer;
}

export function projectPendingInteraction(pending: PendingUserInteraction): PendingInteractionView {
  return { id: pending.id, generation: pending.generation, expiresAt: pending.expiresAt, segments: pending.segments,
    answerAs: pending.answeredBy === 'anyone' ? { kind: 'anyone' } : { kind: 'sender', senderId: pending.subjectId } };
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
  http.route('GET', `${base}/interactions/pending`, noStore(async (_request, { url }) => {
    const connectionId = url.searchParams.get('connectionId')?.trim() ?? '';
    const sessionKey = url.searchParams.get('sessionKey');
    if (!connectionId || !sessionKey) {
      return jsonResponse(400, { success: false, code: 'invalid_interaction_query', error: '请提供有效的连接和会话' });
    }
    if (!im) {
      return jsonResponse(503, { success: false, code: 'interactions_unavailable', error: '交互读取尚未就绪' });
    }
    try {
      return await withSandboxWorkspaceScope(snapshots, connectionId, async (scope, snapshot) => {
        const session = parseBoundSandboxSession(scope, sessionKey);
        if (session.status === 'scope_mismatch') {
          return jsonResponse(403, { success: false, code: 'interaction_scope_mismatch', error: '会话不属于当前 Sandbox 账号' });
        }
        if (session.status === 'invalid') {
          return jsonResponse(400, { success: false, code: 'invalid_interaction_query', error: '请提供有效的连接和会话' });
        }
        const pending = im.listPendingInteractions({ endpoint: scope.endpoint, kind: session.kind, id: session.id },
          snapshot.generation);
        return jsonResponse(200, { success: true, data: { generation: snapshot.generation,
          pending: pending.slice(0, MAX_PENDING_INTERACTIONS).map(projectPendingInteraction) } });
      });
    } catch (error) {
      if (error instanceof SandboxWorkspaceBindingError) {
        return jsonResponse(503, { success: false, code: error.code, error: error.message });
      } else {
        return jsonResponse(500, { success: false, code: 'interactions_read_failed', error: '待处理交互读取失败' });
      }
    }
  }), { summary: 'Read current Sandbox interaction', tags: ['console', 'interaction'] });
}
