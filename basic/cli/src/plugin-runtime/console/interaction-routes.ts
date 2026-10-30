import type { ImRuntime } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { parseBoundSandboxSession } from './bound-sandbox-session.js';
import { writeJson } from './http-response.js';
import { SandboxWorkspaceBindingError, withSandboxWorkspaceScope } from './sandbox-workspace-scope.js';

/** Current prompts only; responses still enter through the original Sandbox IM interaction path. */
export function registerInteractionRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  snapshots?: SnapshotReader;
  im?: Pick<ImRuntime, 'readPendingInteraction'>;
}>): void {
  const { http, base, snapshots, im } = options;
  http.route('GET', `${base}/interactions/pending`, async (_request, response, url, authScope) => {
    response.setHeader('cache-control', 'no-store');
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '当前凭据不能读取待处理交互' });
      return;
    }
    const connectionId = url.searchParams.get('connectionId')?.trim() ?? '';
    const sessionKey = url.searchParams.get('sessionKey');
    if (!connectionId || !sessionKey) {
      writeJson(response, 400, { success: false, code: 'invalid_interaction_query', error: '请提供有效的连接和会话' });
      return;
    }
    if (!im) {
      writeJson(response, 503, { success: false, code: 'interactions_unavailable', error: '交互读取尚未就绪' });
      return;
    }
    try {
      await withSandboxWorkspaceScope(snapshots, connectionId, async (scope, snapshot) => {
        const session = parseBoundSandboxSession(scope, sessionKey);
        if (session.status === 'scope_mismatch') {
          writeJson(response, 403, { success: false, code: 'interaction_scope_mismatch', error: '会话不属于当前 Sandbox 账号' });
          return;
        }
        if (session.status === 'invalid') {
          writeJson(response, 400, { success: false, code: 'invalid_interaction_query', error: '请提供有效的连接和会话' });
          return;
        }
        const pending = im.readPendingInteraction({ endpoint: scope.endpoint, kind: session.kind, id: session.id },
          scope.ownerId, snapshot.generation);
        writeJson(response, 200, { success: true, data: { generation: snapshot.generation, pending: pending ? [pending] : [] } });
      });
    } catch (error) {
      if (error instanceof SandboxWorkspaceBindingError) {
        writeJson(response, 503, { success: false, code: error.code, error: error.message });
      } else {
        writeJson(response, 500, { success: false, code: 'interactions_read_failed', error: '待处理交互读取失败' });
      }
    }
  }, { summary: 'Read current Sandbox interaction', tags: ['console', 'interaction'] });
}
