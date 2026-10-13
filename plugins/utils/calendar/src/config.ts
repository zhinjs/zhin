import { Schema } from "zhin.js";

export const calendarConfig = Schema.object({
  provider: Schema.union([
    Schema.const("none"),
    Schema.const("caldav"),
    Schema.const("google"),
    Schema.const("microsoft"),
  ])
    .default("none")
    .description("日历后端；none 时工具返回未启用提示")
    .effect("reload"),
  timezone: Schema.string()
    .default("Asia/Manila")
    .description("解释无偏移时间与展示用的 IANA 时区")
    .effect("reload"),
  work_day_start: Schema.string().default("09:00").effect("reload"),
  work_day_end: Schema.string().default("18:00").effect("reload"),
  caldav: Schema.object({
    enabled: Schema.boolean().default(false),
    calendar_url: Schema.string()
      .default("")
      .description("日历 collection URL")
      .effect("reload"),
    username: Schema.string().default("").effect("reload"),
    password: Schema.string().default("").effect("reload"),
  }),
  google: Schema.object({
    enabled: Schema.boolean().default(false),
    access_token: Schema.string().default("").effect("reload"),
    refresh_token: Schema.string().default("").effect("reload"),
    client_id: Schema.string().default("").effect("reload"),
    client_secret: Schema.string().default("").effect("reload"),
    calendar_id: Schema.string().default("primary").effect("reload"),
  }),
  microsoft: Schema.object({
    enabled: Schema.boolean().default(false),
    access_token: Schema.string().default("").effect("reload"),
    refresh_token: Schema.string().default("").effect("reload"),
    client_id: Schema.string().default("").effect("reload"),
    client_secret: Schema.string().default("").effect("reload"),
    calendar_id: Schema.string().default("").effect("reload"),
    tenant: Schema.string().default("common").effect("reload"),
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
