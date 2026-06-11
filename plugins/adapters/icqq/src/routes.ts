/**
 * ICQQ HTTP 路由注册 — 通过 IPC 查询守护进程数据
 */
import type { Router } from "@zhin.js/host-router";
import type { Plugin } from "zhin.js";
import type { IcqqAdapter } from "./adapter.js";
import { Actions } from "./protocol.js";

export function registerRoutes(
  router: Router,
  icqq: IcqqAdapter,
  _root: Plugin,
) {
  router.get("/api/icqq/endpoints", async (ctx) => {
    try {
      const endpoints = Array.from(icqq.endpoints.values());
      if (endpoints.length === 0) {
        ctx.body = { success: true, data: [], message: "暂无ICQQEndpoint 实例" };
        return;
      }
      const result = await Promise.all(
        endpoints.map(async (endpoint) => {
          try {
            const base: Record<string, unknown> = {
              name: endpoint.$config.name,
              connected: endpoint.$connected || false,
              groupCount: endpoint.groups.size,
              friendCount: endpoint.friends.size,
              status: endpoint.$connected ? "online" : "offline",
              lastActivity: new Date().toISOString(),
            };

            // 尝试从守护进程获取详细状态
            if (endpoint.$connected && endpoint.ipc && !endpoint.ipc.closed) {
              try {
                const statusResp = await endpoint.ipc.request(
                  Actions.GET_STATUS,
                  {},
                  5000,
                );
                if (statusResp.ok && statusResp.data) {
                  const stat = statusResp.data as Record<string, unknown>;
                  base.receiveCount = stat.recv_msg_cnt ?? 0;
                  base.sendCount = stat.sent_msg_cnt ?? 0;
                }
              } catch {
                // status 查询超时，忽略
              }
            }

            return base;
          } catch {
            return {
              name: endpoint.$config.name,
              connected: false,
              groupCount: 0,
              friendCount: 0,
              status: "error",
              error: "数据获取失败",
            };
          }
        }),
      );
      ctx.body = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: "ICQQ_API_ERROR",
        message: "获取 Endpoint 数据失败",
        details:
          process.env.NODE_ENV === "development"
            ? (error as Error).message
            : undefined,
        timestamp: new Date().toISOString(),
      };
    }
  });
}
