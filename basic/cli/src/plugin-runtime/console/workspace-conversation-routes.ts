import { HttpBodyError, readJsonBody, type HttpHost } from '@zhin.js/host-http';
import type { DatabaseHost, SnapshotReader } from '@zhin.js/plugin-runtime';
import { writeJson } from './http-response.js';
import { SandboxWorkspaceBindingError, withSandboxWorkspaceScope } from './sandbox-workspace-scope.js';
import {
  listWorkspaceConversations,
  saveWorkspaceConversation,
  WorkspaceRevisionConflictError,
  WorkspaceStoreUnavailableError,
  type WorkspaceConversationInput,
} from './workspace-conversations.js';

/** Metadata only: no message replay, migration, expiry, or task execution. */
export function registerWorkspaceConversationRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  snapshots?: SnapshotReader;
  databaseHost?: DatabaseHost;
}>): void {
  const { http, base, snapshots, databaseHost } = options;
  http.route('GET', `${base}/conversations/workspaces`, async (_request, response, url, authScope) => {
    response.setHeader('cache-control', 'no-store');
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '当前凭据不能读取会话目录' });
      return;
    }
    const connectionId = url.searchParams.get('connectionId');
    if (!connectionId) {
      writeJson(response, 400, { success: false, code: 'invalid_workspace_query', error: '请提供当前 Sandbox 连接' });
      return;
    }
    try {
      const data = await withSandboxWorkspaceScope(snapshots, connectionId, async scope => ({
        scope, items: await listWorkspaceConversations(databaseHost, scope),
      }));
      writeJson(response, 200, { success: true, data });
    } catch (error) { writeWorkspaceError(response, error); }
  }, { summary: 'Read Console conversation workspaces', tags: ['conversations'] });

  http.route('PUT', `${base}/conversations/workspaces`, async (request, response, _url, authScope) => {
    response.setHeader('cache-control', 'no-store');
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '当前凭据不能保存会话目录' });
      return;
    }
    try {
      const body = await readJsonBody<Record<string, unknown>>(request);
      const input = parseWorkspaceConversation(body?.conversation);
      if (!body || typeof body.connectionId !== 'string' || !body.connectionId || !input
        || (body.expectedRevision !== null && (typeof body.expectedRevision !== 'string' || !body.expectedRevision))) {
        writeJson(response, 400, { success: false, code: 'invalid_workspace_input', error: '请提供完整的会话配置及预期版本' });
        return;
      }
      const data = await withSandboxWorkspaceScope(snapshots, body.connectionId, async scope => ({
        scope, item: await saveWorkspaceConversation(databaseHost, scope, input, body.expectedRevision as string | null),
      }));
      writeJson(response, 200, { success: true, data });
    } catch (error) { writeWorkspaceError(response, error); }
  }, { summary: 'Save one Console conversation workspace with a revision', tags: ['conversations'] });
}

function writeWorkspaceError(response: Parameters<typeof writeJson>[0], error: unknown): void {
  if (error instanceof HttpBodyError) {
    writeJson(response, error.statusCode, { success: false, code: 'invalid_workspace_input', error: error.message });
  } else if (error instanceof WorkspaceRevisionConflictError) {
    writeJson(response, 409, { success: false, code: error.code, error: error.message });
  } else if (error instanceof SandboxWorkspaceBindingError || error instanceof WorkspaceStoreUnavailableError) {
    writeJson(response, 503, { success: false, code: error.code, error: error.message });
  } else {
    // A failed read or uncertain write is not an empty/unavailable store and must not be migrated over.
    writeJson(response, 503, { success: false, code: 'workspace_store_error', error: '无法确认会话目录操作结果，请重新读取后确认' });
  }
}

function parseWorkspaceConversation(value: unknown): WorkspaceConversationInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 256
    || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120
    || typeof input.type !== 'string' || !['private', 'group', 'channel'].includes(input.type)) return undefined;
  const run = input.runConfig;
  if (!run || typeof run !== 'object' || Array.isArray(run)) return undefined;
  const config = run as Record<string, unknown>;
  if (typeof config.workingDirectory !== 'string' || config.workingDirectory.trim().length > 4096
    || typeof config.safetyMode !== 'string' || !['read-only', 'workspace-write', 'danger-full-access'].includes(config.safetyMode)
    || typeof config.approvalMode !== 'string' || !['ask', 'auto', 'bypass'].includes(config.approvalMode) || typeof config.networkAccess !== 'boolean') return undefined;
  return { id: input.id, name: input.name.trim(), type: input.type as WorkspaceConversationInput['type'],
    runConfig: { workingDirectory: config.workingDirectory.trim(), safetyMode: config.safetyMode as WorkspaceConversationInput['runConfig']['safetyMode'],
      approvalMode: config.approvalMode as WorkspaceConversationInput['runConfig']['approvalMode'],
      networkAccess: config.safetyMode === 'danger-full-access' || config.networkAccess } };
}
