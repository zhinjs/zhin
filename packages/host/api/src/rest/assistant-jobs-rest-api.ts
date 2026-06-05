/**
 * GET /api/assistant/jobs — 列出 Assistant JobStore 记录
 */
import {
  getAssistantRuntime,
  isAssistantEventsActive,
} from "@zhin.js/agent";
import {
  registerFetchRoute,
  type Router,
  type RouterContext,
} from "@zhin.js/host-router/router";

export function registerAssistantJobsRoute(router: Router, base: string): void {
  registerFetchRoute(router, "GET", `${base}/assistant/jobs`, async (ctx: RouterContext) => {
    const runtime = getAssistantRuntime();
    if (!runtime?.config.enabled) {
      ctx.status = 404;
      ctx.body = { success: false, error: "assistant.enabled is false" };
      return;
    }

    const jobs = await runtime.engine.listAssistantJobs();
    ctx.status = 200;
    ctx.body = {
      success: true,
      data: {
        jobs,
        eventsActive: isAssistantEventsActive(runtime.config),
      },
    };
  });
}
