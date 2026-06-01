/**
 * IM 适配器管理 API 桩（Edge / 无对应适配器时与 Host OpenAPI 路径对齐）。
 * Host 上由 qq/kook/icqq 等插件注册真实实现；勿在已加载适配器的 RouteTable 上重复注册。
 */
import { registerFetchRoute, type RouteTable, type RouterContext } from "@zhin.js/http-host";

const emptyBots = (ctx: RouterContext) => {
  ctx.body = { success: true, data: [] };
};

const botNotFound = (ctx: RouterContext) => {
  ctx.status = 404;
  ctx.body = { success: false, error: "Bot 不存在" };
};

export function registerAdapterApiStubs(table: RouteTable): void {
  registerFetchRoute(table, "GET", "/api/icqq/bots", (ctx) => {
    ctx.body = { success: true, data: [], message: "暂无ICQQ机器人实例" };
  });

  registerFetchRoute(table, "GET", "/api/qq/bots", emptyBots);
  registerFetchRoute(table, "POST", "/api/qq/bots/:name/connect", botNotFound);
  registerFetchRoute(table, "POST", "/api/qq/bots/:name/disconnect", botNotFound);
  registerFetchRoute(table, "GET", "/api/qq/bots/:name/guilds", botNotFound);
  registerFetchRoute(table, "GET", "/api/qq/bots/:name/guilds/:guildId/channels", botNotFound);

  registerFetchRoute(table, "GET", "/api/kook/bots", emptyBots);
  registerFetchRoute(table, "POST", "/api/kook/bots/:name/connect", botNotFound);
  registerFetchRoute(table, "POST", "/api/kook/bots/:name/disconnect", botNotFound);
  registerFetchRoute(table, "GET", "/api/kook/bots/:name/guilds/:guildId/roles", botNotFound);
  registerFetchRoute(table, "POST", "/api/kook/bots/:name/guilds/:guildId/roles", botNotFound);
  registerFetchRoute(
    table,
    "DELETE",
    "/api/kook/bots/:name/guilds/:guildId/roles/:roleId",
    botNotFound,
  );
}
