import os from 'os';
import { processState, startTime, formatUptime } from '../../src/index.js';

export default async function processStatus(): Promise<string> {
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
