import Router from "@koa/router";
import type Koa from "koa";
import compose from "koa-compose";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as path from "node:path";
import type { ConsoleEntry, ConsoleFileAddEntryInput } from "@zhin.js/console-types";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";
import { createInMemoryEntryStore, type EntryStore } from "./entryStore.js";
import type {
  ConsoleServerOptions,
  PluginServerRegisterHostApi,
  ConsoleClientHostAttachment,
} from "./consoleServerOptions.js";
import { registerConsoleApiRoutes } from "./consoleApiRouter.js";
import { attachConsoleClientHost } from "./startHost.js";

export function mountConsoleRouter(router: Router): Koa.Middleware {
  return compose([router.routes(), router.allowedMethods()]) as unknown as Koa.Middleware;
}

export class PageManager {
  readonly router: Router;
  private readonly _apiRouter: Router;
  private readonly serverOptions: ConsoleServerOptions;
  static entryStore: EntryStore = createInMemoryEntryStore();

  constructor(options: ConsoleServerOptions) {
    this.serverOptions = options;
    const basePath = options.path ?? DEFAULT_CONSOLE_BASE_PATH;
    const api = new Router({ prefix: basePath });
    this._apiRouter = api;
    registerConsoleApiRoutes(api, PageManager.entryStore, options);
    if (options.router) {
      options.router.use(api.routes());
      options.router.use(api.allowedMethods());
      this.router = options.router;
    } else {
      this.router = api;
    }
  }

  private pluginServerRouteContext(): PluginServerRegisterHostApi {
    const basePath = this.serverOptions.path ?? DEFAULT_CONSOLE_BASE_PATH;
    return {
      router: this._apiRouter,
      entryStore: PageManager.entryStore,
      basePath,
      runtimeEnvHint: this.serverOptions.runtimeEnvHint,
    };
  }

  private async registerBuiltinAppShellServer(): Promise<void> {
    const clientRoot = this.serverOptions.clientPackageRoot;
    const registerAbs = path.join(clientRoot, "lib", "register.js");
    const { pathToFileURL } = await import("node:url");

    if (!existsSync(registerAbs)) {
      throw new Error(
        `[zhin-console] Built-in shell server entry not found: ${registerAbs}. Build @zhin.js/console-app first (pnpm --filter @zhin.js/console-app build:lib).`,
      );
    }

    const href = pathToFileURL(registerAbs).href;
    const mod = (await import(href)) as {
      register?: (api: PluginServerRegisterHostApi) => void | Promise<void>;
      default?: { register?: (api: PluginServerRegisterHostApi) => void | Promise<void> };
    };
    const register = mod.register ?? mod.default?.register;
    if (typeof register !== "function") {
      throw new Error(
        `[zhin-console] Built-in shell server module must export register(api): ${registerAbs}`,
      );
    }
    await Promise.resolve(register(this.pluginServerRouteContext()));
  }

  private async registerEntryServerPlugins(): Promise<void> {
    await this.registerBuiltinAppShellServer();

    const runtimeMode =
      this.serverOptions.mode ??
      (process.env.NODE_ENV === "production" ? "production" : "development");
    const mode: "development" | "production" =
      runtimeMode === "production" ? "production" : "development";
    const { pathToFileURL } = await import("node:url");

    for (const e of PageManager.entryStore.list()) {
      if (!e.serverPaths) continue;
      const abs = mode === "production" ? e.serverPaths.production : e.serverPaths.development;
      const href = pathToFileURL(abs).href;
      const mod = (await import(href)) as {
        register?: (api: PluginServerRegisterHostApi) => void | Promise<void>;
        default?: { register?: (api: PluginServerRegisterHostApi) => void | Promise<void> };
      };
      const register = mod.register ?? mod.default?.register;
      if (typeof register !== "function") {
        throw new Error(
          `[zhin-console] Entry "${e.id}" server module must export register(api) (${abs})`,
        );
      }
      await Promise.resolve(register(this.pluginServerRouteContext()));
    }
  }

  private async runServerRouteRegistrars(): Promise<void> {
    const ctx = this.pluginServerRouteContext();
    for (const reg of this.serverOptions.serverRouteRegistrars ?? []) {
      await Promise.resolve(reg(ctx));
    }
  }

  async start(): Promise<ConsoleClientHostAttachment> {
    await this.registerEntryServerPlugins();
    await this.runServerRouteRegistrars();

    const clientPackageRoot = this.serverOptions.clientPackageRoot;
    const consoleBasePath = this.serverOptions.path ?? DEFAULT_CONSOLE_BASE_PATH;
    const mode =
      this.serverOptions.mode ??
      (process.env.NODE_ENV === "production" ? "production" : "development");
    const farmConfigPath =
      this.serverOptions.farmConfigPath ?? path.join(clientPackageRoot, "farm.config.ts");
    const port = this.serverOptions.port ?? Number(process.env.PORT ?? 3001);

    return attachConsoleClientHost(this.serverOptions.koa, {
      clientPackageRoot,
      farmConfigPath,
      mode,
      port,
      farmServerPort: this.serverOptions.farmServerPort,
      farmStrictPort: this.serverOptions.farmStrictPort,
      consoleBasePath,
    });
  }

  static addEntry(input: ConsoleFileAddEntryInput) {
    const id =
      input.id ??
      `${path.basename(input.production, path.extname(input.production))}-${createHash("sha256").update(input.production).digest("hex").slice(0, 8)}`;

    const entry: ConsoleEntry = {
      id,
      paths: { development: input.development, production: input.production },
      order: input.order,
      enabled: input.enabled,
      meta: input.meta,
      requiredPermissions: input.requiredPermissions,
    };
    if (input.serverDevelopment != null && input.serverProduction != null) {
      entry.serverPaths = {
        development: input.serverDevelopment,
        production: input.serverProduction,
      };
    }
    PageManager.entryStore.add(entry);
  }
}
