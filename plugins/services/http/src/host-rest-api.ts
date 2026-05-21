/**
 * Host 与 Edge 共用的 REST 路由（Fetch RouteTable）。
 * Console 连接常用：/entries、/api/system/status、/api/stats、/api/plugins、/api/bots、/api/config、/api/schemas 等。
 */
import { Adapter, Feature, type Plugin } from "zhin.js";
import {
  getSystemStatusData,
  registerFetchRoute,
  registerSystemStatusRoute,
  type RouteTable,
  type RouterContext,
} from "@zhin.js/http-host/edge";

export type EntriesResponseBody = {
  entries: unknown[];
  runtimeEnvHint: "development" | "production";
};

function collectFeatures(root: Plugin): Feature[] {
  const features: Feature[] = [];
  for (const [, context] of root.contexts) {
    if (context.value instanceof Feature) {
      features.push(context.value);
    }
  }
  return features;
}

/** GET /entries — Remote Console 插件发现（Edge 可为空列表） */
export function registerEntriesRoute(
  table: RouteTable,
  options: { getBody?: () => EntriesResponseBody } = {},
): void {
  const getBody =
    options.getBody ??
    (() => ({
      entries: [],
      runtimeEnvHint:
        (typeof process !== "undefined" && process.env?.NODE_ENV === "production"
          ? "production"
          : "development") as EntriesResponseBody["runtimeEnvHint"],
    }));
  registerFetchRoute(table, "GET", "/entries", (ctx: RouterContext) => {
    ctx.body = getBody();
  });
}

/** 不含 marketplace / logs（仍由 Host 插件单独注册） */
export function registerHostRestRoutes(
  table: RouteTable,
  base: string,
  getRoot: () => Plugin,
): void {
  registerSystemStatusRoute(table, base);

  registerFetchRoute(table, "GET", `${base}/stats`, async (ctx: RouterContext) => {
    const root = getRoot();
    const status = getSystemStatusData();
    let botCount = 0;
    let onlineBotCount = 0;
    for (const adapterName of root.adapters) {
      const adapter = root.inject(adapterName);
      if (adapter instanceof Adapter) {
        botCount += adapter.bots.size;
        for (const bot of adapter.bots.values()) {
          if ((bot as { $connected?: boolean }).$connected) onlineBotCount++;
        }
      }
    }
    const commandService = root.inject("command");
    const componentService = root.inject("component");
    const heap =
      typeof status.memory.heapUsed === "number"
        ? status.memory.heapUsed / 1024 / 1024
        : 0;
    ctx.body = {
      success: true,
      data: {
        plugins: { total: root.children.length, active: root.children.length },
        bots: { total: botCount, online: onlineBotCount },
        commands: commandService?.items.length || 0,
        components: componentService?.byName?.size || 0,
        uptime: status.uptime,
        memory: heap,
        runtime: status.runtime,
      },
    };
  });

  registerFetchRoute(table, "GET", `${base}/plugins`, async (ctx: RouterContext) => {
    const root = getRoot();
    const featureServices = collectFeatures(root);
    const plugins = root.children.map((p) => {
      const features = featureServices
        .map((f) => f.toJSON(p.name))
        .filter((f) => f.count > 0);
      return {
        name: p.name,
        status: p.started ? "active" : "inactive",
        description: (p.manifest as { description?: string } | undefined)?.description || p.name,
        features,
      };
    });
    ctx.body = { success: true, data: plugins, total: plugins.length };
  });

  registerFetchRoute(table, "GET", `${base}/plugins/:name`, async (ctx: RouterContext) => {
    const root = getRoot();
    const pluginName = ctx.params.name;
    const plugin = root.children.find((p) => p.name === pluginName);
    if (!plugin) {
      ctx.status = 404;
      ctx.body = { success: false, error: "插件不存在" };
      return;
    }
    const featureServices = collectFeatures(root);
    const features = featureServices
      .map((f) => f.toJSON(pluginName))
      .filter((f) => f.count > 0);
    const contexts = Array.from(plugin.contexts.entries()).map(([name]) => ({ name }));
    ctx.body = {
      success: true,
      data: {
        name: plugin.name,
        filename: plugin.filePath,
        filePath: plugin.filePath,
        status: plugin.started ? "active" : "inactive",
        description: (plugin.manifest as { description?: string } | undefined)?.description || plugin.name,
        features,
        contexts,
      },
    };
  });

  registerFetchRoute(table, "GET", `${base}/bots`, async (ctx: RouterContext) => {
    const root = getRoot();
    const bots: Array<{
      name: string;
      adapter: string;
      connected: boolean;
      status: "online" | "offline";
    }> = [];
    for (const name of root.adapters) {
      const adapter = root.inject(name);
      if (adapter instanceof Adapter) {
        for (const [botName, bot] of adapter.bots.entries()) {
          bots.push({
            name: botName,
            adapter: String(name),
            connected: !!(bot as { $connected?: boolean }).$connected,
            status: (bot as { $connected?: boolean }).$connected ? "online" : "offline",
          });
        }
      }
    }
    ctx.body = { success: true, data: bots, total: bots.length };
  });

  registerFetchRoute(table, "GET", `${base}/config`, async (ctx: RouterContext) => {
    const configService = getRoot().inject("config");
    ctx.body = { success: true, data: configService?.getPrimary?.() ?? {} };
  });

  registerFetchRoute(table, "GET", `${base}/config/:name`, async (ctx: RouterContext) => {
    const root = getRoot();
    const { name } = ctx.params;
    const configService = root.inject("config");
    if (name === "app") {
      ctx.body = { success: true, data: configService?.getPrimary?.() ?? {} };
      return;
    }
    const plugin = root.children.find((p) => p.name === name);
    if (!plugin) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Plugin ${name} not found` };
      return;
    }
    ctx.body = { success: true, data: { name: plugin.name, filePath: plugin.filePath } };
  });

  registerFetchRoute(table, "POST", `${base}/config/:name`, async (ctx: RouterContext) => {
    const root = getRoot();
    const { name } = ctx.params;
    if (name === "app") {
      ctx.body = { success: true, message: "App configuration update not implemented yet" };
      return;
    }
    const plugin = root.children.find((p) => p.name === name);
    if (!plugin) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Plugin ${name} not found` };
      return;
    }
    ctx.body = { success: true, message: "Plugin configuration update not implemented yet" };
  });

  registerFetchRoute(table, "GET", `${base}/schemas`, async (ctx: RouterContext) => {
    const schemaService = getRoot().inject("schema" as never) as unknown as {
      items: Map<string, { toJSON: () => unknown }>;
    } | null;
    const schemas: Record<string, unknown> = {};
    if (schemaService?.items) {
      for (const [name, schema] of schemaService.items.entries()) {
        schemas[name] = schema.toJSON();
      }
    }
    ctx.body = { success: true, data: schemas };
  });

  registerFetchRoute(table, "GET", `${base}/schema/:name`, async (ctx: RouterContext) => {
    const schemaService = getRoot().inject("schema" as never) as unknown as {
      get: (n: string) => { toJSON: () => unknown } | undefined;
    } | null;
    const schema = schemaService?.get(ctx.params.name);
    ctx.body = { success: true, data: schema ? schema.toJSON() : null };
  });

  registerFetchRoute(table, "POST", `${base}/message/send`, async (ctx: RouterContext) => {
    const root = getRoot();
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const context = String(body.context ?? "");
    const bot = String(body.bot ?? "");
    const id = String(body.id ?? "");
    const type = String(body.type ?? "");
    const content = body.content;
    if (!context || !bot || !id || !type || content === undefined || content === null) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: "Missing required fields: context, bot, id, type, content",
      };
      return;
    }
    try {
      const adapter = root.inject(context as keyof Plugin.Contexts);
      if (!adapter || !(adapter instanceof Adapter)) {
        ctx.status = 404;
        ctx.body = { success: false, error: `Adapter not found or not sendable: ${context}` };
        return;
      }
      const normalizedContent =
        typeof content === "string" ? content : Array.isArray(content) ? content : String(content);
      const msgId = await adapter.sendMessage({
        context,
        bot,
        id,
        type: type as "private" | "group" | "channel",
        content: normalizedContent,
      });
      ctx.body = {
        success: true,
        message: "Message sent successfully",
        data: { context, bot, id, type, messageId: msgId, timestamp: new Date().toISOString() },
      };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: "Message sending failed" };
    }
  });
}
