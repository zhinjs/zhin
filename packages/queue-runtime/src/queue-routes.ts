import type { RouteTable, RouterContext } from "@zhin.js/http-host";
import type { QueueRuntime } from "./runtime.js";

export function registerQueueRoutes(
  table: RouteTable,
  base: string,
  runtime: QueueRuntime,
): void {
  table.post(`${base}/queue/incoming`, async (ctx: RouterContext) => {
    try {
      const envelope = await runtime.handleIncoming(ctx.request.body);
      ctx.body = { success: true, data: envelope };
    } catch (e) {
      ctx.status = 400;
      ctx.body = { success: false, error: (e as Error).message };
    }
  });

  table.get(`${base}/queue/outgoing`, async (ctx: RouterContext) => {
    const records = await runtime.listOutgoing();
    ctx.body = { success: true, data: records };
  });

  table.post(`${base}/queue/claim`, async (ctx: RouterContext) => {
    const body = (ctx.request.body ?? {}) as { workerId?: string };
    const workerId = body.workerId ?? "default";
    const claimed = await runtime.claimOutgoing(workerId);
    ctx.body = { success: true, data: claimed };
  });
}
