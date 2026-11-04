import { join } from 'node:path';
import type { HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { parseBoundSandboxSession } from './bound-sandbox-session.js';
import { SandboxWorkspaceBindingError, withSandboxWorkspaceScope } from './sandbox-workspace-scope.js';
import { writeJson } from './http-response.js';

/** Read execution output and separate delivery facts; never send or execute a recovered result. */
export function registerConversationResultRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  projectRoot: string;
  snapshots?: SnapshotReader;
}>): void {
  options.http.route('GET', `${options.base}/conversations/results`, async (_request, response, url, authScope) => {
    response.setHeader('cache-control', 'no-store');
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '当前凭据不能读取任务结果' });
      return;
    }
    const sessionKey = url.searchParams.get('sessionKey') ?? '';
    const connectionId = url.searchParams.get('connectionId') ?? '';
    const cursor = url.searchParams.get('cursor');
    let before: { completedAt: number; turnId: string } | undefined;
    if (cursor !== null) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!Number.isSafeInteger(parsed.completedAt) || parsed.completedAt < 0 || typeof parsed.turnId !== 'string' || !parsed.turnId) throw Error('invalid cursor');
        before = { completedAt: parsed.completedAt, turnId: parsed.turnId };
      } catch {
        writeJson(response, 400, { success: false, code: 'invalid_result_query', error: '任务结果游标无效' });
        return;
      }
    }
    if (!connectionId || !sessionKey) {
      writeJson(response, 400, { success: false, code: 'invalid_result_query', error: '请提供当前连接和有效的 Sandbox 会话' });
      return;
    }
    try {
      await withSandboxWorkspaceScope(options.snapshots, connectionId, async scope => {
        const session = parseBoundSandboxSession(scope, sessionKey);
        if (session.status === 'scope_mismatch') {
          writeJson(response, 403, { success: false, code: 'result_scope_mismatch', error: '会话不属于当前 Sandbox 账号' });
          return;
        }
        if (session.status === 'invalid') {
          writeJson(response, 400, { success: false, code: 'invalid_result_query', error: '请提供当前连接和有效的 Sandbox 会话' });
          return;
        }
        const { FileJournalStore } = await import('@zhin.js/agent');
        const store = new FileJournalStore(join(options.projectRoot, '.zhin', 'agent-journal'));
        const page = await store.readResultsPage(sessionKey, scope.ownerId, {
          endpoint: scope.endpoint, kind: session.kind, id: session.id,
        }, before);
        const data = { sessionKey, nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url') : null,
          hasMore: page.hasMore, results: page.results.map(result => ({
          turnId: result.turnId, completedAt: result.completedAt, message: result.message,
          deliveries: result.deliveries.map(receipt => ({ status: receipt.status, outcome: receipt.outcome,
            recordedAt: receipt.recordedAt, ...(receipt.code ? { code: receipt.code } : {}),
            ...(receipt.deliveryUnknown ? { deliveryUnknown: true } : {}),
            messages: receipt.messages, resources: receipt.resources })),
        })) };
        writeJson(response, 200, { success: true, data });
      });
    } catch (error) {
      writeJson(response, 503, { success: false,
        code: error instanceof SandboxWorkspaceBindingError ? error.code : 'result_store_unavailable',
        error: error instanceof SandboxWorkspaceBindingError ? error.message : '任务结果暂时无法读取，请稍后重试' });
    }
  }, { summary: 'Read completed Sandbox task output and delivery facts', tags: ['conversations'] });
}
