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

/**
 * Case-insensitive, but the kind keeps its canonical spelling: `freeDay` lowercased used to fall
 * through to `solar` (#1250 b90).
 */
function canonicalScheduleKind(kind: string): CronScheduleKind {
  const lower = kind.toLowerCase();
  return lower === 'freeday' ? 'freeDay' : lower as CronScheduleKind;
}

/**
 * 未显式指定 schedule_kind 时：solar + 周一段 `1-5` → workday
 * （中国大陆法定工作日，含调休上班日，不是公历周一至周五）
 */
export function inferScheduleKindFromCron(
  kind: string | undefined,
  cron: string,
): CronScheduleKind {
  const normalized = canonicalScheduleKind(kind || 'solar');
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

/**
 * #1250 b99: whether `tz` is a time zone this runtime knows (an IANA name such as `Asia/Shanghai`,
 * `Etc/GMT-8` or `UTC`). The scheduler resolves zones through `Intl` as well, so a zone accepted here is
 * one it can run; anything else used to be saved and only fail when the job was registered.
 */
export function isValidScheduleTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param options.inferWorkday `false`: take `kindInput` as given (an explicit or kept kind on
 *   `schedule_update`, #1250 b90), without turning solar `1-5` into workday. Default `true`.
 */
export function buildJobScheduleFromCronInput(
  kindInput: string | undefined,
  cron: string,
  tz?: string,
  options: Readonly<{ inferWorkday?: boolean }> = {},
): JobSchedule | { error: string } {
  const trimmed = cron?.trim();
  if (!trimmed) return { error: '请提供 6 段 cron 表达式（秒 分 时 日 月 周）' };
  // #1250 b99: an unknown zone is refused before anything is saved (it may also be arbitrary text).
  if (tz !== undefined && tz !== '' && !isValidScheduleTimeZone(tz)) {
    return { error: '时区无效：请使用 IANA 时区名，例如 Asia/Shanghai、Etc/GMT-8 或 UTC' };
  }

  const kind = options.inferWorkday === false && kindInput
    ? canonicalScheduleKind(kindInput)
    : inferScheduleKindFromCron(kindInput, trimmed);
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
