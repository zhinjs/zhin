import { App } from './app';
import path from 'path';
import * as os from 'os';

// 创建应用实例
const app = new App({
  plugin_dirs:[path.join(__dirname,'plugins')],
  plugins:['demo-plugin'],
  // disable_plugins:['demo-plugin']
});

// const debuggerInstance = new HMRDebugger(app as any, path.join(__dirname, 'logs'));
app.start()
// 模拟发送一些消息来测试插件功能
setTimeout(() => {
  // 模拟群组消息
  app.broadcast('message.group', {
    content: 'Hello from group',
    sender: 'test',
    timestamp: Date.now()
  });

  // 模拟私聊消息
  app.broadcast('message.private', {
    content: 'Hello from private',
    sender: 'test',
    timestamp: Date.now()
  });

  // 模拟命令
  app.broadcast('command', 'test');
  app.broadcast('command', 'test2');
  // const reportPath = path.join(__dirname, 'logs', `report-${Date.now()}.html`);
  // debuggerInstance.generateReport(reportPath);

  // 启动内存监控
  startMemoryMonitoring();
}, 1000);

// 内存使用信息接口
interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  systemTotal: number;
  systemFree: number;
  timestamp: number;
}

// 内存使用历史记录
const memoryHistory: MemoryUsage[] = [];
const MAX_HISTORY_LENGTH = 10;

/**
 * 获取当前内存使用情况
 */
function getMemoryUsage(): MemoryUsage {
  const memUsage = process.memoryUsage();
  const systemMemory = {
    total: os.totalmem(),
    free: os.freemem()
  };

  return {
    heapUsed: memUsage.heapUsed,
    heapTotal: memUsage.heapTotal,
    external: memUsage.external,
    arrayBuffers: memUsage.arrayBuffers,
    rss: memUsage.rss,
    systemTotal: systemMemory.total,
    systemFree: systemMemory.free,
    timestamp: Date.now()
  };
}

/**
 * 格式化字节数为人类可读格式
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 生成内存使用报告
 */
function generateMemoryReport(): string {
  const current = getMemoryUsage();
  memoryHistory.push(current);

  // 保持历史记录在最大长度内
  if (memoryHistory.length > MAX_HISTORY_LENGTH) {
    memoryHistory.shift();
  }

  // 计算内存使用趋势
  const trend = memoryHistory.length > 1
    ? current.heapUsed - memoryHistory[memoryHistory.length - 2].heapUsed
    : 0;

  const report = [
    '=== Memory Usage Report ===',
    `Timestamp: ${new Date(current.timestamp).toLocaleString()}`,
    '',
    'Process Memory:',
    `  Heap Used: ${formatBytes(current.heapUsed)}`,
    `  Heap Total: ${formatBytes(current.heapTotal)}`,
    `  External: ${formatBytes(current.external)}`,
    `  Array Buffers: ${formatBytes(current.arrayBuffers)}`,
    `  RSS: ${formatBytes(current.rss)}`,
    '',
    'System Memory:',
    `  Total: ${formatBytes(current.systemTotal)}`,
    `  Free: ${formatBytes(current.systemFree)}`,
    `  Used: ${formatBytes(current.systemTotal - current.systemFree)}`,
    '',
    'Memory Trend:',
    `  Heap Change: ${trend > 0 ? '+' : ''}${formatBytes(trend)}`,
    `  Trend: ${trend > 0 ? 'Increasing' : trend < 0 ? 'Decreasing' : 'Stable'}`,
    '',
    'Memory Usage History:',
    ...memoryHistory.map((usage, index) =>
      `  ${index + 1}. Heap Used: ${formatBytes(usage.heapUsed)} (${new Date(usage.timestamp).toLocaleTimeString()})`
    ),
    '========================'
  ].join('\n');

  return report;
}

/**
 * 定期生成内存报告
 */
function startMemoryMonitoring(interval: number = 5000): void {
  console.log('Starting memory monitoring...');
  console.log(generateMemoryReport());
  setInterval(() => {
    console.log(generateMemoryReport());
  }, interval);
}
