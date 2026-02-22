/**
 * @zhin.js/process-monitor
 * 
 * 进程监控与重启通知插件
 */
import { usePlugin, ZhinTool } from 'zhin.js';
import os from 'os';
import fs from 'fs';
import path from 'path';

const plugin = usePlugin();
const { logger, root } = plugin;

// ─── 配置 ────────────────────────────────────────────────────────────────────

interface NotifyChannel {
  type: 'user' | 'group' | 'webhook';
  target: string;
  platform?: string;
}

interface Config {
  enabled?: boolean;
  notifyChannels?: NotifyChannel[];
  notifyOnStart?: boolean;
  notifyOnRestart?: boolean;
  notifyOnCrash?: boolean;
}

const configService = root.inject('config');
const appConfig = configService?.getPrimary<{ 'process-monitor'?: Config }>() || {};
const config: Config = {
  enabled: true,
  notifyChannels: [],
  notifyOnStart: true,
  notifyOnRestart: true,
  notifyOnCrash: true,
  ...appConfig['process-monitor'],
};

if (!config.enabled) {
  logger.info('进程监控已禁用');
}

// ─── 状态管理 ────────────────────────────────────────────────────────────────

const STATE_FILE = path.join(process.cwd(), 'data', 'process-state.json');

interface ProcessState {
  lastPid?: number;
  lastStartTime?: number;
  restartCount: number;
  crashCount: number;
  totalUptime: number;
}

let processState: ProcessState = {
  restartCount: 0,
  crashCount: 0,
  totalUptime: 0,
};

const startTime = Date.now();

function loadProcessState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf-8');
      processState = JSON.parse(data);
    }
  } catch (error) {
    logger.warn('加载进程状态失败:', error);
  }
}

function saveProcessState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(processState, null, 2));
  } catch (error) {
    logger.warn('保存进程状态失败:', error);
  }
}

// ─── 启动检测 ────────────────────────────────────────────────────────────────

async function detectStartupReason() {
  const currentPid = process.pid;
  const currentTime = Date.now();
  let reason: 'start' | 'restart' | 'crash' = 'start';
  let uptime: number | undefined;

  if (processState.lastPid && processState.lastStartTime) {
    const timeSinceLastStart = currentTime - processState.lastStartTime;
    
    if (timeSinceLastStart < 5 * 60 * 1000) {
      reason = 'crash';
      processState.crashCount++;
      logger.warn(`检测到异常重启（距上次启动 ${Math.floor(timeSinceLastStart / 1000)}s）`);
    } else {
      reason = 'restart';
      processState.restartCount++;
      logger.info('检测到正常重启');
    }
    
    uptime = timeSinceLastStart;
    processState.totalUptime += uptime;
  } else {
    logger.info('首次启动');
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

  if (shouldNotify && config.notifyChannels && config.notifyChannels.length > 0) {
    await sendNotification(record);
  }
}

// ─── 通知 ────────────────────────────────────────────────────────────────────

function formatNotificationMessage(record: any): string {
  const emoji = { start: '🚀', restart: '🔄', crash: '💥' }[record.reason] || '📊';
  const reasonText = { start: '首次启动', restart: '正常重启', crash: '异常崩溃' }[record.reason] || '未知';

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

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天${hours % 24}小时`;
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
  if (minutes > 0) return `${minutes}分钟`;
  return `${seconds}秒`;
}

async function sendNotification(record: any) {
  const message = formatNotificationMessage(record);

  for (const channel of config.notifyChannels || []) {
    try {
      if (channel.type === 'webhook') {
        await fetch(channel.target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'process_restart', data: record, stats: processState }),
        });
        logger.debug(`Webhook 通知已发送: ${channel.target}`);
      }
    } catch (error) {
      logger.error(`发送通知失败 (${channel.type}):`, error);
    }
  }
}

// ─── 初始化 ──────────────────────────────────────────────────────────────────

if (config.enabled) {
  loadProcessState();
  detectStartupReason();

  process.on('SIGTERM', () => {
    logger.info('收到 SIGTERM 信号');
    saveProcessState();
  });

  process.on('SIGINT', () => {
    logger.info('收到 SIGINT 信号');
    saveProcessState();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 工具定义
// ═══════════════════════════════════════════════════════════════════════════════

// 工具会自动注册
new ZhinTool('process_status')
  .desc('查看进程监控状态')
  .tag('监控', '进程')
  .keyword('进程状态', '监控状态', 'process status')
  .alias('monitor', 'pm')
  .usage('查看当前进程状态和统计信息')
  .examples('/monitor', '/pm')
  .execute(async () => {
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
  });

export default plugin;
