import { usePlugin, DatabaseFeature, Models, Adapter, SystemLog, Plugin } from "zhin.js";
import { Schema } from "@zhin.js/schema";
import { createServer, Server } from "http";
import os from "node:os";
import Koa from "koa";
import auth from "koa-basic-auth";
import body, { KoaBodyMiddlewareOptionsSchema } from "koa-body";
import { Router, RouterContext} from "./router.js";

export * from "./router.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      koa: Koa;
      router: Router;
      server: Server;
    }
  }
}

// Schema 定义
export const httpSchema = Schema.object({
  port: Schema.number().default(8086).description("HTTP 服务端口"),
  username: Schema.string().description(
    "HTTP 基本认证用户名, 默认为当前系统用户名"
  ),
  password: Schema.string().description(
    "HTTP 基本认证密码, 默认为随机生成的6位字符串"
  ),
  base: Schema.string()
    .default("/api")
    .description("HTTP 路由前缀, 默认为 /api"),
});

export interface HttpConfig {
  port?: number;
  host?: string;
  username?: string;
  password?: string;
  base?: string;
  /** 是否信任反向代理（Cloudflare、Nginx 等）的 X-Forwarded-* 头，部署在代理后时建议设为 true */
  trustProxy?: boolean;
}

// 获取当前计算机登录用户名
const getCurrentUsername = () => {
  try {
    return os.userInfo().username;
  } catch {
    return "admin";
  }
};

// 生成6位随机密码
const generateRandomPassword = () => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 6 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
};

const { provide, root, useContext, logger } = usePlugin();

// 创建实例
const koa = new Koa();
const server = createServer(koa.callback());
const router = new Router(server, { prefix: process.env.routerPrefix || "" });

// 注册 server 上下文
provide({
  name: "server",
  description: "http server",
  value: server,
  dispose(s) {
    s.close();
  },
});

// 使用配置服务
useContext("config", (configService) => {
  const appConfig = configService.getPrimary<{ http?: HttpConfig }>();
  const httpConfig = appConfig.http || {};
  const {
    port = 8086,
    host = "127.0.0.1",
    username = getCurrentUsername(),
    password = generateRandomPassword(),
    base = "/api",
    trustProxy = false,
  } = httpConfig;

  // 反向代理场景下信任 X-Forwarded-Host / X-Forwarded-Proto 等
  koa.proxy = trustProxy;

  // 设置基本认证
  koa.use(auth({ name: username, pass: password }));

  // ============================================================================
  // API 路由
  // ============================================================================

  // 系统状态 API
  router.get(`${base}/system/status`, async (ctx) => {
    ctx.body = {
      success: true,
      data: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        platform: process.platform,
        nodeVersion: process.version,
        pid: process.pid,
        timestamp: new Date().toISOString(),
      },
    };
  });

  // 健康检查 API
  router.get(`${base}/health`, async (ctx) => {
    ctx.body = {
      success: true,
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  });

  // 统计信息 API
  router.get(`${base}/stats`, async (ctx) => {
    const allPlugins = root.children;

    // 统计机器人数量
    let botCount = 0;
    let onlineBotCount = 0;
    for (const adapterName of root.adapters) {
      const adapter=root.inject(adapterName)
      if (adapter instanceof Adapter) {
        botCount += adapter.bots.size;
        for (const bot of adapter.bots.values()) {
          if (bot.$connected) onlineBotCount++;
        }
      }
    }

    // 统计命令和组件
    const commandService = root.inject("command");
    const componentService = root.inject("component");
    const commandCount = commandService?.items.length || 0;
    const componentCount = componentService?.byName.size || 0;

    ctx.body = {
      success: true,
      data: {
        plugins: { total: allPlugins.length, active: allPlugins.length },
        bots: { total: botCount, online: onlineBotCount },
        commands: commandCount,
        components: componentCount,
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed / 1024 / 1024,
      },
    };
  });

  // 插件列表 API
  router.get(`${base}/plugins`, async (ctx) => {
    const plugins = root.children.map((p) => ({
      name: p.name,
      status: "active",
      description: p.name,
      features: p.getFeatures(),
    }));
    ctx.body = { success: true, data: plugins, total: plugins.length };
  });

  // 插件详情 API
  router.get(`${base}/plugins/:name`, async (ctx) => {
    const pluginName = ctx.params.name;
    const plugin = root.children.find((p) => p.name === pluginName);

    if (!plugin) {
      ctx.status = 404;
      ctx.body = { success: false, error: "插件不存在" };
      return;
    }

    const features = plugin.getFeatures();

    // 收集 features 中已展示的上下文名（adapter/service items 的 name）
    const shownContextNames = new Set<string>();
    for (const f of features) {
      if (f.name === 'adapter' || f.name === 'service') {
        for (const item of f.items) {
          if (item.name) shownContextNames.add(item.name);
        }
      }
    }
    // 过滤掉已在 features 中展示的上下文
    const contexts = Array.from(plugin.contexts.entries())
      .filter(([name]) => !shownContextNames.has(name))
      .map(([name]) => ({ name }));

    ctx.body = {
      success: true,
      data: {
        name: plugin.name,
        filename: plugin.filePath,
        filePath: plugin.filePath,
        status: "active",
        description: plugin.name,
        features,
        contexts,
      },
    };
  });

  // 机器人列表 API
  router.get(`${base}/bots`, async (ctx) => {
    interface BotInfo {
      name: string;
      adapter: string;
      connected: boolean;
      status: "online" | "offline";
    }
    const bots: BotInfo[] = [];

    for (const name of root.adapters) {
      const adapter = root.inject(name);
      if (adapter instanceof Adapter) {
        for (const [botName, bot] of adapter.bots.entries()) {
          bots.push({
            name: botName,
            adapter: name,
            connected: bot.$connected || false,
            status: bot.$connected ? "online" : "offline",
          });
        }
      }
    }

    ctx.body = { success: true, data: bots, total: bots.length };
  });

  // 配置 API
  router.get(`${base}/config`, async (ctx) => {
    ctx.body = { success: true, data: configService.get("zhin.config.yml") };
  });

  router.get(`${base}/config/:name`, async (ctx) => {
    const { name } = ctx.params;

    if (name === "app") {
      ctx.body = { success: true, data: configService.get("zhin.config.yml") };
      return;
    }

    const plugin = root.children.find((p) => p.name === name);
    if (!plugin) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Plugin ${name} not found` };
      return;
    }

    ctx.body = {
      success: true,
      data: { name: plugin.name, filePath: plugin.filePath },
    };
  });

  router.post(`${base}/config/:name`, async (ctx) => {
    const { name } = ctx.params;

    if (name === "app") {
      ctx.body = {
        success: true,
        message: "App configuration update not implemented yet",
      };
      return;
    }

    const plugin = root.children.find((p) => p.name === name);
    if (!plugin) {
      ctx.status = 404;
      ctx.body = { success: false, error: `Plugin ${name} not found` };
      return;
    }

    ctx.body = {
      success: true,
      message: "Plugin configuration update not implemented yet",
    };
  });

  // Schema API - 获取所有插件 Schema
  router.get(`${base}/schemas`, async (ctx) => {
    const schemaService = root.inject('schema' as any);
    const schemas: Record<string, any> = {};
    if (schemaService) {
      for (const [name, schema] of (schemaService as any).items.entries()) {
        schemas[name] = schema.toJSON();
      }
    }
    ctx.body = { success: true, data: schemas };
  });

  // Schema API - 获取单个插件 Schema
  router.get(`${base}/schema/:name`, async (ctx:RouterContext) => {
    const schemaService = root.inject('schema' as any);
    const { name } = ctx.params;
    const schema = (schemaService as any)?.get(name);
    
    if (!schema) {
      ctx.body = { success: true, data: null };
      return;
    }
    
    ctx.body = { success: true, data: schema.toJSON() };
  });

  // 消息发送 API
  router.post(`${base}/message/send`, async (ctx:RouterContext) => {
    interface SendMessageBody {
      context: string;
      bot: string;
      id: string;
      type: string;
      content: unknown;
    }
    const body = ctx.request.body as SendMessageBody;
    const { context, bot, id, type, content } = body;

    if (!context || !bot || !id || !type || !content) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: "Missing required fields: context, bot, id, type, content",
      };
      return;
    }

    ctx.body = {
      success: true,
      message: "Message sent successfully",
      data: {
        context,
        bot,
        id,
        type,
        content,
        timestamp: new Date().toISOString(),
      },
    };
  });
  server.listen({ host, port }, () => {
    const address = server.address();
    if (!address) return;
    const visitAddress =
      typeof address === "string"
        ? address
        : `${host}:${address.port}`;
    const apiUrl = `http://${visitAddress}${base}`;

    logger.info(`HTTP 服务已启动 (port=${port}, api=${apiUrl}, user=${username})`);
  });
});

// 使用数据库服务（可选）
useContext("database", (database: DatabaseFeature) => {
  const configService = root.inject("config")!;
  const appConfig = configService.getPrimary<{ http?: HttpConfig }>();
  const base = appConfig.http?.base || "/api";

  // 日志 API - 获取日志
  router.get(`${base}/logs`, async (ctx) => {
    const limit = parseInt(ctx.query.limit as string) || 100;
    const level = ctx.query.level as string;

    const LogModel = database.models.get("SystemLog");
    if (!LogModel) {
      ctx.status = 500;
      ctx.body = { success: false, error: "SystemLog model not found" };
      return;
    }

    let selection = LogModel.select();
    if (level && level !== "all") {
      selection = selection.where({ level });
    }

    const logs = await selection.orderBy("timestamp", "DESC").limit(limit);

    ctx.body = {
      success: true,
      data: logs.map((log: SystemLog) => ({
        level: log.level,
        name: log.name,
        message: log.message,
        source: log.source,
        timestamp:
          log.timestamp instanceof Date
            ? log.timestamp.toISOString()
            : log.timestamp,
      })),
      total: logs.length,
    };
  });

  // 日志 API - 清空日志
  router.delete(`${base}/logs`, async (ctx) => {
    const LogModel = database.models.get("SystemLog");
    if (!LogModel) {
      ctx.status = 500;
      ctx.body = { success: false, error: "SystemLog model not found" };
      return;
    }

    await LogModel.delete({});
    ctx.body = { success: true, message: "日志已清空" };
  });

  // 日志统计 API
  router.get(`${base}/logs/stats`, async (ctx) => {
    const LogModel = database.models.get("SystemLog");
    if (!LogModel) {
      ctx.status = 500;
      ctx.body = { success: false, error: "SystemLog model not found" };
      return;
    }

    const total = await LogModel.select();
    const levels = ["info", "warn", "error"];
    const levelCounts: Record<string, number> = {};

    for (const level of levels) {
      const count = await LogModel.select().where({ level });
      levelCounts[level] = count.length;
    }

    const oldestLog = await LogModel.select("timestamp")
      .orderBy("timestamp", "ASC")
      .limit(1);
    const oldestTimestamp =
      oldestLog.length > 0
        ? oldestLog[0].timestamp instanceof Date
          ? oldestLog[0].timestamp.toISOString()
          : oldestLog[0].timestamp
        : null;

    ctx.body = {
      success: true,
      data: { total: total.length, byLevel: levelCounts, oldestTimestamp },
    };
  });

  // 日志清理 API
  router.post(`${base}/logs/cleanup`, async (ctx:RouterContext) => {
    const LogModel = database.models.get("SystemLog");
    if (!LogModel) {
      ctx.status = 500;
      ctx.body = { success: false, error: "SystemLog model not found" };
      return;
    }

    const { days, maxRecords } =
      (ctx.request.body as { days?: number; maxRecords?: number }) || {};
    let deletedCount = 0;

    if (days && typeof days === "number" && days > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const deleted = await LogModel.delete({ timestamp: { $lt: cutoffDate } });
      deletedCount +=
        typeof deleted === "number" ? deleted : deleted?.length || 0;
    }

    if (maxRecords && typeof maxRecords === "number" && maxRecords > 0) {
      const totalLogs = await LogModel.select();
      if (totalLogs.length > maxRecords) {
        const excessCount = totalLogs.length - maxRecords;
        const oldestLogs = await LogModel.select("id", "timestamp")
          .orderBy("timestamp", "ASC")
          .limit(excessCount);
        const idsToDelete = oldestLogs.map(
          (log: Pick<SystemLog, "id" | "timestamp">) => log.id
        );

        if (idsToDelete.length > 0) {
          const deleted = await LogModel.delete({ id: { $in: idsToDelete } });
          deletedCount +=
            typeof deleted === "number" ? deleted : deleted?.length || 0;
        }
      }
    }

    ctx.body = {
      success: true,
      message: `已清理 ${deletedCount} 条日志`,
      deletedCount,
    };
  });
});

// 注册 koa 和 router 上下文
provide({
  name: "koa",
  description: "koa instance",
  value: koa,
});

provide({
  name: "router",
  description: "koa router",
  value: router,
});
// 应用中间件
koa.use(body()).use(router.routes()).use(router.allowedMethods());
