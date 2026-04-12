/**
 * ICQQ 平台特有工具注册 — 通过 IPC 调用守护进程 Actions
 *
 * 通用群管理工具由 createGroupManagementTools() 自动生成;
 * 本模块注册 ICQQ 独有的扩展工具。
 */
import type { ToolFeature } from "zhin.js";
import { createGroupManagementTools } from "zhin.js";
import type { IcqqAdapter } from "../adapter.js";
import { Actions } from "../protocol.js";

export function registerTools(
  toolService: ToolFeature,
  icqq: IcqqAdapter,
  pluginName: string,
): () => void {
  const disposers: (() => void)[] = [];

  // ── 通用群管工具 ───────────────────────────────────────────────────
  const groupTools = createGroupManagementTools(icqq, "icqq");
  disposers.push(...groupTools.map((t) => toolService.addTool(t, pluginName)));

  // ── 设置头衔 ───────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_set_title",
        description: "设置 QQ 群成员的专属头衔",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            group_id: { type: "number", description: "目标群号" },
            user_id: { type: "number", description: "目标成员 QQ号" },
            title: { type: "string", description: "头衔文字" },
            duration: { type: "number", description: "持续时间(秒)，-1永久" },
          },
          required: ["bot", "group_id", "user_id", "title"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const resp = await bot.ipc.request(Actions.SET_GROUP_TITLE, {
            group_id: args.group_id,
            user_id: args.user_id,
            title: args.title,
            duration: args.duration ?? -1,
          });
          return { success: resp.ok, message: resp.ok ? `已将 ${args.user_id} 的头衔设为 "${args.title}"` : (resp.error ?? "设置失败") };
        },
      },
      pluginName,
    ),
  );

  // ── 发送群公告 ─────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_announce",
        description: "发送 QQ 群公告（需要管理员权限）",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            group_id: { type: "number", description: "目标群号" },
            content: { type: "string", description: "公告内容" },
          },
          required: ["bot", "group_id", "content"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const resp = await bot.ipc.request(Actions.GROUP_ANNOUNCE, {
            group_id: args.group_id,
            content: args.content,
          });
          return { success: resp.ok, message: resp.ok ? "群公告已发送" : (resp.error ?? "发送失败") };
        },
      },
      pluginName,
    ),
  );

  // ── 戳一戳 ─────────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_poke",
        description: "在 QQ 群中对某个成员执行戳一戳互动操作",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            group_id: { type: "number", description: "目标群号" },
            user_id: { type: "number", description: "要戳的目标成员 QQ号" },
          },
          required: ["bot", "group_id", "user_id"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const resp = await bot.ipc.request(Actions.GROUP_POKE, {
            group_id: args.group_id,
            user_id: args.user_id,
          });
          return { success: resp.ok, message: resp.ok ? `已戳了戳 ${args.user_id}` : (resp.error ?? "戳一戳失败") };
        },
      },
      pluginName,
    ),
  );

  // ── 获取被禁言列表 ─────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_list_muted",
        description: "查询 QQ 群中当前被禁言的成员列表",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            group_id: { type: "number", description: "目标群号" },
          },
          required: ["bot", "group_id"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const resp = await bot.ipc.request(Actions.GROUP_MUTED_LIST, {
            group_id: args.group_id,
          });
          if (!resp.ok) throw new Error(resp.error ?? "获取禁言列表失败");
          const list = Array.isArray(resp.data) ? resp.data : [];
          return { muted_members: list, count: list.length };
        },
      },
      pluginName,
    ),
  );

  // ── 给用户点赞 ─────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_send_user_like",
        description: "给用户点赞（竖大拇指），每人每天最多 20 次",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            user_id: { type: "number", description: "要点赞的目标用户 QQ号" },
            times: { type: "number", description: "点赞次数（1-20），默认 1" },
          },
          required: ["bot", "user_id"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const resp = await bot.ipc.request(Actions.FRIEND_LIKE, {
            user_id: args.user_id,
            times: Math.min(args.times ?? 1, 20),
          });
          return { success: resp.ok, message: resp.ok ? `已给 ${args.user_id} 点赞` : (resp.error ?? "点赞失败") };
        },
      },
      pluginName,
    ),
  );

  // ── 设置匿名聊天 ───────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_set_anonymous",
        description: "开启或关闭 QQ 群的匿名聊天功能",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            group_id: { type: "number", description: "目标群号" },
            enable: { type: "boolean", description: "true=开启，false=关闭，默认 true" },
          },
          required: ["bot", "group_id"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const enable = args.enable ?? true;
          const resp = await bot.ipc.request(Actions.GROUP_ALLOW_ANONY, {
            group_id: args.group_id,
            enable,
          });
          return { success: resp.ok, message: resp.ok ? (enable ? "已开启匿名聊天" : "已关闭匿名聊天") : (resp.error ?? "操作失败") };
        },
      },
      pluginName,
    ),
  );

  // ── 群文件列表 ─────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_group_files",
        description: "获取 QQ 群的群文件列表",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot 名称" },
            group_id: { type: "number", description: "群号" },
          },
          required: ["bot", "group_id"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const resp = await bot.ipc.request(Actions.GFS_LIST, {
            group_id: args.group_id,
          });
          if (!resp.ok) throw new Error(resp.error ?? "获取群文件失败");
          const files = Array.isArray(resp.data) ? resp.data : [];
          if (!files.length) return { files: [], message: "群文件为空" };
          return {
            files: files.slice(0, 30).map((f: any) => ({
              name: f.name,
              size: f.size,
              uploader: f.uploader_uin,
              upload_time: f.upload_time,
            })),
            count: files.length,
          };
        },
      },
      pluginName,
    ),
  );

  // ── 好友列表 ───────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_friend_list",
        description: "获取 QQ 好友列表",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot 名称" },
          },
          required: ["bot"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const friends = Array.from(bot.friends.values()).map((f) => ({
            user_id: f.user_id,
            nickname: f.nickname,
            remark: f.remark,
          }));
          return { friends: friends.slice(0, 50), count: bot.friends.size };
        },
      },
      pluginName,
    ),
  );

  // ── 群列表 ─────────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_group_list",
        description: "获取 Bot 的 QQ 群列表",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot 名称" },
          },
          required: ["bot"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const groups = Array.from(bot.groups.values()).map((g) => ({
            group_id: g.group_id,
            group_name: g.group_name,
            member_count: g.member_count,
            max_member_count: g.max_member_count,
          }));
          return { groups: groups.slice(0, 50), count: bot.groups.size };
        },
      },
      pluginName,
    ),
  );

  // ── 群签到 ─────────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_group_sign",
        description: "QQ 群签到打卡",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            group_id: { type: "number", description: "目标群号" },
          },
          required: ["bot", "group_id"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const resp = await bot.ipc.request(Actions.GROUP_SIGN, {
            group_id: args.group_id,
          });
          return { success: resp.ok, message: resp.ok ? "群签到成功" : (resp.error ?? "签到失败") };
        },
      },
      pluginName,
    ),
  );

  // ── 邀请入群 ───────────────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_group_invite",
        description: "邀请好友加入 QQ 群",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            group_id: { type: "number", description: "目标群号" },
            user_id: { type: "number", description: "要邀请的 QQ号" },
          },
          required: ["bot", "group_id", "user_id"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const resp = await bot.ipc.request(Actions.GROUP_INVITE, {
            group_id: args.group_id,
            user_id: args.user_id,
          });
          return { success: resp.ok, message: resp.ok ? `已邀请 ${args.user_id} 加入群` : (resp.error ?? "邀请失败") };
        },
      },
      pluginName,
    ),
  );

  // ── 设为/移除精华消息 ──────────────────────────────────────────────
  disposers.push(
    toolService.addTool(
      {
        name: "icqq_essence",
        description: "设置或移除 QQ 群精华消息",
        parameters: {
          type: "object",
          properties: {
            bot: { type: "string", description: "Bot QQ号" },
            message_id: { type: "string", description: "消息 ID" },
            action: { type: "string", description: "add=设为精华, remove=移除精华" },
          },
          required: ["bot", "message_id", "action"],
        },
        platforms: ["icqq"],
        tags: ["icqq"],
        execute: async (args: Record<string, any>) => {
          const bot = icqq.bots.get(args.bot);
          if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
          const action = args.action === "add" ? Actions.GROUP_ESSENCE_ADD : Actions.GROUP_ESSENCE_REMOVE;
          const resp = await bot.ipc.request(action, {
            message_id: args.message_id,
          });
          return { success: resp.ok, message: resp.ok ? (args.action === "add" ? "已设为精华" : "已移除精华") : (resp.error ?? "操作失败") };
        },
      },
      pluginName,
    ),
  );

  return () => disposers.forEach((d) => d());
}
