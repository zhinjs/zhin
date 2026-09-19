import { readJsonBody, type HttpHost } from '@zhin.js/host-http';
import type { WorkroomRunControlCommand } from '@zhin.js/agent';
import type {
  PortfolioSponsorCommand,
  WorkroomDataLifecycleConsoleCommand,
  WorkroomEffectSponsorDecisionCommand,
} from '@zhin.js/agent/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { withGenerationAgentConsole } from './agent-console.js';
import { parseBoundedInteger, writeJson } from './http-response.js';

export interface RegisterAgentConsoleRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly snapshots?: SnapshotReader;
}

export function registerAgentConsoleRoutes(
  options: RegisterAgentConsoleRoutesOptions,
): void {
  const { http, base, snapshots } = options;
  // Assistant Event Ingress (M2) — needs Agent Host setAssistantRuntime.
  http.route('POST', `${base}/assistant/events`, async (request, response) => {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      writeJson(response, 400, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ assistant: runtime }) => {
      if (!runtime?.events.isEnabled()) {
        writeJson(response, 404, { success: false, error: 'assistant.events is not enabled' });
        return;
      }
      try {
        const result = await runtime.events.handle(body);
        if (!result.ok) {
          const status = result.error?.includes('rate limit') ? 429
            : result.error?.includes('not found') ? 404
              : 400;
          writeJson(response, status, { success: false, error: result.error, data: result });
          return;
        }
        writeJson(response, result.deduped ? 200 : 202, { success: true, data: result });
      } catch (error) {
        writeJson(response, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) {
      writeJson(response, 404, { success: false, error: 'assistant.events is not enabled' });
    }
  }, {
    summary: 'Assistant event ingress',
    tags: ['assistant'],
  });

  http.route('GET', `${base}/assistant/jobs`, async (_request, response) => {
    const handled = await withGenerationAgentConsole(snapshots, async ({ assistant: runtime }) => {
      if (!runtime) {
        writeJson(response, 404, { success: false, error: 'assistant.enabled is false' });
        return;
      }
      try {
        const jobs = await runtime.jobs.list();
        writeJson(response, 200, {
          success: true,
          data: { jobs, eventsActive: runtime.events.isEnabled() },
        });
      } catch (error) {
        writeJson(response, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) {
      writeJson(response, 404, { success: false, error: 'assistant.enabled is false' });
    }
  }, {
    summary: 'List assistant jobs',
    tags: ['assistant'],
  });

  // Agent Trace REST — bounded, redacted live projection from the request generation.
  http.route('GET', `${base}/agent/traces`, async (_request, response, url, authScope) => {
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '需要 full scope 才能读取 Agent Trace' });
      return;
    }
    const sessionKey = url.searchParams.get('sessionKey')?.trim() ?? '';
    if (!sessionKey || sessionKey.length > 512) {
      writeJson(response, 400, { success: false, error: '请提供有效的 sessionKey 查询参数' });
      return;
    }
    const afterSequence = parseBoundedInteger(url.searchParams.get('after'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = parseBoundedInteger(url.searchParams.get('limit'), 200, 1, 500);
    const handled = await withGenerationAgentConsole(snapshots, async ({ trace }) => {
      writeJson(response, 200, {
        success: true,
        data: trace.list(sessionKey, { afterSequence, limit }),
      });
    });
    if (!handled) {
      writeJson(response, 503, {
        success: false,
        error: 'Agent Trace runtime 未就绪（未安装或未初始化 @zhin.js/agent）',
      });
    }
  }, {
    summary: 'Read Agent turn trace',
    tags: ['agent', 'trace'],
  });

  http.route('POST', `${base}/agent/tasks/cancel`, async (request, response, _url, authScope) => {
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '需要 full scope 才能停止 Agent 任务' });
      return;
    }
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
    if (!sessionKey || sessionKey.length > 512) {
      writeJson(response, 400, { success: false, error: '请提供有效的 sessionKey' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ cancelSession }) => {
      if (!cancelSession) {
        writeJson(response, 503, { success: false, error: 'Agent 取消能力尚未就绪' });
        return;
      }
      const cancelled = cancelSession(sessionKey);
      writeJson(response, 200, {
        success: true,
        data: { sessionKey, cancelled },
        message: cancelled ? '已发送停止请求' : '当前会话没有运行中的任务',
      });
    });
    if (!handled) {
      writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
    }
  }, {
    summary: 'Cancel active Agent task',
    tags: ['agent', 'tasks'],
  });

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

  http.route('GET', `${base}/agent/workroom/portfolio`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, {
        success: false, error: '需要绑定 principal 的 full scope 才能读取 Portfolio Sponsor projection',
      });
      return;
    }
    if (url.searchParams.has('principalId')) {
      writeJson(response, 400, { success: false, error: 'principalId 只能来自认证 token' });
      return;
    }
    const portfolioId = url.searchParams.get('portfolioId')?.trim() ?? '';
    if (!portfolioId) {
      writeJson(response, 400, { success: false, error: '请提供 portfolioId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ portfolioSponsor }) => {
      if (!portfolioSponsor) {
        writeJson(response, 503, { success: false, error: 'Portfolio Sponsor projection 尚未就绪' });
        return;
      }
      const result = await portfolioSponsor.read(portfolioId, {
        principalId: authenticatedPrincipal.principalId,
      });
      if (result.status === 'forbidden') {
        writeJson(response, 403, { success: false, error: '无权读取该 Portfolio 的 Sponsor projection' });
        return;
      }
      writeJson(response, 200, { success: true, data: result.projection });
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Read content-free Portfolio Sponsor projection',
    tags: ['agent', 'workroom', 'portfolio'],
  });

  http.route('POST', `${base}/agent/workroom/portfolio/commands`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, { success: false, error: '需要绑定 principal 的 full scope credential' });
      return;
    }
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    if (Object.hasOwn(body, 'principalId') || Object.hasOwn(body, 'authenticatedPrincipalId')
      || Object.hasOwn(body, 'authority') || Object.hasOwn(body, 'discussion')) {
      writeJson(response, 400, { success: false, error: 'Sponsor command 不能携带身份、权威或 discussion 字段' });
      return;
    }
    const portfolioId = typeof body.portfolioId === 'string' ? body.portfolioId.trim() : '';
    const command = body.command as PortfolioSponsorCommand | undefined;
    if (!portfolioId || !command || typeof command !== 'object') {
      writeJson(response, 400, { success: false, error: '请提供 typed portfolioId/command' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ portfolioSponsor }) => {
      if (!portfolioSponsor) {
        writeJson(response, 503, { success: false, error: 'Portfolio Sponsor command 尚未就绪' });
        return;
      }
      try {
        const projection = await portfolioSponsor.execute(portfolioId, command, {
          principalId: authenticatedPrincipal.principalId,
        });
        writeJson(response, 200, { success: true, data: projection });
      } catch (error) {
        writeJson(response, 409, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Execute authenticated typed Portfolio Sponsor command',
    tags: ['agent', 'workroom', 'portfolio'],
  });

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

  http.route('POST', `${base}/agent/workroom/effects/sponsor-decisions`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, { success: false, error: '需要绑定 principal 的 full scope credential' });
      return;
    }
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    if (Object.hasOwn(body, 'principalId') || Object.hasOwn(body, 'authenticatedPrincipalId')
      || Object.hasOwn(body, 'authority') || Object.hasOwn(body, 'discussion')) {
      writeJson(response, 400, { success: false, error: 'Effect Sponsor decision 不能携带身份、权威或 discussion 字段' });
      return;
    }
    const command = parseEffectSponsorDecisionBody(body);
    if (!command) {
      writeJson(response, 400, {
        success: false,
        error: 'Effect Sponsor decision 仅接受 version:2 与 decision 匹配的 content-free reasonCode',
      });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ effectSponsor }) => {
      if (!effectSponsor) {
        writeJson(response, 503, { success: false, error: 'Effect Sponsor decision control 尚未就绪' });
        return;
      }
      try {
        const record = await effectSponsor.decide(command, {
          principalId: authenticatedPrincipal.principalId,
        });
        writeJson(response, 200, { success: true, data: record });
      } catch (error) {
        writeJson(response, 409, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Submit an authenticated typed Effect Sponsor decision',
    tags: ['agent', 'workroom', 'effect'],
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

function parseEffectSponsorDecisionBody(
  value: Record<string, unknown>,
): Omit<WorkroomEffectSponsorDecisionCommand, 'principalId'> | null {
  const expected = [
    'version', 'operationId', 'projectId', 'runId', 'effectIntentId',
    'effectIntentDigest', 'decision', 'reasonCode', 'decidedAt',
  ].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
    || value.version !== 2
    || typeof value.operationId !== 'string' || !value.operationId.trim()
    || typeof value.projectId !== 'string' || !value.projectId.trim()
    || typeof value.runId !== 'string' || !value.runId.trim()
    || typeof value.effectIntentId !== 'string' || !value.effectIntentId.trim()
    || typeof value.effectIntentDigest !== 'string' || !value.effectIntentDigest.startsWith('sha256:')
    || !Number.isSafeInteger(value.decidedAt) || (value.decidedAt as number) < 0) return null;
  const decision = value.decision;
  const reasonCode = value.reasonCode;
  if (decision === 'approve') {
    if (reasonCode !== 'approved_as_requested') return null;
  } else if (decision === 'reject') {
    if (!['rejected_policy', 'rejected_scope', 'rejected_risk', 'rejected_by_sponsor'].includes(
      reasonCode as string,
    )) return null;
  } else {
    return null;
  }
  return Object.freeze({ ...value }) as unknown as Omit<WorkroomEffectSponsorDecisionCommand, 'principalId'>;
}
