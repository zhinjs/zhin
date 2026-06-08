/**
 * Orchestration REST — Agent Mesh hard orchestration v1.
 *
 * GET /api/agent/orchestration/runs?sessionKey=
 * GET /api/agent/orchestration/runs/:runId
 */
import { getOrchestrationRuntime } from '@zhin.js/agent';
import {
  registerFetchRoute,
  type Router,
  type RouterContext,
} from '@zhin.js/host-router/router';

export function registerOrchestrationRoutes(router: Router, base: string): void {
  registerFetchRoute(router, 'GET', `${base}/agent/orchestration/runs`, async (ctx: RouterContext) => {
    const runtime = getOrchestrationRuntime();
    if (!runtime) {
      ctx.status = 503;
      ctx.body = { success: false, error: 'Orchestration runtime 未就绪' };
      return;
    }

    const sessionKey = typeof ctx.query.sessionKey === 'string' ? ctx.query.sessionKey : '';
    if (!sessionKey) {
      ctx.status = 400;
      ctx.body = { success: false, error: '请提供 sessionKey 查询参数' };
      return;
    }

    const runs = await runtime.listRuns(sessionKey);
    ctx.status = 200;
    ctx.body = { success: true, data: { sessionKey, runs } };
  });

  registerFetchRoute(router, 'GET', `${base}/agent/orchestration/runs/:runId`, async (ctx: RouterContext) => {
    const runtime = getOrchestrationRuntime();
    if (!runtime) {
      ctx.status = 503;
      ctx.body = { success: false, error: 'Orchestration runtime 未就绪' };
      return;
    }

    const runId = ctx.params.runId;
    const snapshot = await runtime.getRun(runId);
    if (!snapshot) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Run ${runId} 不存在` };
      return;
    }

    ctx.status = 200;
    ctx.body = { success: true, data: snapshot };
  });
}
