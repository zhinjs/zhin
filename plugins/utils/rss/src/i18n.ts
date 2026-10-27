import { createMessages } from 'zhin.js/i18n';

export const rssMessages = createMessages({
  toolPreviewEmpty: { 'zh-CN': '{title}: 无内容', en: '{title}: No items' },
  toolPreviewFailed: { 'zh-CN': '解析失败: {error}', en: 'Parsing failed: {error}' },
  allEmpty: { 'zh-CN': '暂无任何 RSS 订阅', en: 'There are no RSS subscriptions' },
  allList: { 'zh-CN': 'RSS 订阅总览 ({count} 条):\n{items}', en: 'RSS subscriptions ({count}):\n{items}' },
  "databaseUnavailable": {
    "zh-CN": "RSS 数据库尚未就绪",
    "en": "The RSS database is not ready"
  },
  "databaseRetry": {
    "zh-CN": "RSS 数据库尚未就绪，请稍后重试",
    "en": "The RSS database is not ready; try again later"
  },
  "urlRequired": {
    "zh-CN": "请提供 RSS 源地址",
    "en": "Provide an RSS feed URL"
  },
  "httpRequired": {
    "zh-CN": "请提供有效的 HTTP/HTTPS 地址",
    "en": "Provide a valid HTTP/HTTPS URL"
  },
  "existing": {
    "zh-CN": "当前会话已订阅该源，无需重复添加",
    "en": "This conversation already subscribes to that feed"
  },
  "limit": {
    "zh-CN": "当前会话订阅数已达上限 ({max})，请先取消一些",
    "en": "This conversation has reached its subscription limit ({max}); remove a subscription first"
  },
  "loadFailed": {
    "zh-CN": "无法解析该地址: {error}\n请确认是有效的 RSS/Atom 源",
    "en": "Could not parse this URL: {error}\nCheck that it is a valid RSS/Atom feed"
  },
  "added": {
    "zh-CN": "订阅成功！\n源: {feed}\n新内容将在轮询时推送到本会话（需 OutboundHost）",
    "en": "Subscribed!\nFeed: {feed}\nNew items will be sent to this conversation when polled (requires OutboundHost)"
  },
  "empty": {
    "zh-CN": "当前会话没有订阅任何 RSS 源",
    "en": "This conversation has no RSS subscriptions"
  },
  "addHint": {
    "zh-CN": "使用 {command} <URL> 添加订阅",
    "en": "Use {command} <URL> to subscribe"
  },
  "unknownTitle": {
    "zh-CN": "(未知标题)",
    "en": "(Untitled)"
  },
  "list": {
    "zh-CN": "当前订阅 ({count}/{max})：\n{items}",
    "en": "Subscriptions ({count}/{max}):\n{items}"
  },
  "notSubscribed": {
    "zh-CN": "当前会话未订阅该源",
    "en": "This conversation does not subscribe to that feed"
  },
  "noSubscriptions": {
    "zh-CN": "当前会话没有任何订阅",
    "en": "This conversation has no subscriptions"
  },
  "removeUrl": {
    "zh-CN": "请提供要取消的 RSS 源地址",
    "en": "Provide the RSS feed URL to unsubscribe"
  },
  "notFound": {
    "zh-CN": "未找到该订阅",
    "en": "Subscription not found"
  },
  "removed": {
    "zh-CN": "已取消订阅: {feed}",
    "en": "Unsubscribed: {feed}"
  },
  "previewFailed": {
    "zh-CN": "解析失败: {error}\n请确认是有效的 RSS/Atom 地址",
    "en": "Parsing failed: {error}\nCheck that it is a valid RSS/Atom URL"
  },
  "channelRequired": {
    "zh-CN": "请在机器人私聊、群聊或频道内执行此命令；当前调用没有有效的订阅会话",
    "en": "Run this command in a bot private chat, group or channel; this invocation has no valid subscription conversation"
  },
  "unsupportedAddress": {
    "zh-CN": "暂不支持线程／父频道寻址的订阅，请在无需线程或父频道信息的会话内执行",
    "en": "Thread or parent-channel subscription addresses are not supported; use a conversation that does not require them"
  },
  "previewEmpty": {
    "zh-CN": "{title}: 暂无内容",
    "en": "{title}: No items"
  },
  "previewTitle": {
    "zh-CN": "{title} (共 {count} 条)",
    "en": "{title} ({count} items)"
  },
  "more": {
    "zh-CN": "\n...还有 {count} 条",
    "en": "\n...{count} more items"
  },
  "newItems": {
    "zh-CN": "{title} 有 {count} 条新内容：",
    "en": "{title}: {count} new items:"
  },
  "moreSource": {
    "zh-CN": "\n...还有 {count} 条，请查看源站",
    "en": "\n...{count} more items; visit the source website"
  },
  "noNew": {
    "zh-CN": "{title}: 无新内容",
    "en": "{title}: No new items"
  },
  "checkFailed": {
    "zh-CN": "{url}: 检查失败 — {error}",
    "en": "{url}: Check failed — {error}"
  },
  "nothingToCheck": {
    "zh-CN": "没有可检查的订阅",
    "en": "There are no subscriptions to check"
  },
  "pushed": {
    "zh-CN": "，已推送 {count} 个会话",
    "en": ", sent to {count} conversations"
  },
  "notPushed": {
    "zh-CN": "，无出站推送",
    "en": ", no outbound delivery"
  },
  "localOnly": {
    "zh-CN": "（未装配 OutboundHost，仅本地标记）",
    "en": " (OutboundHost is not configured; items were only marked locally)"
  },
  "checked": {
    "zh-CN": "检查完成，共 {count} 条新内容{pushNote}",
    "en": "Check complete: {count} new items{pushNote}"
  },
  "checkedEmpty": {
    "zh-CN": "检查完成，暂无新内容",
    "en": "Check complete: no new items"
  },
  "noFeeds": {
    "zh-CN": "暂无任何 RSS 订阅",
    "en": "There are no RSS subscriptions"
  },
  "summaryTitle": {
    "zh-CN": "RSS 静默摘要",
    "en": "RSS quiet-hours digest"
  },
  "summaryHeading": {
    "zh-CN": "RSS 静默摘要：累计检测到{minimum} {count} 条更新",
    "en": "RSS quiet-hours digest: detected {minimum} {count} updates"
  },
  "atLeast": {
    "zh-CN": "至少",
    "en": "at least"
  },
  "source": {
    "zh-CN": "来源：{url}",
    "en": "Source: {url}"
  },
  "untitled": {
    "zh-CN": "未命名文章",
    "en": "Untitled article"
  },
  "summaryMore": {
    "zh-CN": "仅展示 {count} 条短明细，其余请查看源站；计数基于有界轮询窗口。",
    "en": "Showing {count} short items; visit the source for the rest. Counts are based on the bounded polling window."
  }
});
