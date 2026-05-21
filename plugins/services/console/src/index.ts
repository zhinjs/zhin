import { formatCompact, usePlugin } from '@zhin.js/core';
import {
  PageManager,
  mountConsoleRouter,
  buildEntriesResponse,
} from "@zhin.js/console-core/node";
import type { RouterContext } from "@zhin.js/http";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

    const require = createRequire(import.meta.url);
    let clientPackageRoot: string;
    try {
      const appPkg = require.resolve("@zhin.js/console-app/package.json");
      clientPackageRoot = path.dirname(appPkg);
    } catch {
      try {
        const entry = require.resolve("@zhin.js/console-app");
        let dir = path.dirname(entry);
        while (dir !== path.dirname(dir)) {
          if (existsSync(path.join(dir, "package.json"))) {
            const pkg = JSON.parse(
              readFileSync(path.join(dir, "package.json"), "utf8"),
            );
            if (pkg.name === "@zhin.js/console-app") {
              clientPackageRoot = dir;
              break;
            }
          }
          dir = path.dirname(dir);
        }
        clientPackageRoot ??= path.dirname(entry);
      } catch {
        const monorepoDev = path.resolve(import.meta.dirname, "../../../../packages/console-app");
        if (existsSync(path.join(monorepoDev, "lib", "register.js"))) {
          clientPackageRoot = monorepoDev;
        } else {
          throw new Error(
            "未安装 @zhin.js/console-app。请在项目根执行: pnpm add @zhin.js/console-app",
          );
        }
      }
    }

    const pageManager = new PageManager({
      koa: koa as import("koa"),
      path: DEFAULT_CONSOLE_BASE_PATH,
      clientPackageRoot,
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
