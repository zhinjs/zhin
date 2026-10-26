import { Schema } from 'zhin.js';

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const DEFAULT_REPORT_TIME = '22:00';

export const ledgerConfig = Schema.object({
  timezone: Schema.string().default(DEFAULT_TIMEZONE).description('计算今日、本周（周一开始）、本月与日报日期所用的 IANA 时区').i18n({"en": {"description": "IANA timezone used to calculate today, this week (starting Monday), this month and daily-report dates."}}).effect('reload'),
  reportTime: Schema.string().default(DEFAULT_REPORT_TIME).description('记账日报的发送时间（HH:MM，按 timezone）；只发给用「记账日报 开启」订阅的用户').i18n({"en": {"description": "Daily ledger report time (HH:MM in timezone); sent only to users who explicitly subscribed to daily reports."}}).effect('reload'),
  reportWhenEmpty: Schema.boolean().default(false).description('当天没有记账时是否仍发送日报').i18n({"en": {"description": "Send a daily report even when no transactions were recorded that day."}}).effect('reload'),
});

export type LedgerConfig = Schema.Output<typeof ledgerConfig>;

export interface ResolvedLedgerConfig {
  readonly timezone: string;
  readonly reportTime: string;
  readonly reportWhenEmpty: boolean;
}

const REPORT_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function assertTimezone(timezone: string): void {
  try {
    if (!timezone || timezone !== timezone.trim() || /^[+-]/u.test(timezone)) throw new RangeError('Invalid IANA timezone');
    new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }).format(0);
  } catch {
    throw new TypeError(`记账 timezone 必须是有效的 IANA 时区：${timezone}`);
  }
}

/** Applies defaults and fails setup on an invalid timezone or report time instead of guessing. */
export function resolveLedgerConfig(config: Partial<LedgerConfig> | undefined): ResolvedLedgerConfig {
  const timezone = config?.timezone ?? DEFAULT_TIMEZONE;
  const reportTime = config?.reportTime ?? DEFAULT_REPORT_TIME;
  const reportWhenEmpty = config?.reportWhenEmpty ?? false;
  assertTimezone(timezone);
  if (!REPORT_TIME_PATTERN.test(reportTime)) throw new TypeError(`记账 reportTime 必须是 HH:MM：${reportTime}`);
  return { timezone, reportTime, reportWhenEmpty };
}
