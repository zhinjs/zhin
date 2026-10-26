import { Schema } from "zhin.js";

export const calendarConfig = Schema.object({
  provider: Schema.union([
    Schema.const("none"),
    Schema.const("caldav"),
    Schema.const("google"),
    Schema.const("microsoft"),
  ])
    .default("none")
    .description("日历后端；none 时工具返回未启用提示").i18n({"en": {"description": "Calendar backend. Tools report that the calendar is disabled when set to none."}})
    .effect("reload"),
  timezone: Schema.string()
    .default("Asia/Manila")
    .description("解释无偏移时间与展示用的 IANA 时区").i18n({"en": {"description": "IANA timezone for interpreting times without offsets and for display."}})
    .effect("reload"),
  work_day_start: Schema.string().default("09:00").effect("reload"),
  work_day_end: Schema.string().default("18:00").effect("reload"),
  oauth_redirect_base_url: Schema.string()
    .default("")
    .description(
      "聊天授权回调的外部基础地址（如 https://bot.example.com）；留空时使用 zhin HTTP Host 的本机地址"
    )
    .effect("reload"),
  oauth_callback_path: Schema.string()
    .default("/calendar/oauth/callback")
    .description(
      "聊天授权回调路由，挂在 zhin HTTP Host 上；反向代理/隧道只转发部分路径时可调整"
    )
    .effect("reload"),
  caldav: Schema.object({
    enabled: Schema.boolean().default(false),
    calendar_url: Schema.string()
      .default("")
      .description("日历 collection URL").i18n({"en": {"description": "Calendar collection URL."}})
      .effect("reload"),
    username: Schema.string().default("").effect("reload"),
    password: Schema.string().default("").effect("reload"),
  }),
  google: Schema.object({
    enabled: Schema.boolean().default(false),
    client_id: Schema.string()
      .default("")
      .description("${GOOGLE_CALENDAR_CLIENT_ID}")
      .effect("reload"),
    client_secret: Schema.string()
      .default("")
      .description("${GOOGLE_CALENDAR_CLIENT_SECRET}")
      .effect("reload"),
    refresh_token: Schema.string()
      .default("")
      .description("${GOOGLE_CALENDAR_REFRESH_TOKEN}；用 auth google 获取").i18n({"en": {"description": "${GOOGLE_CALENDAR_REFRESH_TOKEN}; obtain using the calendar authorization flow."}})
      .effect("reload"),
    calendar_id: Schema.string()
      .default("primary")
      .description("日历 ID，默认 primary；可换成其它日历的 id").i18n({"en": {"description": "Calendar ID, primary by default; can be set to another calendar ID."}})
      .effect("reload"),
    token_file: Schema.string()
      .default("")
      .description(
        "可选：持久化轮换后的 refresh_token 的 JSON 路径（如 data/calendar-google-token.json）"
      )
      .effect("reload"),
  }),
  microsoft: Schema.object({
    enabled: Schema.boolean().default(false),
    client_id: Schema.string()
      .default("")
      .description("${MS_GRAPH_CLIENT_ID}")
      .effect("reload"),
    client_secret: Schema.string()
      .default("")
      .description("可选；公共客户端可留空。${MS_GRAPH_CLIENT_SECRET}").i18n({"en": {"description": "Optional for public clients. ${MS_GRAPH_CLIENT_SECRET}"}})
      .effect("reload"),
    refresh_token: Schema.string()
      .default("")
      .description("${MS_GRAPH_REFRESH_TOKEN}；用 auth microsoft 获取").i18n({"en": {"description": "${MS_GRAPH_REFRESH_TOKEN}; obtain using the calendar authorization flow."}})
      .effect("reload"),
    tenant: Schema.string()
      .default("common")
      .description("Azure tenant，默认 common").i18n({"en": {"description": "Azure tenant, common by default."}})
      .effect("reload"),
    calendar_id: Schema.string()
      .default("")
      .description("留空或 primary/me = 默认日历；否则为 Graph calendar id").i18n({"en": {"description": "Empty, primary or me selects the default calendar; otherwise a Graph calendar ID."}})
      .effect("reload"),
    token_file: Schema.string()
      .default("")
      .description(
        "可选：持久化轮换后的 refresh_token 的 JSON 路径（如 data/calendar-ms-token.json）"
      )
      .effect("reload"),
  }),
});

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
