import { readJsonBody, type HttpHost } from '@zhin.js/host-http';
import type { WorkroomRunControlCommand } from '@zhin.js/agent';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { withGenerationAgentConsole } from './agent-console.js';
import { writeJson } from './http-response.js';

export interface RegisterWorkroomRunRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly snapshots?: SnapshotReader;
}

export function registerWorkroomRunRoutes(
  options: RegisterWorkroomRunRoutesOptions,
): void {
  const { http, base, snapshots } = options;
  // Workroom REST — authenticated, content-free replay projection from the request generation.
  http.route('GET', `${base}/agent/workroom/runs`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, {
        success: false, error: '需要绑定 principal 的 full scope 才能读取 Workroom Run',
      });
      return;
    }
    if (url.searchParams.has('principalId')) {
      writeJson(response, 400, { success: false, error: 'principalId 只能来自认证 token' });
      return;
    }
    const projectId = url.searchParams.get('projectId') ?? '';
    if (!projectId) {
      writeJson(response, 400, { success: false, error: '请提供 projectId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ workroom }) => {
      const result = await workroom.listRuns({
        projectId,
        authenticatedPrincipal: { principalId: authenticatedPrincipal.principalId },
      });
      if (result.status === 'forbidden') {
        writeJson(response, 403, { success: false, error: '无权读取该 Project 的 Workroom Run' });
        return;
      }
      writeJson(response, 200, { success: true, data: { projectId, runs: result.runs } });
    });
    if (!handled) {
      writeJson(response, 503, {
        success: false,
        error: 'Workroom runtime 未就绪（未安装或未初始化 @zhin.js/agent）',
      });
    }
  }, {
    summary: 'List Workroom runs',
    tags: ['agent', 'workroom'],
  });

  http.route('GET', `${base}/agent/workroom/readiness`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, {
        success: false, error: '需要绑定 principal 的 full scope 才能读取 Workroom readiness',
      });
      return;
    }
    if (url.searchParams.has('principalId')) {
      writeJson(response, 400, { success: false, error: 'principalId 只能来自认证 token' });
      return;
    }
    const projectId = url.searchParams.get('projectId') ?? '';
    const runId = url.searchParams.get('runId') ?? '';
    if (!projectId || !runId) {
      writeJson(response, 400, { success: false, error: '请提供 projectId 和 runId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ workroom }) => {
      const result = await workroom.getReadiness({
        projectId,
        runId,
        authenticatedPrincipal: { principalId: authenticatedPrincipal.principalId },
      });
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
    if (!handled) {
      writeJson(response, 503, {
        success: false,
        error: 'Workroom runtime 未就绪（未安装或未初始化 @zhin.js/agent）',
      });
    }
  }, {
    summary: 'Diagnose Workroom run readiness',
    tags: ['agent', 'workroom'],
  });

  http.route('POST', `${base}/agent/workroom/control`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, {
        success: false, error: '需要绑定 principal 的 full scope 才能控制 Workroom Run',
      });
      return;
    }
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    if (Object.hasOwn(body, 'principalId') || Object.hasOwn(body, 'authenticatedPrincipalId')
      || Object.hasOwn(body, 'authority') || Object.hasOwn(body, 'authorization')) {
      writeJson(response, 400, { success: false, error: 'Workroom control 不能携带身份或权威字段' });
      return;
    }
    const agent = await import('@zhin.js/agent').catch(() => undefined);
    if (!agent) {
      writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未安装' });
      return;
    }
    let command: WorkroomRunControlCommand;
    try {
      command = agent.parseWorkroomRunControlCommand(body);
    } catch (error) {
      writeJson(response, 400, {
        success: false, error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ workroomControl }) => {
      if (!workroomControl) {
        writeJson(response, 503, { success: false, error: 'Workroom Run 控制面尚未就绪' });
        return;
      }
      try {
        const receipt = await workroomControl.execute(command, {
          principalId: authenticatedPrincipal.principalId,
        });
        if (receipt.status === 'stale') {
          writeJson(response, 409, { success: false, error: 'Workroom Run sequence 已变化', data: receipt });
          return;
        }
        writeJson(response, 200, {
          success: true,
          data: {
            status: receipt.status,
            action: receipt.action,
            operationId: receipt.operationId,
            receiptRef: receipt.receiptRef,
            receiptDigest: receipt.receiptDigest,
            run: {
              projectId: receipt.state.projectId,
              runId: receipt.state.runId,
              status: receipt.state.status,
              sequence: receipt.state.sequence,
            },
          },
        });
      } catch (error) {
        if (error instanceof agent.WorkroomRunControlUnauthorizedError) {
          writeJson(response, 403, { success: false, error: error.message });
          return;
        }
        writeJson(response, 409, {
          success: false, error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Execute authenticated typed Workroom Run control',
    tags: ['agent', 'workroom'],
  });

  http.route('GET', `${base}/agent/workroom/runs/*`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, {
        success: false, error: '需要绑定 principal 的 full scope 才能读取 Workroom Run',
      });
      return;
    }
    if (url.searchParams.has('principalId')) {
      writeJson(response, 400, { success: false, error: 'principalId 只能来自认证 token' });
      return;
    }
    const prefix = `${base}/agent/workroom/runs/`;
    const runId = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/\/+$/u, '')
      : '';
    if (!runId || runId.includes('/')) {
      writeJson(response, 404, { success: false, error: 'Run not found' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ workroom }) => {
      const projectId = url.searchParams.get('projectId') ?? '';
      if (!projectId) {
        writeJson(response, 400, { success: false, error: '请提供 projectId 查询参数' });
        return;
      }
      const result = await workroom.getRun({
        projectId,
        runId,
        authenticatedPrincipal: { principalId: authenticatedPrincipal.principalId },
      });
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
    if (!handled) {
      writeJson(response, 503, {
        success: false,
        error: 'Workroom runtime 未就绪（未安装或未初始化 @zhin.js/agent）',
      });
    }
  }, {
    summary: 'Get Workroom run',
    tags: ['agent', 'workroom'],
  });


}
