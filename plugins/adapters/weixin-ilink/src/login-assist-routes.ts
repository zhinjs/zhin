/**
 * loginAssist HTTP 路由（供 Web 控制台消费扫码等待等待办）
 */
import type { Router } from "@zhin.js/host-router";
import type { Plugin } from "zhin.js";

export function registerLoginAssistRoutes(router: Router, root: Plugin): void {
  const loginAssist = root.inject("loginAssist");
  if (!loginAssist) return;

  router.get("/api/login-assist/pending", async (ctx) => {
    ctx.body = loginAssist.listPending();
  });

  router.post("/api/login-assist/submit", async (ctx: any) => {
    const body = (ctx.request.body ?? {}) as { id?: string; value?: string | Record<string, unknown> };
    if (!body.id) {
      ctx.status = 400;
      ctx.body = { success: false, message: "missing id" };
      return;
    }
    const ok = loginAssist.submit(body.id, body.value ?? "");
    ctx.body = { success: ok };
  });

  router.post("/api/login-assist/cancel", async (ctx: any) => {
    const body = (ctx.request.body ?? {}) as { id?: string; reason?: string };
    if (!body.id) {
      ctx.status = 400;
      ctx.body = { success: false, message: "missing id" };
      return;
    }
    const ok = loginAssist.cancel(body.id, body.reason);
    ctx.body = { success: ok };
  });
}
