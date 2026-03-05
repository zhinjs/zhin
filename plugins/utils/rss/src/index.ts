/**
 * @zhin.js/plugin-rss
 *
 * RSS/Atom 订阅推送插件
 *
 * 功能：
 *   - 订阅任意 RSS/Atom feed
 *   - 基于 Cron 的定时轮询（默认每 5 分钟）
 *   - 新条目自动推送到订阅的群聊/私聊
 *   - 支持多群订阅同一 feed（去重共享）
 *   - 订阅管理（增删查）
 *   - 手动检查更新
 *   - 数据库持久化
 *   - AI 工具集成
 *
 * 命令：
 *   rss-add <url>           订阅 RSS 源
 *   rss-remove <url>        取消订阅
 *   rss-list                查看当前订阅列表
 *   rss-check [url]         手动检查更新
 *   rss-preview <url>       预览 feed 最新内容（不订阅）
 *
 * 配置（zhin.config.yml）：
 * ```yaml
 * plugins:
 *   - "@zhin.js/plugin-rss"
 * rss:
 *   pollCron: "0/5 * * * *"
 *   maxPerGroup: 30
 *   maxItems: 5
 *   timeout: 15000
 * ```
 */
import { usePlugin, Cron, ZhinTool, MessageCommand, Adapter, Schema } from "zhin.js";
import Parser from "rss-parser";

const plugin = usePlugin();
const { logger, root, addCommand, addCron, useContext, onDispose, declareSkill, declareConfig } = plugin;

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const config = declareConfig("rss", Schema.object({
  pollCron: Schema.string().default("*/5 * * * *").description("轮询频率 (Cron 表达式)"),
  maxPerGroup: Schema.number().default(30).min(1).max(200).description("每会话最大订阅数"),
  maxItems: Schema.number().default(5).min(1).max(20).description("单次推送最多条数"),
  timeout: Schema.number().default(15_000).min(1000).max(60000).description("拉取超时 (ms)"),
}));

// ─── 类型 ─────────────────────────────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  date: string;
  summary: string;
  guid: string;
}

// ─── Feed 解析器 ──────────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: config.timeout,
  headers: {
    "User-Agent": "ZhinBot-RSS/1.0",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  },
});

async function fetchFeed(url: string): Promise<{ title: string; items: FeedItem[] }> {
  const feed = await parser.parseURL(url);
  const items: FeedItem[] = (feed.items || []).slice(0, 20).map((item) => ({
    title: (item.title || "").trim(),
    link: (item.link || "").trim(),
    date: item.isoDate || item.pubDate || "",
    summary: stripHtml(item.contentSnippet || item.content || "").slice(0, 200),
    guid: item.guid || item.link || item.title || "",
  }));
  return { title: (feed.title || url).trim(), items };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// ─── 数据库 ───────────────────────────────────────────────────────────────────

let _db: any = null;

function getSubs(): any {
  if (!_db) {
    const database = root.inject("database" as any) as any;
    if (database) _db = database;
  }
  return _db?.models?.get("rss_subscriptions") ?? null;
}

function getSeen(): any {
  return _db?.models?.get("rss_seen_items") ?? null;
}

useContext("database", (db: any) => {
  _db = db;
  db.define("rss_subscriptions", {
    url: { type: "text", nullable: false },
    feed_title: { type: "text", default: "" },
    adapter_name: { type: "text", default: "" },
    bot_id: { type: "text", default: "" },
    channel_type: { type: "text", default: "group" },
    channel_id: { type: "text", default: "" },
    creator_id: { type: "text", default: "" },
    creator_name: { type: "text", default: "" },
    created_at: { type: "text", default: "" },
  });
  db.define("rss_seen_items", {
    feed_url: { type: "text", nullable: false },
    item_guid: { type: "text", nullable: false },
    item_title: { type: "text", default: "" },
    seen_at: { type: "text", default: "" },
  });
  logger.info("RSS 数据模型已注册");
});

function ts(): string {
  return new Date().toISOString();
}

// ─── 辅助：消息上下文提取 ─────────────────────────────────────────────────────

function extractChannelInfo(message: any): {
  adapterName: string;
  botId: string;
  channelType: string;
  channelId: string;
} {
  const channelType = message.$channel?.type || (message.type === "group" ? "group" : "private");
  const channelId = String(message.$channel?.id || message.$group?.id || message.$target?.id || message.$sender?.id || "");
  return {
    adapterName: String(message.$adapter || ""),
    botId: String(message.$bot || ""),
    channelType,
    channelId,
  };
}

// ─── 推送引擎 ─────────────────────────────────────────────────────────────────

async function pushToChannel(
  adapterName: string,
  botId: string,
  channelType: string,
  channelId: string,
  content: string,
): Promise<boolean> {
  try {
    const adapter = root.inject(adapterName as any) as Adapter | null;
    if (!adapter) return false;
    await adapter.sendMessage({
      context: adapterName,
      bot: botId,
      type: channelType as "group" | "private" | "channel",
      id: channelId,
      content,
    });
    return true;
  } catch (e) {
    logger.warn(`推送失败 [${adapterName}:${botId} → ${channelType}:${channelId}]: ${(e as Error).message}`);
    return false;
  }
}

function formatItems(feedTitle: string, items: FeedItem[]): string {
  const lines = [`${feedTitle} 有 ${items.length} 条新内容：`];
  for (const item of items.slice(0, config.maxItems)) {
    lines.push("");
    lines.push(`${item.title}`);
    if (item.summary) lines.push(item.summary);
    if (item.link) lines.push(item.link);
  }
  if (items.length > config.maxItems) {
    lines.push(`\n...还有 ${items.length - config.maxItems} 条，请查看源站`);
  }
  return lines.join("\n");
}

// ─── 轮询逻辑 ─────────────────────────────────────────────────────────────────

let polling = false;

async function pollAllFeeds(): Promise<void> {
  const Subs = getSubs();
  const Seen = getSeen();
  if (!Subs || !Seen) return;
  if (polling) return;
  polling = true;

  try {
    const allSubs: any[] = await Subs.select();
    if (allSubs.length === 0) return;

    const urlSet = new Set(allSubs.map((s: any) => s.url));

    for (const url of urlSet) {
      try {
        const { title, items } = await fetchFeed(url);
        if (items.length === 0) continue;

        const seenRows: any[] = await Seen.select().where({ feed_url: url });
        const seenGuids = new Set(seenRows.map((r: any) => r.item_guid));

        const newItems = items.filter((item) => !seenGuids.has(item.guid));
        if (newItems.length === 0) continue;

        for (const item of newItems) {
          await Seen.insert({
            feed_url: url,
            item_guid: item.guid,
            item_title: item.title,
            seen_at: ts(),
          });
        }

        const message = formatItems(title, newItems);
        const subscribers = allSubs.filter((s: any) => s.url === url);

        for (const sub of subscribers) {
          await pushToChannel(sub.adapter_name, sub.bot_id, sub.channel_type, sub.channel_id, message);
        }

        // 更新 feed 标题
        if (title) {
          for (const sub of subscribers) {
            if (sub.feed_title !== title) {
              await Subs.update({ feed_title: title }).where({ id: sub.id });
            }
          }
        }
      } catch (e) {
        logger.debug(`轮询 ${url} 失败: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    logger.warn(`轮询异常: ${(e as Error).message}`);
  } finally {
    polling = false;
  }
}

// 定期清理过老的 seen 记录（保留最近 7 天）
async function cleanOldSeen(): Promise<void> {
  const Seen = getSeen();
  if (!Seen) return;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString();
    const all: any[] = await Seen.select();
    const expired = all.filter((r: any) => r.seen_at && r.seen_at < cutoffStr);
    for (const row of expired) {
      await Seen.delete().where({ id: row.id });
    }
  } catch {
    // 清理失败不影响主流程
  }
}

// ─── Cron 定时任务 ────────────────────────────────────────────────────────────

addCron(new Cron(config.pollCron, pollAllFeeds));
addCron(new Cron("0 4 * * *", cleanOldSeen));

// ─── 命令：rss-add ───────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("rss-add <url:text>")
    .desc("订阅 RSS", "订阅一个 RSS/Atom 源，新内容将自动推送到当前会话")
    .usage("rss-add <Feed URL>")
    .examples("rss-add https://sspai.com/feed", "rss-add https://rsshub.app/bilibili/user/dynamic/1")
    .action(async (message: any, result: any) => {
      const Subs = getSubs();
      if (!Subs) return "RSS 数据库尚未就绪，请稍后重试";

      const url = result.params.url?.trim();
      if (!url) return "请提供 RSS 源地址，格式：rss-add <URL>";
      if (!/^https?:\/\//i.test(url)) return "请提供有效的 HTTP/HTTPS 地址";

      const { adapterName, botId, channelType, channelId } = extractChannelInfo(message);
      if (!channelId) return "无法确定当前会话，请在群聊或私聊中使用";

      // 检查是否已订阅
      const existing: any[] = await Subs.select().where({
        url,
        adapter_name: adapterName,
        channel_type: channelType,
        channel_id: channelId,
      });
      if (existing.length > 0) return "当前会话已订阅该源，无需重复添加";

      // 检查数量限制
      const currentSubs: any[] = await Subs.select().where({
        adapter_name: adapterName,
        channel_type: channelType,
        channel_id: channelId,
      });
      if (currentSubs.length >= config.maxPerGroup) {
        return `当前会话订阅数已达上限 (${config.maxPerGroup})，请先取消一些`;
      }

      // 验证 feed 可达
      let feedTitle = "";
      try {
        const { title } = await fetchFeed(url);
        feedTitle = title;
      } catch (e) {
        return `无法解析该地址: ${(e as Error).message}\n请确认是有效的 RSS/Atom 源`;
      }

      await Subs.insert({
        url,
        feed_title: feedTitle,
        adapter_name: adapterName,
        bot_id: botId,
        channel_type: channelType,
        channel_id: channelId,
        creator_id: String(message.$sender?.id || ""),
        creator_name: String(message.$sender?.name || ""),
        created_at: ts(),
      });

      // 标记现有条目为已读，避免订阅后立即推送历史
      try {
        const Seen = getSeen();
        if (Seen) {
          const { items } = await fetchFeed(url);
          for (const item of items) {
            const dup: any[] = await Seen.select().where({ feed_url: url, item_guid: item.guid });
            if (dup.length === 0) {
              await Seen.insert({ feed_url: url, item_guid: item.guid, item_title: item.title, seen_at: ts() });
            }
          }
        }
      } catch {
        // 标记失败不影响订阅
      }

      return `订阅成功！\n源: ${feedTitle || url}\n新内容将自动推送到当前会话`;
    }),
);

// ─── 命令：rss-remove ────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("rss-remove <url:text>")
    .desc("取消订阅", "取消一个 RSS 订阅")
    .usage("rss-remove <Feed URL>")
    .examples("rss-remove https://sspai.com/feed")
    .action(async (message: any, result: any) => {
      const Subs = getSubs();
      if (!Subs) return "RSS 数据库尚未就绪";

      const url = result.params.url?.trim();
      if (!url) return "请提供要取消的 RSS 源地址";

      const { adapterName, channelType, channelId } = extractChannelInfo(message);
      const rows: any[] = await Subs.select().where({
        url,
        adapter_name: adapterName,
        channel_type: channelType,
        channel_id: channelId,
      });

      if (rows.length === 0) return "未找到该订阅";

      await Subs.delete().where({ id: rows[0].id });
      return `已取消订阅: ${rows[0].feed_title || url}`;
    }),
);

// ─── 命令：rss-list ──────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("rss-list")
    .desc("订阅列表", "查看当前会话的所有 RSS 订阅")
    .action(async (message: any) => {
      const Subs = getSubs();
      if (!Subs) return "RSS 数据库尚未就绪";

      const { adapterName, channelType, channelId } = extractChannelInfo(message);
      const rows: any[] = await Subs.select().where({
        adapter_name: adapterName,
        channel_type: channelType,
        channel_id: channelId,
      });

      if (rows.length === 0) return "当前会话没有订阅任何 RSS 源\n使用 rss-add <URL> 添加订阅";

      const lines = rows.map((r: any, i: number) => {
        const title = r.feed_title || "(未知标题)";
        return `${i + 1}. ${title}\n   ${r.url}`;
      });

      return `当前订阅 (${rows.length}/${config.maxPerGroup})：\n${lines.join("\n")}`;
    }),
);

// ─── 命令：rss-check ─────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("rss-check [url:text]")
    .desc("检查更新", "手动触发检查 RSS 更新，可指定某个源")
    .usage("rss-check [URL]")
    .action(async (message: any, result: any) => {
      const Subs = getSubs();
      const Seen = getSeen();
      if (!Subs || !Seen) return "RSS 数据库尚未就绪";

      const targetUrl = result.params.url?.trim();
      const { adapterName, channelType, channelId } = extractChannelInfo(message);

      let subs: any[];
      if (targetUrl) {
        subs = await Subs.select().where({
          url: targetUrl,
          adapter_name: adapterName,
          channel_type: channelType,
          channel_id: channelId,
        });
        if (subs.length === 0) return "当前会话未订阅该源";
      } else {
        subs = await Subs.select().where({
          adapter_name: adapterName,
          channel_type: channelType,
          channel_id: channelId,
        });
        if (subs.length === 0) return "当前会话没有任何订阅";
      }

      const urlSet = new Set(subs.map((s: any) => s.url));
      let totalNew = 0;

      for (const url of urlSet) {
        try {
          const { title, items } = await fetchFeed(url);
          const seenRows: any[] = await Seen.select().where({ feed_url: url });
          const seenGuids = new Set(seenRows.map((r: any) => r.item_guid));
          const newItems = items.filter((item) => !seenGuids.has(item.guid));

          if (newItems.length > 0) {
            for (const item of newItems) {
              await Seen.insert({ feed_url: url, item_guid: item.guid, item_title: item.title, seen_at: ts() });
            }
            totalNew += newItems.length;
            const msg = formatItems(title, newItems);
            await pushToChannel(adapterName, subs[0].bot_id, channelType, channelId, msg);
          }
        } catch (e) {
          await message.$reply(`检查 ${url} 失败: ${(e as Error).message}`);
        }
      }

      if (totalNew === 0) return `已检查 ${urlSet.size} 个源，没有新内容`;
      return "";
    }),
);

// ─── 命令：rss-preview ───────────────────────────────────────────────────────

addCommand(
  new MessageCommand("rss-preview <url:text>")
    .desc("预览 RSS", "预览一个 RSS 源的最新内容（不订阅）")
    .usage("rss-preview <URL>")
    .examples("rss-preview https://sspai.com/feed")
    .action(async (_message: any, result: any) => {
      const url = result.params.url?.trim();
      if (!url) return "请提供 RSS 源地址";
      if (!/^https?:\/\//i.test(url)) return "请提供有效的 HTTP/HTTPS 地址";

      try {
        const { title, items } = await fetchFeed(url);
        if (items.length === 0) return `${title}: 暂无内容`;

        const lines = [`${title} (共 ${items.length} 条)`];
        for (const item of items.slice(0, 5)) {
          lines.push("");
          lines.push(`${item.title}`);
          if (item.date) lines.push(`  ${new Date(item.date).toLocaleString("zh-CN")}`);
          if (item.link) lines.push(`  ${item.link}`);
        }
        if (items.length > 5) lines.push(`\n...还有 ${items.length - 5} 条`);
        return lines.join("\n");
      } catch (e) {
        return `解析失败: ${(e as Error).message}\n请确认是有效的 RSS/Atom 地址`;
      }
    }),
);

// ─── AI 工具 ─────────────────────────────────────────────────────────────────

plugin.addTool(
  new ZhinTool("rss_list_subscriptions")
    .desc("查询当前所有 RSS 订阅")
    .execute(async () => {
      const Subs = getSubs();
      if (!Subs) return "RSS 数据库尚未就绪";

      const all: any[] = await Subs.select();
      if (all.length === 0) return "暂无任何 RSS 订阅";

      const grouped = new Map<string, any[]>();
      for (const sub of all) {
        const key = `${sub.channel_type}:${sub.channel_id}`;
        const list = grouped.get(key) || [];
        list.push(sub);
        grouped.set(key, list);
      }

      const lines: string[] = [];
      for (const [channel, subs] of grouped) {
        lines.push(`[${channel}]`);
        for (const s of subs) {
          lines.push(`  - ${s.feed_title || s.url}`);
        }
      }
      return `RSS 订阅总览 (${all.length} 条):\n${lines.join("\n")}`;
    })
    .toTool(),
);

plugin.addTool(
  new ZhinTool("rss_preview_feed")
    .desc("预览一个 RSS 源的最新内容")
    .param("url", { type: "string", description: "RSS/Atom 源地址" })
    .execute(async (args: Record<string, any>) => {
      const url = args.url as string;
      if (!url) return "请提供 RSS 源 URL";
      try {
        const { title, items } = await fetchFeed(url);
        if (items.length === 0) return `${title}: 无内容`;
        return items
          .slice(0, 5)
          .map((item, i) => `${i + 1}. ${item.title}\n   ${item.link}`)
          .join("\n");
      } catch (e) {
        return `解析失败: ${(e as Error).message}`;
      }
    })
    .toTool(),
);

// ─── Skill 声明 ──────────────────────────────────────────────────────────────

declareSkill({
  description:
    "RSS/Atom 订阅推送系统：订阅 RSS 源并自动推送新内容到群聊或私聊。支持订阅管理、手动检查、预览。可用 AI 工具查询订阅和预览 feed。",
  keywords: [
    "rss", "atom", "feed", "订阅", "推送",
    "rss-add", "rss-remove", "rss-list", "rss-check", "rss-preview",
    "subscribe", "unsubscribe",
  ],
  tags: ["rss", "feed", "subscription", "push"],
});

logger.info(`插件已加载 (轮询=${config.pollCron}, 上限=${config.maxPerGroup}/会话)`);
