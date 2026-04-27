import type { Context } from "koa";
import type { PluginServerRegisterHostApi } from "@zhin.js/console-core/node";
import { rewriteEntriesForClient, serverRuntimeEnv } from "@zhin.js/console-core/node";
import type { ConsoleClientEntry } from "@zhin.js/console-types";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";

export function register(api: PluginServerRegisterHostApi): void {
  const { router, entryStore } = api;
  const basePath = api.basePath ?? DEFAULT_CONSOLE_BASE_PATH;
  const serverEnv = serverRuntimeEnv();

  router.get("/entries", async (ctx: Context) => {
    const list = entryStore
      .list()
      .filter((e) => e.enabled !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    let clientEntries: ConsoleClientEntry[];
    try {
      clientEntries = rewriteEntriesForClient({ entries: list, serverEnv, basePath });
    } catch (err) {
      ctx.status = 500;
      ctx.body = { message: err instanceof Error ? err.message : "Failed to prepare entries" };
      return;
    }

    ctx.body = {
      entries: clientEntries,
      runtimeEnvHint: api.runtimeEnvHint ?? serverEnv,
    };
  });
}
