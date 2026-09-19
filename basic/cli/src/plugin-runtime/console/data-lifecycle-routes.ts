import { readJsonBody, type HttpHost } from '@zhin.js/host-http';
import type { WorkroomDataLifecycleConsoleCommand } from '@zhin.js/agent/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { withGenerationAgentConsole } from './agent-console.js';
import { writeJson } from './http-response.js';

export interface RegisterDataLifecycleRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly snapshots?: SnapshotReader;
}

export function registerDataLifecycleRoutes(
  options: RegisterDataLifecycleRoutesOptions,
): void {
  const { http, base, snapshots } = options;
  http.route('GET', `${base}/agent/workroom/data-lifecycle`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, { success: false,
        error: '需要绑定 principal 的 full scope 才能读取 Data Lifecycle' });
      return;
    }
    if (url.searchParams.has('principalId') || url.searchParams.has('role')
      || url.searchParams.has('authority')) {
      writeJson(response, 400, { success: false, error: 'Data Lifecycle 身份与权威只能来自认证 token' });
      return;
    }
    const projectId = url.searchParams.get('projectId')?.trim() ?? '';
    const objectId = url.searchParams.get('objectId')?.trim() ?? '';
    if (!projectId || !objectId) {
      writeJson(response, 400, { success: false, error: '请提供 projectId/objectId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ dataLifecycle }) => {
      if (!dataLifecycle) {
        writeJson(response, 503, { success: false, error: 'Data Lifecycle 治理控制面尚未就绪' });
        return;
      }
      const result = await dataLifecycle.read(
        { projectId, objectId }, { principalId: authenticatedPrincipal.principalId },
      );
      if (result.status === 'forbidden') {
        writeJson(response, 403, { success: false, error: '无权读取该 Data Lifecycle 对象' });
        return;
      }
      writeJson(response, 200, { success: true, data: result.projection });
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Read an authenticated content-free Payload Lifecycle projection',
    tags: ['agent', 'workroom', 'data-governance'],
  });

  http.route('GET', `${base}/agent/workroom/data-lifecycle/overdue`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, { success: false,
        error: '需要绑定 principal 的 full scope 才能读取 Data Lifecycle' });
      return;
    }
    if (url.searchParams.has('principalId') || url.searchParams.has('role')
      || url.searchParams.has('authority')) {
      writeJson(response, 400, { success: false, error: 'Data Lifecycle 身份与权威只能来自认证 token' });
      return;
    }
    const operationId = url.searchParams.get('operationId')?.trim() ?? '';
    const projectId = url.searchParams.get('projectId')?.trim() ?? '';
    if (!operationId || !projectId) {
      writeJson(response, 400, { success: false, error: '请提供 operationId/projectId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ dataLifecycle }) => {
      if (!dataLifecycle) {
        writeJson(response, 503, { success: false, error: 'Data Lifecycle 治理控制面尚未就绪' });
        return;
      }
      const result = await dataLifecycle.listOverdue(
        { operationId, projectId }, { principalId: authenticatedPrincipal.principalId },
      );
      if (result.status === 'forbidden') {
        writeJson(response, 403, { success: false, error: '无权读取该 Project 的 overdue lifecycle controls' });
        return;
      }
      writeJson(response, 200, { success: true, data: result.items });
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'List authenticated content-free overdue Payload Lifecycle reviews',
    tags: ['agent', 'workroom', 'data-governance'],
  });

  http.route('POST', `${base}/agent/workroom/data-lifecycle/commands`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, { success: false,
        error: '需要绑定 principal 的 full scope credential' });
      return;
    }
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    if (containsForbiddenDataLifecycleControlField(body)) {
      writeJson(response, 400, { success: false,
        error: 'Data Lifecycle command 不能携带身份、角色、权威、decision proof 或正文' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ dataLifecycle }) => {
      if (!dataLifecycle) {
        writeJson(response, 503, { success: false, error: 'Data Lifecycle 治理控制面尚未就绪' });
        return;
      }
      try {
        const result = await dataLifecycle.execute(
          body as unknown as WorkroomDataLifecycleConsoleCommand,
          { principalId: authenticatedPrincipal.principalId },
          new AbortController().signal,
        );
        if (result.status === 'forbidden') {
          writeJson(response, 403, { success: false, error: '无权执行该 Data Lifecycle command' });
          return;
        }
        if (result.status === 'stale') {
          writeJson(response, 409, { success: false, error: 'Data Lifecycle export candidate 已失效',
            data: result });
          return;
        }
        if (result.status === 'unavailable') {
          writeJson(response, 503, { success: false, error: 'Data Lifecycle export audit 尚未就绪' });
          return;
        }
        writeJson(response, 200, { success: true, data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeJson(response, /exact schema| is invalid$/iu.test(message) ? 400 : 409, {
          success: false,
          error: message,
        });
      }
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Execute a token-bound typed Payload Lifecycle governance command',
    tags: ['agent', 'workroom', 'data-governance'],
  });
}

const FORBIDDEN_DATA_LIFECYCLE_CONTROL_FIELDS = new Set([
  'principal', 'principalId', 'authenticatedPrincipal', 'authenticatedPrincipalId',
  'role', 'roles', 'requiredRole', 'requiredRoles',
  'authority', 'authorityDigest', 'authorizedBy',
  'decision', 'decisionId', 'decisionProof', 'proof',
  'body', 'content', 'payload', 'discussion', 'text', 'raw',
]);

function containsForbiddenDataLifecycleControlField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenDataLifecycleControlField);
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_DATA_LIFECYCLE_CONTROL_FIELDS.has(key)
    || containsForbiddenDataLifecycleControlField(child));
}
