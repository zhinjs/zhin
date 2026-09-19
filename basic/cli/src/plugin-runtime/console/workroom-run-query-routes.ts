import { withGenerationAgentConsole } from './agent-console.js';
import { writeJson } from './http-response.js';
import {
  rejectWorkroomQueryFields,
  requireWorkroomPrincipal,
  type WorkroomRouteOptions,
} from './workroom-request-policy.js';

const PRINCIPAL_QUERY_FIELDS = Object.freeze(['principalId']);

export function registerWorkroomRunQueryRoutes(options: WorkroomRouteOptions): void {
  const { http, base, snapshots } = options;
  http.route('GET', `${base}/agent/workroom/runs`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    const principal = requireWorkroomPrincipal(
      response,
      authScope,
      authenticatedPrincipal,
      '需要绑定 principal 的 full scope 才能读取 Workroom Run',
    );
    if (!principal || rejectWorkroomQueryFields(
      response, url, PRINCIPAL_QUERY_FIELDS, 'principalId 只能来自认证 token',
    )) return;
    const projectId = url.searchParams.get('projectId') ?? '';
    if (!projectId) {
      writeJson(response, 400, { success: false, error: '请提供 projectId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ workroom }) => {
      const result = await workroom.listRuns({ projectId, authenticatedPrincipal: principal });
      if (result.status === 'forbidden') {
        writeJson(response, 403, { success: false, error: '无权读取该 Project 的 Workroom Run' });
        return;
      }
      writeJson(response, 200, { success: true, data: { projectId, runs: result.runs } });
    });
    if (!handled) writeWorkroomUnavailable(response);
  }, {
    summary: 'List Workroom runs',
    tags: ['agent', 'workroom'],
  });

  http.route('GET', `${base}/agent/workroom/readiness`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    const principal = requireWorkroomPrincipal(
      response,
      authScope,
      authenticatedPrincipal,
      '需要绑定 principal 的 full scope 才能读取 Workroom readiness',
    );
    if (!principal || rejectWorkroomQueryFields(
      response, url, PRINCIPAL_QUERY_FIELDS, 'principalId 只能来自认证 token',
    )) return;
    const projectId = url.searchParams.get('projectId') ?? '';
    const runId = url.searchParams.get('runId') ?? '';
    if (!projectId || !runId) {
      writeJson(response, 400, { success: false, error: '请提供 projectId 和 runId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ workroom }) => {
      const result = await workroom.getReadiness({ projectId, runId, authenticatedPrincipal: principal });
      if (result.status === 'forbidden') {
        writeJson(response, 403, { success: false, error: '无权读取该 Project 的 Workroom readiness' });
        return;
      }
      if (result.status === 'not_found') {
        writeJson(response, 404, { success: false, error: 'Run not found' });
        return;
      }
      writeJson(response, 200, { success: true, data: result.readiness });
    });
    if (!handled) writeWorkroomUnavailable(response);
  }, {
    summary: 'Diagnose Workroom run readiness',
    tags: ['agent', 'workroom'],
  });

  http.route('GET', `${base}/agent/workroom/runs/*`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    const principal = requireWorkroomPrincipal(
      response,
      authScope,
      authenticatedPrincipal,
      '需要绑定 principal 的 full scope 才能读取 Workroom Run',
    );
    if (!principal || rejectWorkroomQueryFields(
      response, url, PRINCIPAL_QUERY_FIELDS, 'principalId 只能来自认证 token',
    )) return;
    const prefix = `${base}/agent/workroom/runs/`;
    const runId = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/\/+$/u, '')
      : '';
    if (!runId || runId.includes('/')) {
      writeJson(response, 404, { success: false, error: 'Run not found' });
      return;
    }
    const projectId = url.searchParams.get('projectId') ?? '';
    if (!projectId) {
      writeJson(response, 400, { success: false, error: '请提供 projectId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ workroom }) => {
      const result = await workroom.getRun({ projectId, runId, authenticatedPrincipal: principal });
      if (result.status === 'forbidden') {
        writeJson(response, 403, { success: false, error: '无权读取该 Project 的 Workroom Run' });
        return;
      }
      if (result.status === 'not_found') {
        writeJson(response, 404, { success: false, error: `Run ${runId} 不存在` });
        return;
      }
      writeJson(response, 200, { success: true, data: result.run });
    });
    if (!handled) writeWorkroomUnavailable(response);
  }, {
    summary: 'Get Workroom run',
    tags: ['agent', 'workroom'],
  });
}

function writeWorkroomUnavailable(response: Parameters<typeof writeJson>[0]): void {
  writeJson(response, 503, {
    success: false,
    error: 'Workroom runtime 未就绪（未安装或未初始化 @zhin.js/agent）',
  });
}
