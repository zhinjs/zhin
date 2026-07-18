/**
 * Process monitor — module-level state + file-backed restart detection.
 * No usePlugin; Plugin Runtime setup() calls startProcessMonitor().
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export interface NotifyChannel {
  type: 'user' | 'group' | 'webhook';
  target: string;
  platform?: string;
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
  restartCount: number;
  crashCount: number;
  totalUptime: number;
}

const STATE_FILE = path.join(process.cwd(), 'data', 'process-state.json');

export let processState: ProcessState = {
  restartCount: 0,
  crashCount: 0,
  totalUptime: 0,
};

export const startTime = Date.now();

let started = false;
let signalHandlers: { sigterm: () => void; sigint: () => void } | null = null;

export function resolveProcessMonitorConfig(
  raw: ProcessMonitorConfig | undefined,
): Required<
  Pick<
    ProcessMonitorConfig,
    'enabled' | 'notifyOnStart' | 'notifyOnRestart' | 'notifyOnCrash'
  >
> & { notifyChannels: NotifyChannel[] } {
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

export function formatProcessStatus(): string {
  const uptime = Date.now() - startTime;
  const memUsage = process.memoryUsage();
  return [
    '📊 进程监控状态',
    '',
    `🚀 当前 PID: ${process.pid}`,
    `⏱️  运行时长: ${formatUptime(uptime)}`,
    `💾 内存使用: ${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
    `🔄 总重启: ${processState.restartCount} 次`,
    `💥 崩溃: ${processState.crashCount} 次`,
    `📈 累计运行: ${formatUptime(processState.totalUptime)}`,
    `🖥️  主机: ${os.hostname()}`,
    `💻 平台: ${os.platform()}-${os.arch()}`,
    `📦 Node: ${process.version}`,
  ].join('\n');
}

function loadProcessState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf-8');
      processState = JSON.parse(data);
    }
  } catch {
    // keep defaults
  }
}

function saveProcessState(): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(processState, null, 2));
  } catch {
    // ignore
  }
}

function formatNotificationMessage(record: {
  reason: string;
  timestamp: Date;
  hostname: string;
  pid: number;
  platform: string;
  nodeVersion: string;
  uptime?: number;
  memory?: number;
}): string {
  const emoji = ({ start: '🚀', restart: '🔄', crash: '💥' } as Record<string, string>)[
    record.reason
  ] || '📊';
  const reasonText = (
    { start: '首次启动', restart: '正常重启', crash: '异常崩溃' } as Record<string, string>
  )[record.reason] || '未知';

  const lines = [
    `${emoji} 【进程监控通知】`,
    '',
    `📊 事件: ${reasonText}`,
    `⏰ 时间: ${record.timestamp.toLocaleString('zh-CN')}`,
    `🖥️  主机: ${record.hostname}`,
    `🔢 PID: ${record.pid}`,
    `💻 平台: ${record.platform}`,
    `📦 Node: ${record.nodeVersion}`,
  ];

  if (record.uptime) {
    lines.push(`⏱️  运行时长: ${formatUptime(record.uptime)}`);
  }
  if (record.memory) {
    lines.push(`💾 内存: ${record.memory} MB`);
  }

  lines.push('', `📈 统计:`);
  lines.push(`  • 总重启: ${processState.restartCount} 次`);
  lines.push(`  • 崩溃: ${processState.crashCount} 次`);
  lines.push(`  • 累计运行: ${formatUptime(processState.totalUptime)}`);

  return lines.join('\n');
}

async function sendNotification(
  config: ReturnType<typeof resolveProcessMonitorConfig>,
  record: {
    reason: string;
    timestamp: Date;
    hostname: string;
    pid: number;
    platform: string;
    nodeVersion: string;
    uptime?: number;
    memory?: number;
  },
): Promise<void> {
  // user/group 渠道尚未实现（需要接入 OutboundHost 出站链路），
  // 目前仅支持 webhook；实现时用 formatNotificationMessage(record) 生成文本。
  for (const channel of config.notifyChannels) {
    if (channel.type !== 'webhook') continue;
    try {
      await fetch(channel.target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'process_restart',
          data: record,
          stats: processState,
        }),
      });
    } catch {
      // ignore webhook errors
    }
  }
}

async function detectStartupReason(
  config: ReturnType<typeof resolveProcessMonitorConfig>,
): Promise<void> {
  const currentPid = process.pid;
  const currentTime = Date.now();
  let reason: 'start' | 'restart' | 'crash' = 'start';
  let uptime: number | undefined;

  if (processState.lastPid && processState.lastStartTime) {
    const timeSinceLastStart = currentTime - processState.lastStartTime;
    if (timeSinceLastStart < 5 * 60 * 1000) {
      reason = 'crash';
      processState.crashCount++;
    } else {
      reason = 'restart';
      processState.restartCount++;
    }
    uptime = timeSinceLastStart;
    processState.totalUptime += uptime;
  }

  processState.lastPid = currentPid;
  processState.lastStartTime = currentTime;
  saveProcessState();

  const record = {
    timestamp: new Date(),
    reason,
    uptime,
    pid: currentPid,
    hostname: os.hostname(),
    platform: `${os.platform()}-${os.arch()}`,
    nodeVersion: process.version,
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };

  const shouldNotify =
    (reason === 'start' && config.notifyOnStart) ||
    (reason === 'restart' && config.notifyOnRestart) ||
    (reason === 'crash' && config.notifyOnCrash);

  if (shouldNotify && config.notifyChannels.length > 0) {
    await sendNotification(config, record);
  }
}

/** Start monitoring once; returns disposer for lifecycle cleanup. */
export function startProcessMonitor(rawConfig?: ProcessMonitorConfig): () => void {
  const config = resolveProcessMonitorConfig(rawConfig);
  if (!config.enabled || started) {
    return () => undefined;
  }
  started = true;
  loadProcessState();
  void detectStartupReason(config);

  const onSigterm = () => {
    saveProcessState();
  };
  const onSigint = () => {
    saveProcessState();
  };
  process.on('SIGTERM', onSigterm);
  process.on('SIGINT', onSigint);
  signalHandlers = { sigterm: onSigterm, sigint: onSigint };

  return () => {
    if (signalHandlers) {
      process.removeListener('SIGTERM', signalHandlers.sigterm);
      process.removeListener('SIGINT', signalHandlers.sigint);
      signalHandlers = null;
    }
    started = false;
  };
}

/** Test helper: reset module state without touching disk. */
export function resetProcessMonitorForTests(): void {
  if (signalHandlers) {
    process.removeListener('SIGTERM', signalHandlers.sigterm);
    process.removeListener('SIGINT', signalHandlers.sigint);
    signalHandlers = null;
  }
  processState = { restartCount: 0, crashCount: 0, totalUptime: 0 };
  started = false;
}
