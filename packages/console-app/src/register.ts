import type { Context } from "koa";
import type { PluginServerRegisterHostApi } from "@zhin.js/console-core/node";
import { buildEntriesResponse } from "@zhin.js/console-core/node";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";

export function register(api: PluginServerRegisterHostApi): void {
  const { router, entryStore } = api;
  const basePath = api.basePath ?? DEFAULT_CONSOLE_BASE_PATH;

  router.get("/entries", async (ctx: Context) => {
    try {
      ctx.body = buildEntriesResponse(entryStore, basePath, api.runtimeEnvHint);
    } catch (err) {
      ctx.status = 500;
      ctx.body = { message: err instanceof Error ? err.message : "Failed to prepare entries" };
    }
  });
}
