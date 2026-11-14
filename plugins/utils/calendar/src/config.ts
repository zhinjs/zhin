import { Schema } from "zhin.js";

export const calendarConfig = Schema.object({
  provider: Schema.union([
    Schema.const("none"),
    Schema.const("caldav"),
    Schema.const("google"),
    Schema.const("microsoft"),
  ])
    .default("none")
    .description("日历后端；none 时工具返回未启用提示").i18n({"zh-CN": {"title": "日历后端"}, "en": {"title": "Calendar backend", "description": "Calendar backend. Tools report that the calendar is disabled when set to none."}})
    .effect("reload")
    .fieldLevels(["global"]),
  timezone: Schema.string()
    .default("Asia/Manila")
    .description("解释无偏移时间与展示用的 IANA 时区").i18n({"zh-CN": {"title": "时区"}, "en": {"title": "Timezone", "description": "IANA timezone for interpreting times without offsets and for display."}})
    .effect("reload")
    .fieldLevels(["global"]),
  work_day_start: Schema.string().default("09:00").i18n({"zh-CN": {"title": "工作日开始时间", "description": "空闲时段计算使用的每日开始时间（HH:MM）"}, "en": {"title": "Workday start", "description": "Daily start time used for free-time lookups (HH:MM)."}}).effect("reload").fieldLevels(["global"]),
  work_day_end: Schema.string().default("18:00").i18n({"zh-CN": {"title": "工作日结束时间", "description": "空闲时段计算使用的每日结束时间（HH:MM）"}, "en": {"title": "Workday end", "description": "Daily end time used for free-time lookups (HH:MM)."}}).effect("reload").fieldLevels(["global"]),
  oauth_redirect_base_url: Schema.string()
    .default("")
    .description(
      "聊天授权回调的外部基础地址（如 https://bot.example.com）；留空时使用 zhin HTTP Host 的本机地址"
    ).i18n({"zh-CN": {"title": "授权回调地址"}, "en": {"title": "OAuth redirect base URL", "description": "External base URL for the chat authorization callback (such as https://bot.example.com). Uses the local address of the zhin HTTP Host when empty."}})
    .effect("reload")
    .fieldLevels(["global"]),
  oauth_callback_path: Schema.string()
    .default("/calendar/oauth/callback")
    .description(
      "聊天授权回调路由，挂在 zhin HTTP Host 上；反向代理/隧道只转发部分路径时可调整"
    ).i18n({"zh-CN": {"title": "授权回调路径"}, "en": {"title": "OAuth callback path", "description": "Authorization callback route on the zhin HTTP Host. Adjust it when a reverse proxy or tunnel forwards only some paths."}})
    .effect("reload")
    .fieldLevels(["global"]),
  caldav: Schema.object({
    enabled: Schema.boolean().default(false).i18n({"zh-CN": {"title": "启用 CalDAV"}, "en": {"title": "Enable CalDAV"}}),
    calendar_url: Schema.string()
      .default("")
      .description("日历 collection URL").i18n({"zh-CN": {"title": "日历地址"}, "en": {"title": "Calendar URL", "description": "Calendar collection URL."}})
      .effect("reload"),
    username: Schema.string().default("").i18n({"zh-CN": {"title": "用户名"}, "en": {"title": "Username"}}).effect("reload"),
    password: Schema.string().default("").i18n({"zh-CN": {"title": "密码", "description": "建议写成环境变量引用"}, "en": {"title": "Password", "description": "Prefer an environment-variable reference."}}).effect("reload"),
  }).i18n({"zh-CN": {"title": "CalDAV"}, "en": {"title": "CalDAV"}}).fieldLevels(["global"]),
  google: Schema.object({
    enabled: Schema.boolean().default(false).i18n({"zh-CN": {"title": "启用 Google 日历"}, "en": {"title": "Enable Google Calendar"}}),
    client_id: Schema.string()
      .default("")
      .description("${GOOGLE_CALENDAR_CLIENT_ID}").i18n({"zh-CN": {"title": "Client ID"}, "en": {"title": "Client ID"}})
      .effect("reload"),
    client_secret: Schema.string()
      .default("")
      .description("${GOOGLE_CALENDAR_CLIENT_SECRET}").i18n({"zh-CN": {"title": "Client Secret"}, "en": {"title": "Client secret"}})
      .effect("reload"),
    refresh_token: Schema.string()
      .default("")
      .description("${GOOGLE_CALENDAR_REFRESH_TOKEN}；用 auth google 获取").i18n({"zh-CN": {"title": "Refresh Token"}, "en": {"title": "Refresh token", "description": "${GOOGLE_CALENDAR_REFRESH_TOKEN}; obtain using the calendar authorization flow."}})
      .effect("reload"),
    calendar_id: Schema.string()
      .default("primary")
      .description("日历 ID，默认 primary；可换成其它日历的 id").i18n({"zh-CN": {"title": "日历 ID"}, "en": {"title": "Calendar ID", "description": "Calendar ID, primary by default; can be set to another calendar ID."}})
      .effect("reload"),
    token_file: Schema.string()
      .default("")
      .description(
        "可选：持久化轮换后的 refresh_token 的 JSON 路径（如 data/calendar-google-token.json）"
      ).i18n({"zh-CN": {"title": "Token 文件"}, "en": {"title": "Token file", "description": "Optional JSON path that persists the rotated refresh_token (such as data/calendar-google-token.json)."}})
      .effect("reload"),
  }).i18n({"zh-CN": {"title": "Google 日历"}, "en": {"title": "Google Calendar"}}).fieldLevels(["global"]),
  microsoft: Schema.object({
    enabled: Schema.boolean().default(false).i18n({"zh-CN": {"title": "启用 Microsoft 日历"}, "en": {"title": "Enable Microsoft Calendar"}}),
    client_id: Schema.string()
      .default("")
      .description("${MS_GRAPH_CLIENT_ID}").i18n({"zh-CN": {"title": "Client ID"}, "en": {"title": "Client ID"}})
      .effect("reload"),
    client_secret: Schema.string()
      .default("")
      .description("可选；公共客户端可留空。${MS_GRAPH_CLIENT_SECRET}").i18n({"zh-CN": {"title": "Client Secret"}, "en": {"title": "Client secret", "description": "Optional for public clients. ${MS_GRAPH_CLIENT_SECRET}"}})
      .effect("reload"),
    refresh_token: Schema.string()
      .default("")
      .description("${MS_GRAPH_REFRESH_TOKEN}；用 auth microsoft 获取").i18n({"zh-CN": {"title": "Refresh Token"}, "en": {"title": "Refresh token", "description": "${MS_GRAPH_REFRESH_TOKEN}; obtain using the calendar authorization flow."}})
      .effect("reload"),
    tenant: Schema.string()
      .default("common")
      .description("Azure tenant，默认 common").i18n({"zh-CN": {"title": "租户"}, "en": {"title": "Tenant", "description": "Azure tenant, common by default."}})
      .effect("reload"),
    calendar_id: Schema.string()
      .default("")
      .description("留空或 primary/me = 默认日历；否则为 Graph calendar id").i18n({"zh-CN": {"title": "日历 ID"}, "en": {"title": "Calendar ID", "description": "Empty, primary or me selects the default calendar; otherwise a Graph calendar ID."}})
      .effect("reload"),
    token_file: Schema.string()
      .default("")
      .description(
        "可选：持久化轮换后的 refresh_token 的 JSON 路径（如 data/calendar-ms-token.json）"
      ).i18n({"zh-CN": {"title": "Token 文件"}, "en": {"title": "Token file", "description": "Optional JSON path that persists the rotated refresh_token (such as data/calendar-ms-token.json)."}})
      .effect("reload"),
  }).i18n({"zh-CN": {"title": "Microsoft 日历"}, "en": {"title": "Microsoft Calendar"}}).fieldLevels(["global"]),
  // ADR 0050 / 0055: one shared calendar backend, so every field stays global; the switch works at every level.
}).featureLevels(["global", "adapter", "endpoint", "conversation"]);

export type CalendarConfig = Schema.Output<typeof calendarConfig>;

export function assertCalendarTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: timezone }).format(0);
  } catch {
    throw new TypeError(
      `calendar timezone 必须是有效的 IANA 时区：${timezone}`
    );
  }
}

export { cleanSecret } from "./secrets.js";
