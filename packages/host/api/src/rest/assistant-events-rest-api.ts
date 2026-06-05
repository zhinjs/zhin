/**
 * POST /api/assistant/events — Assistant Event Ingress（M2）
 */
import {
  getAssistantRuntime,
  isAssistantEventsEndpointActive,
} from "@zhin.js/agent";
import {
  registerFetchRoute,
  type Router,
  type RouterContext,
} from "@zhin.js/host-router/router";

export function registerAssistantEventsRoute(router: Router, base: string): void {
  router.post(`${base}/assistant/events`, async (ctx: RouterContext) => {
    if (!isAssistantEventsEndpointActive()) {
      ctx.status = 404;
      ctx.body = { success: false, error: "assistant.events is not enabled" };
      return;
    }

    const runtime = getAssistantRuntime();
    if (!runtime?.ingress) {
      ctx.status = 503;
      ctx.body = { success: false, error: "assistant runtime unavailable" };
      return;
    }

    const body = ctx.request.body;
    const result = await runtime.ingress.handle(body);

    if (!result.ok) {
      const status = result.error?.includes("rate limit") ? 429
        : result.error?.includes("not found") ? 404
          : 400;
      ctx.status = status;
      ctx.body = { success: false, error: result.error, data: result };
      return;
    }

    ctx.status = result.deduped ? 200 : 202;
    ctx.body = { success: true, data: result };
  });
}
