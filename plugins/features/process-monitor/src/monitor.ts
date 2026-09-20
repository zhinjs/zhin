import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createToken } from 'zhin.js';

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

export interface ProcessState {
  lastPid?: number;
  lastStartTime?: number;
  cleanExit?: boolean;
  restartCount: number;
  crashCount: number;
  totalUptime: number;
}

export type StartupReason = 'start' | 'restart' | 'crash';
export type ResolvedProcessMonitorConfig = ReturnType<typeof resolveProcessMonitorConfig>;

export const processMonitorToken = createToken<ProcessMonitor>(
  'zhin.process-monitor.runtime',
  'Owner-scoped process monitor state and lifecycle',
);

export function resolveProcessMonitorConfig(raw: ProcessMonitorConfig | undefined) {
  return {
    enabled: raw?.enabled ?? true,
    notifyChannels: raw?.notifyChannels ?? [],
    notifyOnStart: raw?.notifyOnStart ?? true,
    notifyOnRestart: raw?.notifyOnRestart ?? true,
    notifyOnCrash: raw?.notifyOnCrash ?? true,
  };
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天${hours % 24}小时`;
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
  if (minutes > 0) return `${minutes}分钟`;
  return `${seconds}秒`;
}

export function classifyStartup(
  state: ProcessState,
  currentPid: number,
  now = Date.now(),
): { reason: StartupReason; uptime?: number } {
  if (!state.lastPid || !state.lastStartTime) return { reason: 'start' };
  if (state.lastPid === currentPid) return { reason: 'start' };
  const uptime = now - state.lastStartTime;
  return state.cleanExit === true || uptime >= 5 * 60 * 1000
    ? { reason: 'restart', uptime }
    : { reason: 'crash', uptime };
}

export interface ProcessMonitorOptions {
  readonly stateFile?: string;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
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

  formatStatus(): string {
    const memory = process.memoryUsage();
    return [
      '📊 进程监控状态',
      '',
      `🚀 当前 PID: ${process.pid}`,
      `⏱️  运行时长: ${formatUptime(this.#now() - this.#startTime)}`,
      `💾 内存使用: ${Math.round(memory.heapUsed / 1024 / 1024)} MB`,
      `🔄 总重启: ${this.#state.restartCount} 次`,
      `💥 崩溃: ${this.#state.crashCount} 次`,
      `📈 累计运行: ${formatUptime(this.#state.totalUptime)}`,
      `🖥️  主机: ${os.hostname()}`,
      `💻 平台: ${os.platform()}-${os.arch()}`,
      `📦 Node: ${process.version}`,
    ].join('\n');
  }

  #loadState(): void {
    try {
      if (!fs.existsSync(this.#stateFile)) return;
      this.#state = JSON.parse(fs.readFileSync(this.#stateFile, 'utf-8')) as ProcessState;
    } catch {
      this.#state = { restartCount: 0, crashCount: 0, totalUptime: 0 };
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
    if (reason === 'crash') this.#state.crashCount += 1;
    if (reason === 'restart') this.#state.restartCount += 1;
    if (uptime) this.#state.totalUptime += uptime;
    this.#state.cleanExit = false;
    this.#state.lastPid = process.pid;
    this.#state.lastStartTime = now;
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
