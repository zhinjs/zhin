import { readJsonBody, type HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { withGenerationAgentConsole } from './agent-console.js';
import { parseBoundedInteger, writeJson } from './http-response.js';
import { registerWorkroomConsoleRoutes } from './workroom-routes.js';

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

  registerWorkroomConsoleRoutes({ http, base, snapshots });

}
