import { formatCompact, usePlugin } from '@zhin.js/core';
import type { DatabaseFeature } from '@zhin.js/core';
import {
  PageManager,
  mountConsoleRouter,
  buildEntriesResponse,
} from "@zhin.js/pagemanager/node";
import type { Router, RouterContext } from "@zhin.js/host-router";
import { Schema } from "@zhin.js/schema";
import * as path from "node:path";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/contract";
import { initConsoleHub, notifyDataUpdate, type ConsoleWebServer } from "./websocket.js";
import { registerConsoleApi, registerConsoleRoutes } from "./console-api.js";
export { registerConsoleRoutes, type ConsoleApiOptions } from "./console-api.js";
export { dispatchConsoleRpc } from "./rpc/dispatch.js";
export { createNodeProjectFs } from "./rpc/project-fs.js";
export { registerHostRestRoutes } from "./rest/host-rest-api.js";
export { registerMarketplaceRoutes } from "./rest/marketplace-rest-api.js";
export { registerLogsRoutes } from "./rest/logs-rest-api.js";
export { registerAssistantEventsRoute } from "./rest/assistant-events-rest-api.js";
export { registerAssistantJobsRoute } from "./rest/assistant-jobs-rest-api.js";
export { registerAgentSessionsRoutes } from "./rest/agent-sessions-rest-api.js";
export { registerOrchestrationRoutes } from "./rest/orchestration-rest-api.js";
export { registerIntrospectionRoutes } from "./rest/introspection-rest-api.js";
import { registerHostRestRoutes } from "./rest/host-rest-api.js";
import { registerMarketplaceRoutes } from "./rest/marketplace-rest-api.js";
import { registerLogsRoutes } from "./rest/logs-rest-api.js";
import { registerAssistantEventsRoute } from "./rest/assistant-events-rest-api.js";
import { registerAssistantJobsRoute } from "./rest/assistant-jobs-rest-api.js";
import { registerAgentSessionsRoutes } from "./rest/agent-sessions-rest-api.js";
import { registerOrchestrationRoutes } from "./rest/orchestration-rest-api.js";
import { registerIntrospectionRoutes } from "./rest/introspection-rest-api.js";
import { registerBotModels } from "./bot-db-models.js";
import { initBotPersistence } from "./bot-persistence.js";

export interface HostApiConfig {
  enabled?: boolean;
}

export { PageManager };

export const hostApiSchema = Schema.object({
  enabled: Schema.boolean().default(true).description("是否启用 Host API（管理面 REST / Console 协议）"),
  lazyLoad: Schema.boolean().default(true).description("PageManager 懒加载"),
});

declare module "@zhin.js/core" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
      router: Router;
    }
  }
}

function readHostApiConfig(appConfig: Record<string, unknown>): HostApiConfig {
  const plugins = appConfig.plugins as Record<string, unknown> | undefined;
  const fromPlugins = plugins?.hostApi as HostApiConfig | undefined;
  const topLevel = appConfig.hostApi as HostApiConfig | undefined;
  return { ...fromPlugins, ...topLevel };
}

const hostApiPlugin = usePlugin();
const { provide, root, useContext, logger, inject, onDispose, declareConfig } = hostApiPlugin;

declareConfig("hostApi", hostApiSchema, { reloadable: true });

const configService = inject("config");
const appConfig = (configService?.getPrimary() || {}) as Record<string, unknown>;
const hostApiConfig = readHostApiConfig(appConfig);
const { enabled = true } = hostApiConfig;

if (enabled) {
  registerBotModels(root as { defineModel?: (name: string, def: unknown) => void });
  initBotPersistence(root as { inject: (key: string) => unknown });

  const INIT_SYM = Symbol.for("__zhin_host_api_initialized__");
  useContext("router", "koa", async (router, koa) => {
    if ((globalThis as Record<symbol, boolean>)[INIT_SYM]) return;
    (globalThis as Record<symbol, boolean>)[INIT_SYM] = true;

    const bundlerRoot = process.env.ZHIN_PROJECT_ROOT
      ? path.resolve(process.env.ZHIN_PROJECT_ROOT)
      : process.cwd();

    const pageManager = new PageManager({
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

    registerHostRestRoutes(router, apiBase, () => root);
    registerAssistantEventsRoute(router, apiBase);
    registerAssistantJobsRoute(router, apiBase);
    registerAgentSessionsRoutes(router, apiBase);
    registerOrchestrationRoutes(router, apiBase);
    registerIntrospectionRoutes(router, apiBase, () => root);
    registerMarketplaceRoutes(router, apiBase, () => root);

    const webServer: ConsoleWebServer = {
      ws: { clients: new Set() } as ConsoleWebServer["ws"],
      entries: {},
    };

    initConsoleHub(webServer);
    registerConsoleApi(router, apiBase, () => webServer, { root });

    const dataUpdateInterval = setInterval(() => {
      notifyDataUpdate(webServer);
    }, 5000);

    onDispose(async () => {
      clearInterval(dataUpdateInterval);
    });

    provide({
      name: "web",
      description: "Host API (PageManager + management REST, no Host static UI)",
      value: pageManager,
      dispose() {
        return Promise.resolve();
      },
    });

    await hostApiPlugin.dispatch("context.mounted", "web");

    logger.info(
      formatCompact({
        服务: "Host API",
        模式: "仅API",
        入口: `${DEFAULT_CONSOLE_BASE_PATH}/entries`,
      }),
    );
  });

  useContext("database", (database: DatabaseFeature) => {
    const router = inject("router") as Router | undefined;
    if (!router) return;
    const httpCfg = (inject("config")?.getPrimary() as { http?: { base?: string } })?.http;
    const apiBase = httpCfg?.base ?? "/api";
    registerLogsRoutes(router, apiBase, {
      getLogModel: () => database.models.get("SystemLog"),
    });
  });
}
