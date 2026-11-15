/**
 * Filters for `zhin logs` (#1250 `logs-cli-no-filter`): by level, time, logger name (the `[name]`
 * segment) and text. A log line carries no plugin field, so "which plugin" means the logger name.
 *
 * An entry is a line `parseLogLine` recognises (`[date time][LEVEL] [name] message`) plus the
 * lines after it that are not entries themselves (stack traces, tables, third-party output); those
 * follow the entry they belong to.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { isLogLevelEnabled, parseLogLine, type LogLevel } from '@zhin.js/logger';

export type LogFilterLevel = Exclude<LogLevel, 'silent'>;

export const LOG_FILTER_LEVELS: readonly LogFilterLevel[] = Object.freeze(['debug', 'info', 'warn', 'error']);

export interface LogFilterOptions {
  /** Entries at this level or above. */
  readonly level?: LogFilterLevel;
  readonly since?: Date;
  readonly until?: Date;
  /** Case-insensitive substring of the line (colours removed). */
  readonly grep?: string;
  /** Logger name: equal, or a prefix followed by `:` / `.` (`icqq` matches `icqq:12345`). */
  readonly name?: string;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'gu');

export function hasLogFilter(options: LogFilterOptions): boolean {
  return options.level !== undefined || options.since !== undefined || options.until !== undefined
    || options.grep !== undefined || options.name !== undefined;
}

export function parseLogFilterLevel(value: string): LogFilterLevel {
  const level = value.trim().toLowerCase();
  if (!(LOG_FILTER_LEVELS as readonly string[]).includes(level)) throw new Error(`--level 必须是 ${LOG_FILTER_LEVELS.join(' / ')} 之一`);
  return level as LogFilterLevel;
}

const RELATIVE = /^(\d+)\s*(s|m|h|d)$/u;
const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/u;

/**
 * `--since` / `--until`: a duration before now (`30s`, `10m`, `1h`, `2d`), a clock time today
 * (`09:00`), a local date or date-time (`2026-11-15`, `2026-11-15 09:00`), or an ISO time with
 * a zone (`2026-11-15T01:00:00Z`).
 */
export function parseLogTime(value: string, option: string, now: Date = new Date()): Date {
  const text = value.trim();
  const relative = RELATIVE.exec(text);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * UNIT_MS[relative[2] as keyof typeof UNIT_MS]);
  const clock = CLOCK.exec(text);
  if (clock && Number(clock[1]) < 24) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0));
  }
  const local = LOCAL_DATE_TIME.exec(text);
  if (local) {
    const [, year, month, day, hours, minutes, seconds, millis] = local;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hours ?? 0), Number(minutes ?? 0), Number(seconds ?? 0), Number((millis ?? '0').padEnd(3, '0')));
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/u.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return date;
  }
  throw new Error(`${option} 无法识别「${value}」：可写 10m / 1h / 2d、09:00、2026-11-15 09:00 或带时区的 ISO 时间`);
}

function nameMatches(category: string | undefined, name: string): boolean {
  if (!category) return false;
  const actual = category.toLowerCase();
  const wanted = name.toLowerCase();
  return actual === wanted || actual.startsWith(`${wanted}:`) || actual.startsWith(`${wanted}.`);
}

/** Line-by-line filter that keeps the entry a continuation line belongs to. */
export class LogLineFilter {
  readonly #options: LogFilterOptions;
  readonly #grep: string | undefined;
  readonly #structural: boolean;
  /** The current entry passes level / name / time. */
  #entryPasses = false;
  /** The current entry is shown (structural filters and, when given, the text). */
  #entryShown = false;
  #inEntry = false;
  #undated = 0;

  constructor(options: LogFilterOptions) {
    this.#options = options;
    this.#grep = options.grep?.toLowerCase();
    this.#structural = options.level !== undefined || options.name !== undefined || options.since !== undefined || options.until !== undefined;
  }

  /** Entries skipped by `--since` / `--until` because their line has no date (written before the upgrade). */
  get undatedSkipped(): number { return this.#undated; }

  /**
   * Whether `line` is shown. `capturedAt` (epoch ms) is the time the gateway captured it, used
   * when the line itself carries no date.
   */
  accept(line: string, capturedAt?: number): boolean {
    const textMatches = this.#grep === undefined || line.replace(ANSI, '').toLowerCase().includes(this.#grep);
    const entry = parseLogLine(line);
    if (!entry) {
      // Before any entry: only a text filter can say anything about it.
      if (!this.#inEntry) return !this.#structural && textMatches;
      return this.#entryShown || (this.#entryPasses && this.#grep !== undefined && textMatches);
    }
    this.#inEntry = true;
    this.#entryPasses = this.#passes(entry, capturedAt);
    this.#entryShown = this.#entryPasses && textMatches;
    return this.#entryShown;
  }

  #passes(entry: NonNullable<ReturnType<typeof parseLogLine>>, capturedAt: number | undefined): boolean {
    const { level, name, since, until } = this.#options;
    if (level !== undefined && (entry.level === 'silent' || !isLogLevelEnabled(entry.level, level))) return false;
    if (name !== undefined && !nameMatches(entry.category, name)) return false;
    if (since !== undefined || until !== undefined) {
      const time = entry.timestamp?.getTime() ?? capturedAt;
      if (time === undefined) {
        this.#undated += 1;
        return false;
      }
      if (since !== undefined && time < since.getTime()) return false;
      if (until !== undefined && time > until.getTime()) return false;
    }
    return true;
  }
}

/** The instance log and its rotated files (`.1` is the newest of those), oldest first. */
export function instanceLogFiles(file: string): string[] {
  const rotated: string[] = [];
  for (let index = 1; index <= 100 && existsSync(`${file}.${index}`); index += 1) rotated.push(`${file}.${index}`);
  return [...rotated.reverse(), ...(existsSync(file) ? [file] : [])];
}

export interface FilteredHistory {
  /** The last `limit` matching lines, oldest first. */
  readonly lines: readonly string[];
  /** All matching lines (before `limit`). */
  readonly matched: number;
}

/** Reads `files` in order and keeps the last `limit` lines the filter accepts. */
export async function readFilteredHistory(files: readonly string[], filter: LogLineFilter, limit: number): Promise<FilteredHistory> {
  const kept: string[] = [];
  let matched = 0;
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!filter.accept(line)) continue;
      matched += 1;
      kept.push(line);
      if (kept.length > limit) kept.shift();
    }
  }
  return { lines: kept, matched };
}
