/**
 * Schedule cron 规范化 — profile / schedule_add 共用
 */
import type { JobSchedule } from './assistant/types.js';

export type CronScheduleKind = 'solar' | 'lunar' | 'workday' | 'freeDay' | 'holiday';

/** solar + 周一到周五 cron 的常见误用（应使用 workday 语义） */
const SOLAR_WEEKDAY_RANGE = /^(1-5|mon-fri|1,2,3,4,5)$/i;

const CALENDAR_KINDS = new Set<CronScheduleKind>(['workday', 'freeDay', 'holiday']);

function splitCronFields(cron: string): string[] {
  return cron.trim().split(/\s+/).filter(Boolean);
}

/** 5 段 cron 补秒字段为 6 段 */
export function toSixFieldCron(cron: string): string {
  const parts = splitCronFields(cron);
  if (parts.length === 5) return ['0', ...parts].join(' ');
  return cron.trim();
}

/**
 * 未显式指定 schedule_kind 时：solar + 周一段 `1-5` → workday
 * （中国大陆法定工作日，含调休上班日，不是公历周一至周五）
 */
export function inferScheduleKindFromCron(
  kind: string | undefined,
  cron: string,
): CronScheduleKind {
  const normalized = (kind || 'solar').toLowerCase() as CronScheduleKind;
  if (normalized !== 'solar') return normalized;
  const parts = splitCronFields(cron);
  const dow = parts.length === 6 ? parts[5] : parts.length === 5 ? parts[4] : '';
  if (dow && SOLAR_WEEKDAY_RANGE.test(dow.trim())) return 'workday';
  return 'solar';
}

/** workday/freeDay/holiday 的日/月/周应为 `*`，仅时刻由 cron 决定 */
export function normalizeCronForScheduleKind(kind: CronScheduleKind, cron: string): string {
  let parts = splitCronFields(cron);
  if (parts.length === 5) parts = ['0', ...parts];
  if (parts.length !== 6) return cron.trim();
  if (CALENDAR_KINDS.has(kind)) {
    parts[3] = '*';
    parts[4] = '*';
    parts[5] = '*';
  }
  return parts.join(' ');
}

export function buildJobScheduleFromCronInput(
  kindInput: string | undefined,
  cron: string,
  tz?: string,
): JobSchedule | { error: string } {
  const trimmed = cron?.trim();
  if (!trimmed) return { error: '请提供 6 段 cron 表达式（秒 分 时 日 月 周）' };

  const kind = inferScheduleKindFromCron(kindInput, trimmed);
  const normalizedCron = normalizeCronForScheduleKind(kind, trimmed);
  const tzOpt = tz ? { tz } : {};

  switch (kind) {
    case 'lunar':
      return { kind: 'lunar', cron: normalizedCron, ...tzOpt };
    case 'workday':
      return { kind: 'workday', cron: normalizedCron, ...tzOpt };
    case 'freeDay':
      return { kind: 'freeDay', cron: normalizedCron, ...tzOpt };
    case 'holiday':
      return { kind: 'holiday', cron: normalizedCron, ...tzOpt };
    default:
      return { kind: 'solar', cron: normalizedCron, ...tzOpt };
  }
}
