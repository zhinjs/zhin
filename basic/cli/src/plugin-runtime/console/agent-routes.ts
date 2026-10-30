import { readJsonBody, isProjectPathAllowed, type HttpHost } from '@zhin.js/host-http';
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { withGenerationAgentConsole } from './agent-console.js';
import { parseBoundedInteger, writeJson } from './http-response.js';
import { registerWorkroomConsoleRoutes } from './workroom-routes.js';
import { registerTraceArchiveRoutes } from './trace-archive-routes.js';

export interface RegisterAgentConsoleRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly snapshots?: SnapshotReader;
  /** Enables the persistent trace archive routes (#728). */
  readonly projectRoot?: string;
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
      const snapshot = trace.list(sessionKey, { afterSequence, limit });
      writeJson(response, 200, {
        success: true,
        data: { ...snapshot, events: await projectTraceFiles(snapshot.events, options.projectRoot) },
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
  if (options.projectRoot) registerTraceArchiveRoutes({ http, base, projectRoot: options.projectRoot });

}

/** Adds navigation hints only; file reads still enforce the existing project-file RPC policy. */
async function projectTraceFiles(
  events: readonly Record<string, unknown>[],
  projectRoot?: string,
): Promise<readonly Record<string, unknown>[]> {
  if (!projectRoot) return events;
  let root: Promise<string | undefined> | undefined;
  const references = new Map<string, Promise<{ path: string } | undefined>>();
  const resolve = async (absolute: string): Promise<{ path: string } | undefined> => {
    root ??= realpath(projectRoot).catch(() => undefined);
    const canonicalRoot = await root;
    if (!canonicalRoot) return undefined;
    try {
      const canonicalFile = await realpath(absolute);
      const relative = path.relative(canonicalRoot, canonicalFile).split(path.sep).join('/');
      return isProjectPathAllowed(relative) ? { path: relative } : undefined;
    } catch {
      // Missing or unreadable paths do not change the original tool result.
      return undefined;
    }
  };
  return Promise.all(events.map(async event => {
    const data = event.data;
    if (event.type !== 'tool_result' || !data || typeof data !== 'object' || Array.isArray(data)
      || !('toolName' in data) || (data.toolName !== 'write_file' && data.toolName !== 'edit_file')
      || !('fileChange' in data)) return event;
    const evidence = data.fileChange;
    if (!evidence || typeof evidence !== 'object' || !('path' in evidence) || typeof evidence.path !== 'string'
      || !path.isAbsolute(evidence.path)
      // Agent Trace uses this exact suffix when its string projection was truncated.
      || evidence.path.endsWith('… [truncated]')) return event;
    let reference = references.get(evidence.path);
    if (!reference) { reference = resolve(evidence.path); references.set(evidence.path, reference); }
    const projectFile = await reference;
    return projectFile ? { ...event, data: { ...data, projectFile } } : event;
  }));
}
