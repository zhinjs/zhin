import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "google": {
    "zh-CN": "Google 日历",
    "en": "Google Calendar"
  },
  "microsoft": {
    "zh-CN": "Outlook 日历",
    "en": "Outlook Calendar"
  },
  "providerInput": {
    "zh-CN": "请选择 google 或 microsoft（outlook）",
    "en": "Choose google or microsoft (outlook)."
  },
  "usage": {
    "zh-CN": "用法：{command} google | {command} microsoft",
    "en": "Usage: {command} google | {command} microsoft"
  },
  "chatRequired": {
    "zh-CN": "请在私聊或群聊中发送该命令",
    "en": "Send this command in a private or group conversation."
  },
  "needsDatabase": {
    "zh-CN": "日历授权需要数据库（databaseHostToken）来保存 refresh_token，当前不可用。",
    "en": "Calendar authorization needs a database (databaseHostToken) to store refresh_token; it is currently unavailable."
  },
  "needsHttp": {
    "zh-CN": "未找到 HTTP 服务地址：请启用 zhin 的 HTTP Host，或在 plugins.calendar.oauth_redirect_base_url 配置外部可访问地址。",
    "en": "No HTTP service address was found. Enable the Zhin HTTP Host or configure a publicly reachable oauth_redirect_base_url for this calendar instance."
  },
  "openLink": {
    "zh-CN": "请在浏览器打开下面的链接完成{provider}授权（{minutes} 分钟内有效，只能使用一次）：",
    "en": "Open the link below in your browser to authorize {provider}. It expires in {minutes} minutes and can be used once:"
  },
  "callback": {
    "zh-CN": "回调地址：{url}",
    "en": "Callback URL: {url}"
  },
  "callbackHelp": {
    "zh-CN": "该地址必须能从打开链接的浏览器访问，并已登记在 OAuth 客户端的重定向 URI 中。",
    "en": "This URL must be reachable from your browser and registered as a redirect URI in the OAuth client."
  },
  "invalidLink": {
    "zh-CN": "授权链接无效、已使用或已过期，请回到聊天重新发起日历授权。",
    "en": "This authorization link is invalid, already used or expired. Start calendar authorization again from chat."
  },
  "failed": {
    "zh-CN": "{provider}授权失败：{detail}",
    "en": "{provider} authorization failed: {detail}"
  },
  "callbackFailed": {
    "zh-CN": "授权失败：{detail}",
    "en": "Authorization failed: {detail}"
  },
  "codeMissing": {
    "zh-CN": "缺少授权码或客户端配置，请重新授权。",
    "en": "The authorization code or client configuration is missing. Start authorization again."
  },
  "otherProvider": {
    "zh-CN": "\n注意：当前 plugins.calendar.provider 是 {current}，日历工具不会使用 {provider}。",
    "en": "\nNote: the current calendar provider is {current}; calendar tools will not use {provider}."
  },
  "authorized": {
    "zh-CN": "{provider}授权成功，refresh_token 已保存到插件数据库。{hint}",
    "en": "{provider} authorization succeeded. The refresh token was saved in the plugin database.{hint}"
  },
  "callbackSuccess": {
    "zh-CN": "授权成功，可以关闭此页回到聊天。",
    "en": "Authorization succeeded. You can close this page and return to chat."
  },
  "currentProvider": {
    "zh-CN": "当前 provider：{provider}",
    "en": "Current provider: {provider}"
  },
  "noDatabase": {
    "zh-CN": "数据库不可用，没有可删除的授权。",
    "en": "The database is unavailable; there is no stored authorization to remove."
  },
  "loggedOut": {
    "zh-CN": "已删除{provider}在插件数据库中的授权。若 .env 里仍有 refresh_token，重载配置后会继续作为后备使用。",
    "en": "Removed the {provider} authorization from the plugin database. A refresh token still configured in .env remains a fallback after configuration reload."
  },
  "lost": {
    "zh-CN": "{provider}：授权已失效，请通过日历授权入口重新授权。",
    "en": "{provider}: authorization expired or was revoked. Use the calendar authorization entry to authorize again."
  },
  "notAuthorized": {
    "zh-CN": "{provider}：尚未授权，请通过日历授权入口完成授权。",
    "en": "{provider}: not authorized. Use the calendar authorization entry to authorize."
  },
  "commandHint": {
    "zh-CN": "请发送「{command}」。",
    "en": "Send \"{command}\"."
  },
  "clientMissing": {
    "zh-CN": "{provider}：未配置 client_id",
    "en": "{provider}: client_id is not configured"
  },
  "databaseStatus": {
    "zh-CN": "{provider}：已授权（数据库，{at}）",
    "en": "{provider}: authorized (database, {at})"
  },
  "envStatus": {
    "zh-CN": "{provider}：使用配置/环境变量中的 refresh_token",
    "en": "{provider}: using refresh_token from configuration or environment variables"
  },
  "googleClient": {
    "zh-CN": "请先在 plugins.calendar.google 配置 client_id 和 client_secret（例如 GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET 环境变量）。",
    "en": "Configure client_id and client_secret for the calendar Google client first, for example using the GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET environment variables."
  },
  "microsoftClient": {
    "zh-CN": "请先在 plugins.calendar.microsoft 配置 client_id（例如 MS_GRAPH_CLIENT_ID 环境变量）。",
    "en": "Configure client_id for the calendar Microsoft client first, for example using the MS_GRAPH_CLIENT_ID environment variable."
  },
  "disabled": {
    "zh-CN": "日历未启用：请先配置 provider 与凭据",
    "en": "Calendar is disabled. Configure a provider and credentials first."
  },
  "noEvents": {
    "zh-CN": "（{provider}）{from} ~ {to} 没有事件",
    "en": "({provider}) No events from {from} to {to}."
  },
  "noFreeTime": {
    "zh-CN": "在工作时段（{start}-{end} {timezone}）没有足够的空闲",
    "en": "No sufficiently long free slot during work hours ({start}–{end} {timezone})."
  },
  "eventCreated": {
    "zh-CN": "已创建事件 [{id}]\n{title}\n{start} → {end}（{timezone}）",
    "en": "Event created [{id}]\n{title}\n{start} → {end} ({timezone})"
  }
});
