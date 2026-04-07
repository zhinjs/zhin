import { usePlugin, DatabaseFeature, Models, Adapter, SystemLog, Plugin, Feature } from "zhin.js";
import { Schema } from "@zhin.js/schema";
import { createServer, Server } from "http";
import crypto from "node:crypto";
import Koa from "koa";
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
  token: Schema.string().description(
    "API 访问令牌，不填则自动生成。通过 Authorization: Bearer <token> 传递"
  ),
  base: Schema.string()
    .default("/api")
    .description("HTTP 路由前缀, 默认为 /api"),
});

export interface HttpConfig {
  port?: number;
  host?: string;
  token?: string;
  base?: string;
  /** 是否信任反向代理（Cloudflare、Nginx 等）的 X-Forwarded-* 头，部署在代理后时建议设为 true */
  trustProxy?: boolean;
}

const generateToken = () => crypto.randomBytes(16).toString('hex');

const plugin = usePlugin();
const { provide, root, useContext, logger, declareConfig } = plugin;

declareConfig("http", httpSchema, { reloadable: false });

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
    token = generateToken(),
    base = "/api",
    trustProxy = false,
  } = httpConfig;

  // 反向代理场景下信任 X-Forwarded-Host / X-Forwarded-Proto 等
  koa.proxy = trustProxy;

  // 安全响应头
  koa.use(async (ctx, next) => {
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('X-Frame-Options', 'SAMEORIGIN');
    await next();
  });

  // Token 认证中间件：仅对 API 路径要求认证
  koa.use(async (ctx, next) => {
    if (!ctx.path.startsWith(base + '/') && ctx.path !== base) return next();
    // /pub 为公开前缀（webhook、OAuth、health 等），不校验 token
    if (ctx.path.startsWith('/pub/') || ctx.path === '/pub') return next();
    // 跳过 router 注册的非 API 路由（如 /mcp），避免误拦截
    const whiteList: (string | RegExp)[] = router.whiteList || [];
    const isWhitelisted = whiteList.some(p =>
      typeof p === 'string' && !p.startsWith(base) && ctx.path.startsWith(p)
    );
    if (isWhitelisted) return next();

    // 仅从 Authorization: Bearer 头提取 token（不接受 query 参数，避免凭据泄漏）
    const authHeader = ctx.get('Authorization');
    const reqToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    // 使用 HMAC 做固定时间比较，避免长度与内容两层时序泄漏
    const expected = crypto.createHmac('sha256', token).update(token).digest();
    const received = crypto.createHmac('sha256', token).update(reqToken || '').digest();
    if (!crypto.timingSafeEqual(expected, received)) {
      ctx.status = 401;
      ctx.body = { success: false, error: 'Invalid or missing token' };
      return;
    }
    await next();
  });

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
  router.get('/pub/health', async (ctx) => {
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

  // 收集所有 Feature 服务实例（用于 toJSON 序列化）
  const collectFeatures = (): Feature[] => {
    const features: Feature[] = [];
    for (const [, context] of root.contexts) {
      if (context.value instanceof Feature) {
        features.push(context.value);
      }
    }
    return features;
  };

  // 插件列表 API
  router.get(`${base}/plugins`, async (ctx) => {
    const featureServices = collectFeatures();
    const plugins = root.children.map((p) => {
      const features = featureServices
        .map(f => f.toJSON(p.name))
        .filter(f => f.count > 0);
      return {
        name: p.name,
        status: p.started ? "active" : "inactive",
        description: p.manifest?.description || p.name,
        features,
      };
    });
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

    const featureServices = collectFeatures();
    const features = featureServices
      .map(f => f.toJSON(pluginName))
      .filter(f => f.count > 0);

    const contexts = Array.from(plugin.contexts.entries())
      .map(([name]) => ({ name }));

    ctx.body = {
      success: true,
      data: {
        name: plugin.name,
        filename: plugin.filePath,
        filePath: plugin.filePath,
        status: plugin.started ? "active" : "inactive",
        description: plugin.manifest?.description || plugin.name,
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

  // 消息发送 API（由 Token 认证保护，供 zhin send 等调用）
  router.post(`${base}/message/send`, async (ctx: RouterContext) => {
    interface SendMessageBody {
      context: string;
      bot: string;
      id: string;
      type: string;
      content: unknown;
    }
    const body = ctx.request.body as SendMessageBody;
    const { context, bot, id, type, content } = body;

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
    } catch (err: any) {
      logger.error("message/send failed: " + (err?.message || String(err)));
      ctx.status = 500;
      ctx.body = { success: false, error: 'Message sending failed' };
    }
  });

  // ─── 插件市场 API ─────────────────────────────────────────────
  router.get(`${base}pub/marketplace/search`, async (ctx) => {
    const { keyword = '', page = '1', size = '20', category, official } = ctx.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(size, 10) || 20));

    try {
      const searchUrl = new URL('https://registry.npmmirror.com/-/v1/search');
      const q = keyword ? `zhin-plugin ${keyword}` : 'zhin-plugin';
      searchUrl.searchParams.set('text', q);
      searchUrl.searchParams.set('size', '250');
      const resp = await fetch(searchUrl.toString());
      if (!resp.ok) throw new Error(`npm search failed: ${resp.status}`);
      const data = await resp.json() as any;

      let plugins = (data.objects || [])
        .filter((o: any) => {
          const name: string = o.package?.name || '';
          return (
            (name.startsWith('zhin-plugin-') || name.startsWith('@zhin.js/')) &&
            !['@zhin.js/core', '@zhin.js/kernel', '@zhin.js/ai', '@zhin.js/agent',
              '@zhin.js/client', '@zhin.js/satori', '@zhin.js/schema',
              '@zhin.js/logger', '@zhin.js/database', '@zhin.js/cli',
              'zhin', 'zhin.js', 'create-zhin'].includes(name)
          );
        })
        .map((o: any) => {
          const pkg = o.package;
          const isOfficial = (pkg.name as string).startsWith('@zhin.js/');
          const kw: string[] = pkg.keywords || [];
          let cat = 'util';
          if (kw.includes('adapter')) cat = 'adapter';
          else if (kw.includes('service')) cat = 'service';
          else if (kw.includes('game')) cat = 'game';
          else if (kw.includes('feature')) cat = 'feature';
          return {
            name: pkg.name,
            version: pkg.version,
            description: pkg.description || '',
            author: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || '',
            keywords: kw,
            category: cat,
            official: isOfficial,
            date: pkg.date,
            score: o.score?.final || 0,
          };
        });

      if (category) plugins = plugins.filter((p: any) => p.category === category);
      if (official === 'true') plugins = plugins.filter((p: any) => p.official);
      if (official === 'false') plugins = plugins.filter((p: any) => !p.official);

      const total = plugins.length;
      const start = (pageNum - 1) * pageSize;
      const items = plugins.slice(start, start + pageSize);

      ctx.body = { success: true, data: { items, total, page: pageNum, size: pageSize } };
    } catch (err: any) {
      ctx.status = 502;
      ctx.body = { success: false, error: err.message || 'Search failed' };
    }
  });

  router.get(`${base}pub/marketplace/detail/:name+`, async (ctx) => {
    const pkgName = ctx.params.name;
    try {
      const [metaResp, dlResp] = await Promise.all([
        fetch(`https://registry.npmmirror.com/${encodeURIComponent(pkgName)}`),
        fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkgName)}`),
      ]);
      if (!metaResp.ok) throw new Error(`Package not found: ${metaResp.status}`);
      const meta = await metaResp.json() as any;
      const dl = dlResp.ok ? (await dlResp.json() as any) : {};
      const latest = meta['dist-tags']?.latest;
      const latestInfo = latest ? meta.versions?.[latest] : undefined;
      ctx.body = {
        success: true,
        data: {
          name: meta.name,
          version: latest,
          description: meta.description || '',
          readme: meta.readme || '',
          license: meta.license || latestInfo?.license || '',
          homepage: meta.homepage || latestInfo?.homepage || '',
          repository: meta.repository?.url || latestInfo?.repository?.url || '',
          author: typeof meta.author === 'string' ? meta.author : meta.author?.name || '',
          keywords: latestInfo?.keywords || [],
          dependencies: latestInfo?.dependencies || {},
          weeklyDownloads: dl.downloads ?? 0,
          versions: Object.keys(meta.versions || {}),
          time: meta.time || {},
        },
      };
    } catch (err: any) {
      ctx.status = 502;
      ctx.body = { success: false, error: err.message || 'Detail fetch failed' };
    }
  });

  router.get(`${base}/marketplace/updates`, async (ctx) => {
    try {
      const configService = plugin.inject('config');
      const appConfig = configService?.get<{ plugins?: string[] }>('zhin.config.yml');
      const installed: string[] = appConfig?.plugins || [];
      if (!installed.length) {
        ctx.body = { success: true, data: [] };
        return;
      }

      const updates = await Promise.all(
        installed.map(async (name: string) => {
          try {
            const resp = await fetch(`https://registry.npmmirror.com/${encodeURIComponent(name)}/latest`);
            if (!resp.ok) return null;
            const pkg = await resp.json() as any;
            return { name, latest: pkg.version, description: pkg.description || '' };
          } catch { return null; }
        }),
      );
      ctx.body = { success: true, data: updates.filter(Boolean) };
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message || 'Update check failed' };
    }
  });

  server.listen({ host, port }, () => {
    const address = server.address();
    if (!address) return;
    const visitAddress =
      typeof address === "string"
        ? address
        : `${host}:${address.port}`;
    const apiUrl = `http://${visitAddress}${base}`;

    logger.info(`HTTP 服务已启动 (port=${port}, api=${apiUrl}, token=${token.slice(0, 6)}...)`);
  });
});

// 使用数据库服务（可选）
useContext("database", (database: DatabaseFeature) => {
  const configService = root.inject("config")!;
  const appConfig = configService.getPrimary<{ http?: HttpConfig }>();
  const base = appConfig.http?.base || "/api";

  // 日志 API - 获取日志
  router.get(`${base}/logs`, async (ctx) => {
    const limit = Math.min(Math.max(parseInt(ctx.query.limit as string, 10) || 100, 1), 1000);
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
