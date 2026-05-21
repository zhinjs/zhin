import { formatCompact, usePlugin } from '@zhin.js/core';
import {
  PageManager,
  mountConsoleRouter,
  buildEntriesResponse,
} from "@zhin.js/console-core/node";
import type { RouterContext } from "@zhin.js/http";
import * as path from "node:path";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";
import { initConsoleHub, notifyDataUpdate, type WebServerCompat } from "./websocket.js";
import { registerConsoleApi } from "./console-api.js";
import { registerBotModels } from "./bot-db-models.js";
import { initBotPersistence } from "./bot-persistence.js";

export interface ConsoleConfig {
  enabled?: boolean;
  /** @deprecated Host 不再提供静态 UI；保留字段兼容旧配置 */
  port?: number;
}

export { PageManager };

declare module "@zhin.js/core" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
      router: import("@zhin.js/http").Router;
      koa: import("koa");
    }
  }
}

const consolePlugin = usePlugin();
const { provide, root, useContext, logger, inject, onDispose } = consolePlugin;

const configService = inject("config");
const appConfig = (configService?.getPrimary() || {}) as Record<string, unknown>;
const consoleConfig: ConsoleConfig =
  (appConfig.plugins as Record<string, unknown>)?.console as ConsoleConfig || {};
const { enabled = true } = consoleConfig;

if (enabled) {
  registerBotModels(root as { defineModel?: (name: string, def: unknown) => void });
  initBotPersistence(root as { inject: (key: string) => unknown });

  const INIT_SYM = Symbol.for("__zhin_console_initialized__");
  useContext("router", "koa", async (router, koa) => {
    if ((globalThis as any)[INIT_SYM]) return;
    (globalThis as any)[INIT_SYM] = true;

    const bundlerRoot = process.env.ZHIN_PROJECT_ROOT
      ? path.resolve(process.env.ZHIN_PROJECT_ROOT)
      : process.cwd();

    const pageManager = new PageManager({
      koa: koa as import("koa"),
      path: DEFAULT_CONSOLE_BASE_PATH,
      clientPackageRoot: bundlerRoot,
      mode: "production",
      serveClientHost: false,
    });

    try {
      await pageManager.start();
    } catch (err) {
      logger.warn(
        formatCompact({ op: "page_manager", ok: false, error: (err as Error).message }),
      );
    }

    koa.use(mountConsoleRouter(pageManager.router));

    router.get("/entries", async (ctx: RouterContext) => {
      try {
        ctx.body = buildEntriesResponse(
          pageManager.entryStore,
          DEFAULT_CONSOLE_BASE_PATH,
        );
      } catch (err) {
        ctx.status = 500;
        ctx.body = {
          message: err instanceof Error ? err.message : "Failed to prepare entries",
        };
      }
    });

    const configServiceHttp = inject("config");
    const httpCfg = (configServiceHttp?.getPrimary() as { http?: { base?: string } })?.http;
    const apiBase = httpCfg?.base ?? "/api";

    const webServerCompat: WebServerCompat = {
      ws: { clients: new Set() } as WebServerCompat["ws"],
      entries: {},
    };

    initConsoleHub(webServerCompat);
    registerConsoleApi(router, apiBase, () => webServerCompat);

    const dataUpdateInterval = setInterval(() => {
      notifyDataUpdate(webServerCompat);
    }, 5000);

    onDispose(async () => {
      clearInterval(dataUpdateInterval);
    });

    provide({
      name: "web",
      description: "Console API (PageManager, no Host static UI)",
      value: pageManager,
      dispose() {
        return Promise.resolve();
      },
    });

    await consolePlugin.dispatch("context.mounted", "web");

    logger.info(
      formatCompact({
        op: "console",
        mode: "api_only",
        entries: `${DEFAULT_CONSOLE_BASE_PATH}/entries`,
      }),
    );
  });
}
