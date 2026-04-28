import { usePlugin } from "@zhin.js/core";
import { PageManager, mountConsoleRouter } from "@zhin.js/console-core/node";
import { existsSync, readFileSync } from "node:fs";
import * as path from "path";
import { createRequire } from "node:module";
import { setupWebSocket, notifyDataUpdate } from "./websocket.js";
import { registerBotModels } from "./bot-db-models.js";
import { initBotPersistence } from "./bot-persistence.js";

export interface ConsoleConfig {
  enabled?: boolean;
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

const { provide, root, useContext, logger, inject, onDispose } = usePlugin();

const configService = inject("config");
const appConfig = (configService?.get("zhin.config.yml") || {}) as Record<string, unknown>;
const consoleConfig: ConsoleConfig =
  (appConfig.plugins as Record<string, unknown>)?.console as ConsoleConfig || {};
const { enabled = true } = consoleConfig;

if (enabled) {
  registerBotModels(root as { defineModel?: (name: string, def: unknown) => void });
  initBotPersistence(root as { inject: (key: string) => unknown });

  const INIT_SYM = Symbol.for("__zhin_console_initialized__");
  useContext("router",'koa', async (router, koa) => {
    if ((globalThis as any)[INIT_SYM]) return;
    (globalThis as any)[INIT_SYM] = true;
    const isDev = process.env.NODE_ENV === "development";
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
            if (pkg.name === "@zhin.js/console-app") { clientPackageRoot = dir; break; }
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
            "未安装 @zhin.js/console-app（@zhin.js/console 的运行时依赖）。请在项目根执行: npm install @zhin.js/console-app 或 pnpm add @zhin.js/console-app，然后重新启动。",
          );
        }
      }
    }

    const pageManager = new PageManager({
      koa: koa as import("koa"),
      path: "/console",
      clientPackageRoot,
      mode: isDev ? "development" : "production",
    });

    koa.use(mountConsoleRouter(pageManager.router));

    let attachment: Awaited<ReturnType<typeof pageManager.start>> | null = null;
    try {
      attachment = await pageManager.start();
    } catch (err) {
      logger.warn("[console] PageManager start failed (may need build):", (err as Error).message);
    }

    if (attachment && typeof attachment.bindDevWebSocket === "function" && router.server) {
      try {
        attachment.bindDevWebSocket(router.server);
      } catch (err) {
        logger.warn("[console] Farm HMR WebSocket bind failed:", (err as Error).message);
      }
    }

    const wss = router.ws("/server");
    setupWebSocket({ ws: wss } as import("./websocket.js").WebServerCompat);

    const dataUpdateInterval = setInterval(() => {
      notifyDataUpdate({ ws: wss } as import("./websocket.js").WebServerCompat);
    }, 5000);

    onDispose(async () => {
      clearInterval(dataUpdateInterval);
      if (attachment) await attachment.close();
    });

    provide({
      name: "web",
      description: "web 控制台 (PageManager)",
      value: pageManager,
      dispose() {
        return new Promise<void>((resolve) => {
          wss.close(() => resolve());
        });
      },
    });

    logger.info(
      `Web console started (${isDev ? "development" : "production"}) at /console`,
    );
  });
}
