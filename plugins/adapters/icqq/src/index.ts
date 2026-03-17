/**
 * ICQQ 适配器入口：类型扩展、导出、注册
 */
import path from "path";
import { usePlugin, type Plugin } from "zhin.js";
import type { Router } from "@zhin.js/http";
import { MessageCommand } from "zhin.js";
import { IcqqAdapter } from "./adapter.js";
import type { WebServer } from "@zhin.js/console";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: WebServer;
      router: Router;
    }
  }
  interface Adapters {
    icqq: IcqqAdapter;
  }
}

export * from "./types.js";
export { IcqqBot } from "./bot.js";
export { IcqqAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext, addCommand } = plugin;

provide({
  name: "icqq",
  description: "ICQQ Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new IcqqAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: IcqqAdapter) => {
    await adapter.stop();
  },
} as any);

useContext("icqq", (icqq: IcqqAdapter) => {
  addCommand(
    new MessageCommand<"icqq">("赞我 <times:number>")
      .permit("adapter(icqq)")
      .action(async (message, result) => {
        const bot = icqq.bots.get(message.$bot);
        const send1 = bot?.sendLike(Number(message.$sender.id), 20);
        const send2 = bot?.sendLike(Number(message.$sender.id), 20);
        const send3 = bot?.sendLike(Number(message.$sender.id), 10);
        const [send1Result, send2Result, send3Result] = await Promise.all([send1, send2, send3]);
        let times = 0;
        if (send1Result) times += 20;
        if (send2Result) times += 20;
        if (send3Result) times += 10;
        return `给你赞好啦，你已经获得了${times}个赞`;
      }),
  );
});

useContext("web", (web: WebServer) => {
  const dispose = web.addEntry(
    path.resolve(import.meta.dirname, "../client/index.tsx"),
  );
  return dispose;
});

useContext("router",'icqq', async (router: Router, icqq: IcqqAdapter) => {
  router.get("/api/icqq/bots", async (ctx) => {
    try {
      const bots = Array.from(icqq.bots.values());
      if (bots.length === 0) {
        ctx.body = { success: true, data: [], message: "暂无ICQQ机器人实例" };
        return;
      }
      const result = bots.map((bot) => {
        try {
          return {
            name: bot.$config.name,
            connected: bot.$connected || false,
            groupCount: bot.gl?.size || 0,
            friendCount: bot.fl?.size || 0,
            receiveCount: bot.stat?.recv_msg_cnt || 0,
            sendCount: bot.stat?.sent_msg_cnt || 0,
            loginMode: bot.$config.password ? "password" : "qrcode",
            status: bot.$connected ? "online" : "offline",
            lastActivity: new Date().toISOString(),
          };
        } catch {
          return {
            name: bot.$config.name,
            connected: false,
            groupCount: 0,
            friendCount: 0,
            receiveCount: 0,
            sendCount: 0,
            loginMode: "unknown",
            status: "error",
            error: "数据获取失败",
          };
        }
      });
      ctx.body = { success: true, data: result, timestamp: new Date().toISOString() };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: "ICQQ_API_ERROR",
        message: "获取机器人数据失败",
        details: process.env.NODE_ENV === "development" ? (error as Error).message : undefined,
        timestamp: new Date().toISOString(),
      };
    }
  });
});
