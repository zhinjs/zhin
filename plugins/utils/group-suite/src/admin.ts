import {
  formatCompact,
  MessageCommand,
  type Plugin,
  ZhinTool,
} from "zhin.js";
import { adapterAllowed } from "./shared.js";
import type { GroupSuiteConfig } from "./config.js";

export function registerAdmin(plugin: Plugin, cfg: GroupSuiteConfig): void {
  const { addCommand, addMiddleware, addTool, logger } = plugin;
  const welcomeTemplate = cfg.welcome;
  const noticeAdapters = cfg.noticeAdapters;

  plugin.on("notice.receive", async (notice) => {
    if (!adapterAllowed(noticeAdapters, String(notice.$adapter))) return;

    if (notice.$type === "group_member_increase") {
      if (notice.$channel.type !== "group") return;
      const targetName =
        notice.$target?.name || notice.$target?.id || "新成员";
      const welcomeMsg = `🎉 ${targetName}，${welcomeTemplate}`;
      try {
        const adapter = plugin.inject(notice.$adapter as never) as any;
        if (!adapter?.sendMessage) return;
        await adapter.sendMessage({
          context: notice.$adapter,
          bot: notice.$bot,
          content: welcomeMsg,
          id: notice.$channel.id,
          type: notice.$channel.type,
        });
      } catch (e: unknown) {
        logger.warn(
          formatCompact({
            op: "welcome",
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      return;
    }

    if (cfg.recallNotify && notice.$type === "group_recall") {
      if (notice.$channel.type !== "group") return;
      const operatorName =
        notice.$operator?.name || notice.$operator?.id || "某人";
      const msg = `⚠️ ${operatorName} 撤回了一条消息`;
      try {
        const adapter = plugin.inject(notice.$adapter as never) as any;
        if (!adapter?.sendMessage) return;
        await adapter.sendMessage({
          context: notice.$adapter,
          bot: notice.$bot,
          content: msg,
          id: notice.$channel.id,
          type: notice.$channel.type,
        });
      } catch (e: unknown) {
        logger.warn(
          formatCompact({
            op: "recall_notice",
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }
  });

  if (!cfg.keywordReply) return;

  const keywords = new Map<string, string>();

  addMiddleware(async (message, next) => {
    if (message.$channel.type !== "group") {
      await next();
      return;
    }
    const raw = message.$raw?.trim();
    if (!raw) {
      await next();
      return;
    }
    for (const [keyword, reply] of keywords) {
      if (raw.includes(keyword)) {
        await message.$reply(reply);
        return;
      }
    }
    await next();
  });

  addCommand(
    new MessageCommand("添加关键词 <keyword:text> <reply:text>")
      .desc("添加一个关键词自动回复对")
      .action(async (_message, result) => {
        const { keyword, reply } = result.params as {
          keyword: string;
          reply: string;
        };
        if (!keyword || !reply) return "请提供关键词和回复内容";
        keywords.set(keyword, reply);
        return `已添加关键词「${keyword}」→「${reply}」`;
      }),
  );

  addCommand(
    new MessageCommand("删除关键词 <keyword:text>")
      .desc("删除一个关键词")
      .action(async (_message, result) => {
        const { keyword } = result.params as { keyword: string };
        if (!keyword) return "请提供要删除的关键词";
        if (!keywords.has(keyword)) return `关键词「${keyword}」不存在`;
        keywords.delete(keyword);
        return `已删除关键词「${keyword}」`;
      }),
  );

  addCommand(
    new MessageCommand("关键词列表")
      .desc("查看所有关键词回复对")
      .action(async () => {
        if (keywords.size === 0) return "当前没有设置任何关键词";
        const lines = Array.from(keywords.entries()).map(
          ([k, v], i) => `${i + 1}. 「${k}」→「${v}」`,
        );
        return `关键词列表（共 ${keywords.size} 条）：\n${lines.join("\n")}`;
      }),
  );

  addTool(
    new ZhinTool("group_announce")
      .desc("向群聊发送公告/通知消息")
      .keyword("群公告", "通知", "announce")
      .param("message", { type: "string", description: "要发送的公告内容" }, true)
      .execute(async (args) => {
        const content = args.message as string;
        if (!content?.trim()) return "公告内容不能为空";
        return `📢 群公告：\n${content}`;
      })
      .toTool(),
  );
}
