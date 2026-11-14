import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { definePluginStore } from 'zhin.js';

export interface NotifyChannel {
  type: 'webhook';
  target: string;
}

export interface ProcessMonitorConfig {
  enabled?: boolean;
  notifyChannels?: NotifyChannel[];
  notifyOnStart?: boolean;
  notifyOnRestart?: boolean;
  notifyOnCrash?: boolean;
}

export interface ProcessStartupEvent {
  readonly reason: 'restart' | 'crash';
  /** Epoch milliseconds of the startup that detected the event. */
  readonly at: number;
}

export interface ProcessState {
  lastPid?: number;
  lastStartTime?: number;
  lastAliveTime?: number;
  cleanExit?: boolean;
  /** Cumulative counters since {@link trackingSince}; they survive restarts in `process-state.json`. */
  restartCount: number;
  crashCount: number;
  totalUptime: number;
  /**
   * When the cumulative counters started (epoch ms). Files written before this field existed get
   * the file's creation time (or modification time) and `trackingSinceEstimated: true`.
   */
  trackingSince?: number;
  trackingSinceEstimated?: boolean;
  /** Timestamped restarts / crashes, newest last, bounded by {@link EVENT_RETENTION_MS} and {@link MAX_EVENTS}. */
  events?: ProcessStartupEvent[];
  /** When `events` recording started; windows that reach further back are incomplete. */
  eventsSince?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Keep a month of startup events: enough for the 24 h window and short trends. */
export const EVENT_RETENTION_MS = 30 * DAY_MS;
export const MAX_EVENTS = 500;

export type StartupReason = 'start' | 'restart' | 'crash';
export type ResolvedProcessMonitorConfig = ReturnType<typeof resolveProcessMonitorConfig>;

export const processMonitorStore = definePluginStore<ProcessMonitor>(
  'zhin.process-monitor.runtime',
  'Owner-scoped process monitor state and lifecycle',
);
export const processMonitorToken = processMonitorStore;

export function resolveProcessMonitorConfig(raw: ProcessMonitorConfig | undefined) {
  return {
    enabled: raw?.enabled ?? true,
    notifyChannels: raw?.notifyChannels ?? [],
    notifyOnStart: raw?.notifyOnStart ?? true,
    notifyOnRestart: raw?.notifyOnRestart ?? true,
    notifyOnCrash: raw?.notifyOnCrash ?? true,
  };
}

export function formatUptime(ms: number, locale?: Locale): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return t(locale, 'days', { days, hours: hours % 24 });
  if (hours > 0) return t(locale, 'hours', { hours, minutes: minutes % 60 });
  if (minutes > 0) return t(locale, 'minutes', { minutes });
  return t(locale, 'seconds', { seconds });
}

export function classifyStartup(
  state: ProcessState,
  currentPid: number,
  now = Date.now(),
): { reason: StartupReason; uptime?: number } {
  if (!state.lastPid || !state.lastStartTime) return { reason: 'start' };
  if (state.lastPid === currentPid) return { reason: 'start' };
  const endTime = state.lastAliveTime != null && state.lastAliveTime >= state.lastStartTime
    ? state.lastAliveTime
    : now;
  const uptime = Math.max(0, endTime - state.lastStartTime);
  return state.cleanExit === true || (state.lastAliveTime == null && uptime >= 5 * 60 * 1000)
    ? { reason: 'restart', uptime }
    : { reason: 'crash', uptime };
}

export interface ProcessMonitorOptions {
  readonly stateFile?: string;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
}

export type ProcessMonitorStatusSnapshot = {
  readonly pid: number;
  /** This run (since the current process started), formatted in the requested locale. */
  readonly uptime: string;
  readonly uptimeMs: number;
  /** Both Console locales, so the page never mixes a Chinese duration into an English view. */
  readonly uptimeI18n: Readonly<Record<'zh-CN' | 'en', string>>;
  /** This run's start (ISO) and why the monitor thinks it started. */
  readonly startedAt: string;
  readonly startReason: StartupReason | 'unknown';
  readonly rssMb: number;
  readonly heapUsedMb: number;
  readonly heapTotalMb: number;
  /** Cumulative since {@link trackingSince}. */
  readonly restartCount: number;
  readonly crashCount: number;
  readonly totalUptime: string;
  readonly totalUptimeMs: number;
  readonly totalUptimeI18n: Readonly<Record<'zh-CN' | 'en', string>>;
  /** `YYYY-MM-DD` the cumulative counters start from; empty when unknown. */
  readonly trackingSince: string;
  readonly trackingSinceEstimated: boolean;
  /** Crashes / restarts detected in the last 24 hours. */
  readonly crashesLast24h: number;
  readonly restartsLast24h: number;
  /** False while timestamped events cover less than the full 24 hours (recently upgraded state file). */
  readonly last24hComplete: boolean;
  readonly hostname: string;
  readonly platform: string;
  readonly nodeVersion: string;
  readonly healthy: boolean;
};

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isStartupEvent(value: unknown): value is ProcessStartupEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (event.reason === 'crash' || event.reason === 'restart') && typeof event.at === 'number' && Number.isFinite(event.at);
}

function formatDay(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One plugin owner's process statistics, persistence, notifications, and signal lifecycle. */
export class ProcessMonitor {
  readonly #config: ResolvedProcessMonitorConfig;
  readonly #stateFile: string;
  readonly #now: () => number;
  readonly #fetch: typeof fetch;
  readonly #startTime: number;
  #state: ProcessState = { restartCount: 0, crashCount: 0, totalUptime: 0 };
  #started = false;
  #startReason: StartupReason | undefined;
  #signalHandlers?: { readonly sigterm: () => void; readonly sigint: () => void };

  constructor(config: ProcessMonitorConfig = {}, options: ProcessMonitorOptions = {}) {
    this.#config = resolveProcessMonitorConfig(config);
    this.#stateFile = options.stateFile ?? path.join(process.cwd(), 'data', 'process-state.json');
    this.#now = options.now ?? Date.now;
    this.#fetch = options.fetch ?? fetch;
    this.#startTime = this.#now();
  }

  get state(): Readonly<ProcessState> {
    return this.#state;
  }

  get started(): boolean {
    return this.#started;
  }

  start(): void {
    if (!this.#config.enabled || this.#started) return;
    this.#started = true;
    this.#loadState();
    void this.#detectStartupReason();

    const markCleanExit = () => {
      this.#state.cleanExit = true;
      this.#state.lastAliveTime = this.#now();
      this.#saveState();
    };
    const sigterm = () => markCleanExit();
    const sigint = () => markCleanExit();
    process.on('SIGTERM', sigterm);
    process.on('SIGINT', sigint);
    this.#signalHandlers = { sigterm, sigint };
  }

  dispose(): void {
    if (this.#signalHandlers) {
      process.removeListener('SIGTERM', this.#signalHandlers.sigterm);
      process.removeListener('SIGINT', this.#signalHandlers.sigint);
      this.#signalHandlers = undefined;
    }
    this.#started = false;
  }

  /** Restarts / crashes detected within the last `windowMs`. */
  recentEvents(windowMs = DAY_MS): { readonly crashes: number; readonly restarts: number; readonly complete: boolean } {
    const now = this.#now();
    const from = now - windowMs;
    let crashes = 0;
    let restarts = 0;
    for (const event of this.#state.events ?? []) {
      if (event.at < from || event.at > now) continue;
      if (event.reason === 'crash') crashes += 1;
      else restarts += 1;
    }
    const since = this.#state.eventsSince;
    return { crashes, restarts, complete: since !== undefined && since <= from };
  }

  getStatus(locale?: Locale): ProcessMonitorStatusSnapshot {
    const memory = process.memoryUsage();
    const uptimeMs = Math.max(0, this.#now() - this.#startTime);
    const recent = this.recentEvents();
    return {
      pid: process.pid,
      uptime: formatUptime(uptimeMs, locale),
      uptimeMs,
      uptimeI18n: { 'zh-CN': formatUptime(uptimeMs, 'zh-CN'), en: formatUptime(uptimeMs, 'en') },
      startedAt: new Date(this.#startTime).toISOString(),
      startReason: this.#startReason ?? 'unknown',
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      restartCount: this.#state.restartCount,
      crashCount: this.#state.crashCount,
      totalUptime: formatUptime(this.#state.totalUptime, locale),
      totalUptimeMs: this.#state.totalUptime,
      totalUptimeI18n: {
        'zh-CN': formatUptime(this.#state.totalUptime, 'zh-CN'),
        en: formatUptime(this.#state.totalUptime, 'en'),
      },
      trackingSince: this.#state.trackingSince === undefined ? '' : formatDay(this.#state.trackingSince),
      trackingSinceEstimated: this.#state.trackingSinceEstimated === true,
      crashesLast24h: recent.crashes,
      restartsLast24h: recent.restarts,
      last24hComplete: recent.complete,
      hostname: os.hostname(),
      platform: `${os.platform()}-${os.arch()}`,
      nodeVersion: process.version,
      healthy: this.#config.enabled && (this.#started || this.#state.crashCount === 0),
    };
  }

  formatStatus(locale?: Locale): string {
    const memory = process.memoryUsage();
    return [
      t(locale, 'title'),
      '',
      t(locale, 'pid', { pid: process.pid }),
      t(locale, 'uptime', { duration: formatUptime(this.#now() - this.#startTime, locale) }),
      t(locale, 'memory', { memory: Math.round(memory.heapUsed / 1024 / 1024) }),
      t(locale, 'restarts', { count: this.#state.restartCount }),
      t(locale, 'crashes', { count: this.#state.crashCount }),
      t(locale, 'totalUptime', { duration: formatUptime(this.#state.totalUptime, locale) }),
      ...(this.#state.trackingSince === undefined ? [] : [t(locale, 'since', {
        date: formatDay(this.#state.trackingSince),
        estimated: this.#state.trackingSinceEstimated ? t(locale, 'sinceEstimated') : '',
      })]),
      ...(this.#state.eventsSince === undefined ? [] : [t(locale, 'last24h', {
        crashes: this.recentEvents().crashes, restarts: this.recentEvents().restarts,
      })]),
      t(locale, 'host', { host: os.hostname() }),
      t(locale, 'platform', { platform: `${os.platform()}-${os.arch()}` }),
      `📦 Node: ${process.version}`,
    ].join('\n');
  }

  #loadState(): void {
    const now = this.#now();
    try {
      if (!fs.existsSync(this.#stateFile)) {
        this.#state = { restartCount: 0, crashCount: 0, totalUptime: 0, trackingSince: now, events: [], eventsSince: now };
        return;
      }
      const loaded = JSON.parse(fs.readFileSync(this.#stateFile, 'utf-8')) as Partial<ProcessState>;
      this.#state = {
        ...loaded,
        restartCount: finiteCount(loaded.restartCount),
        crashCount: finiteCount(loaded.crashCount),
        totalUptime: finiteCount(loaded.totalUptime),
        events: Array.isArray(loaded.events) ? loaded.events.filter(isStartupEvent) : [],
      };
      if (!Number.isFinite(this.#state.trackingSince)) {
        // Older files never recorded when counting began: the file's own age is the best bound.
        this.#state.trackingSince = this.#legacyTrackingStart(now);
        this.#state.trackingSinceEstimated = true;
      }
      if (!Number.isFinite(this.#state.eventsSince)) this.#state.eventsSince = now;
    } catch {
      this.#state = { restartCount: 0, crashCount: 0, totalUptime: 0, trackingSince: now, events: [], eventsSince: now };
    }
  }

  #legacyTrackingStart(fallback: number): number {
    try {
      const stat = fs.statSync(this.#stateFile);
      const born = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
      return born > 0 && born <= fallback ? Math.floor(born) : fallback;
    } catch {
      return fallback;
    }
  }

  #saveState(): void {
    try {
      fs.mkdirSync(path.dirname(this.#stateFile), { recursive: true });
      fs.writeFileSync(this.#stateFile, JSON.stringify(this.#state, null, 2));
    } catch {
      // Monitoring must not interrupt the host process.
    }
  }

  async #detectStartupReason(): Promise<void> {
    const now = this.#now();
    const { reason, uptime } = classifyStartup(this.#state, process.pid, now);
    this.#startReason = reason;
    if (reason === 'crash') this.#state.crashCount += 1;
    if (reason === 'restart') this.#state.restartCount += 1;
    if (reason !== 'start') {
      const kept = (this.#state.events ?? []).filter(event => event.at >= now - EVENT_RETENTION_MS);
      kept.push({ reason, at: now });
      this.#state.events = kept.slice(-MAX_EVENTS);
    }
    if (uptime) this.#state.totalUptime += uptime;
    this.#state.cleanExit = false;
    this.#state.lastPid = process.pid;
    this.#state.lastStartTime = now;
    this.#state.lastAliveTime = undefined;
    this.#saveState();

    const shouldNotify = reason === 'start'
      ? this.#config.notifyOnStart
      : reason === 'restart'
        ? this.#config.notifyOnRestart
        : this.#config.notifyOnCrash;
    if (!shouldNotify) return;

    const record = {
      reason,
      timestamp: new Date(now),
      hostname: os.hostname(),
      pid: process.pid,
      platform: `${os.platform()}-${os.arch()}`,
      nodeVersion: process.version,
      uptime,
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
    for (const channel of this.#config.notifyChannels) {
      try {
        await this.#fetch(channel.target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'process_restart', data: record, stats: this.#state }),
        });
      } catch {
        // Notification failure must not interrupt monitoring.
      }
    }
  }
}
