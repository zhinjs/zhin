import { formatCompact, usePlugin } from '@zhin.js/core';
import {
  PageManager,
  mountConsoleRouter,
  buildEntriesResponse,
} from "@zhin.js/console-core/node";
import type { RouterContext } from "@zhin.js/http";
import * as path from "node:path";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";
import { initConsoleHub, notifyDataUpdate, type ConsoleWebServer } from "./websocket.js";
import { registerConsoleApi, registerConsoleRoutes } from "./console-api.js";
export { registerConsoleRoutes, type ConsoleApiOptions } from "./console-api.js";
export { dispatchConsoleRpc } from "./rpc/dispatch.js";
export { createNodeProjectFs } from "./rpc/project-fs.js";
import { registerBotModels } from "./bot-db-models.js";
import { initBotPersistence } from "./bot-persistence.js";

export interface ConsoleConfig {
  enabled?: boolean;
}

export { PageManager };

declare module "@zhin.js/core" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
      router: import("@zhin.js/http").Router;
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
      // Host @zhin.js/http 注入 Koa 3；console-core 类型仍为 Koa 2，运行时兼容
      koa: koa as never,
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

    const webServer: ConsoleWebServer = {
      ws: { clients: new Set() } as ConsoleWebServer["ws"],
      entries: {},
    };

    initConsoleHub(webServer);
    // 必须传入 bot 根插件：HTTP 请求不在 usePlugin() 的 ALS 上下文中，否则会新建空 Plugin 导致 bot:list 恒为 []
    registerConsoleApi(router, apiBase, () => webServer, { root });

    const dataUpdateInterval = setInterval(() => {
      notifyDataUpdate(webServer);
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
        服务: "控制台",
        模式: "仅API",
        入口: `${DEFAULT_CONSOLE_BASE_PATH}/entries`,
      }),
    );
  });
}
