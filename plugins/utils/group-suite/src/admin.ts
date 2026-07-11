import {
  formatCompact,
  MessageCommand,
  matchesSideEventName,
  sideEventSendChannel,
  type Plugin,
} from "zhin.js";
import { adapterAllowed } from "./shared.js";
import type { GroupSuiteConfig } from "./config.js";

export function registerAdmin(plugin: Plugin, cfg: GroupSuiteConfig): void {
  const { addCommand, logger } = plugin;
  const welcomeTemplate = cfg.welcome;
  const noticeAdapters = cfg.noticeAdapters;

  plugin.on("notice.receive", async (notice) => {
    if (!adapterAllowed(noticeAdapters, String(notice.$adapter))) return;

    if (matchesSideEventName(notice, "notice.group.member_increase")) {
      if (notice.$scene_type !== "group") return;
      const targetName =
        notice.$target?.name || notice.$target?.id || "新成员";
      const welcomeMsg = `🎉 ${targetName}，${welcomeTemplate}`;
      const channel = sideEventSendChannel(notice);
      try {
        const adapter = plugin.inject(notice.$adapter as never) as any;
        if (!adapter?.sendMessage) return;
        await adapter.sendMessage({
          context: notice.$adapter,
          endpoint: notice.$endpoint,
          content: welcomeMsg,
          id: channel.id,
          type: channel.type,
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

    if (cfg.recallNotify && matchesSideEventName(notice, "notice.group.recall")) {
      if (notice.$scene_type !== "group") return;
      const operatorName =
        notice.$actor?.name || notice.$actor?.id || "某人";
      const msg = `⚠️ ${operatorName} 撤回了一条消息`;
      const channel = sideEventSendChannel(notice);
      try {
        const adapter = plugin.inject(notice.$adapter as never) as any;
        if (!adapter?.sendMessage) return;
        await adapter.sendMessage({
          context: notice.$adapter,
          endpoint: notice.$endpoint,
          content: msg,
          id: channel.id,
          type: channel.type,
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

  plugin.root.addMiddleware(async (message, next) => {
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
        await message.$reply?.(reply);
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

}
