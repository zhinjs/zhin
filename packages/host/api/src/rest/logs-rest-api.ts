/**
 * 系统日志 REST（Host 接 Database；Edge 无库时返回空数据以保持 OpenAPI 对齐）。
 */
import {
  registerFetchRoute,
  type Router,
  type RouterContext,
} from "@zhin.js/host-router/router";

export type LogsRestDeps = {
  getLogModel: () => unknown;
};

export function registerLogsRoutes(
  router: Router,
  base: string,
  deps?: LogsRestDeps,
): void {
   
  const getModel = () => deps?.getLogModel?.() as any;

  registerFetchRoute(router, "GET", `${base}/logs`, async (ctx: RouterContext) => {
    const limit = Math.min(Math.max(parseInt(String(ctx.query.limit ?? "100"), 10) || 100, 1), 1000);
    const level = ctx.query.level ? String(ctx.query.level) : undefined;
    const LogModel = getModel();
    if (!LogModel) {
      ctx.body = { success: true, data: [], total: 0 };
      return;
    }

    let selection = LogModel.select();
    if (level && level !== "all") {
      selection = selection.where({ level });
    }

    const logs = await selection.orderBy("timestamp", "DESC").limit(limit);

    ctx.body = {
      success: true,
      data: logs.map((log: LogRow) => ({
        level: log.level,
        name: log.name,
        message: log.message,
        source: log.source,
        timestamp:
          log.timestamp instanceof Date ? log.timestamp.toISOString() : log.timestamp,
      })),
      total: logs.length,
    };
  });

  registerFetchRoute(router, "DELETE", `${base}/logs`, async (ctx: RouterContext) => {
    const LogModel = getModel();
    if (!LogModel) {
      ctx.body = { success: true, message: "日志已清空" };
      return;
    }

    await LogModel.delete({});
    ctx.body = { success: true, message: "日志已清空" };
  });

  registerFetchRoute(router, "GET", `${base}/logs/stats`, async (ctx: RouterContext) => {
    const LogModel = getModel();
    if (!LogModel) {
      ctx.body = {
        success: true,
        data: { total: 0, byLevel: { info: 0, warn: 0, error: 0 }, oldestTimestamp: null },
      };
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

  registerFetchRoute(router, "POST", `${base}/logs/cleanup`, async (ctx: RouterContext) => {
    const LogModel = getModel();
    if (!LogModel) {
      ctx.body = { success: true, message: "已清理 0 条日志", deletedCount: 0 };
      return;
    }

    const { days, maxRecords } =
      (ctx.request.body as { days?: number; maxRecords?: number }) || {};
    let deletedCount = 0;

    if (days && typeof days === "number" && days > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const deleted = await LogModel.delete({ timestamp: { $lt: cutoffDate } });
      deletedCount += typeof deleted === "number" ? deleted : deleted?.length || 0;
    }

    if (maxRecords && typeof maxRecords === "number" && maxRecords > 0) {
      const totalLogs = await LogModel.select();
      if (totalLogs.length > maxRecords) {
        const excessCount = totalLogs.length - maxRecords;
        const oldestLogs = await LogModel.select("id", "timestamp")
          .orderBy("timestamp", "ASC")
          .limit(excessCount);
        const idsToDelete = oldestLogs.map((log: LogRow) => log.id);

        if (idsToDelete.length > 0) {
          const deleted = await LogModel.delete({ id: { $in: idsToDelete } });
          deletedCount += typeof deleted === "number" ? deleted : deleted?.length || 0;
        }
      }
    }

    ctx.body = {
      success: true,
      message: `已清理 ${deletedCount} 条日志`,
      deletedCount,
    };
  });
}

type LogRow = {
  level: string;
  name: string;
  message: string;
  source: string;
  timestamp: string | Date;
  id?: unknown;
};
