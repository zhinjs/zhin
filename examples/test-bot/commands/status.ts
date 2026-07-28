import { defineCommand } from 'zhin.js/command';
import * as os from 'node:os';
function formatSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(size) / Math.log(1024));
  return (size / Math.pow(1024, index)).toFixed(2) + ' ' + units[index];
}
function formatTime(time: number): string {
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = time % 60;
  return `${hours}h ${minutes}m ${seconds.toFixed(0)}s`;
}
export default defineCommand({
  description: '进程 / 主机简况',
  execute: () => {
    return [
      '📟 status (Plugin Runtime)',
      `node: ${process.version}`,
      `pid: ${process.pid}`,
      `uptime: ${formatTime(process.uptime())}`,
      `rss: ${formatSize(process.memoryUsage().rss)}`,
      `memory: ${formatSize(os.freemem())} / ${formatSize(os.totalmem())}`,
      `platform: ${os.platform()} ${os.release()} ${os.arch()}`,
      `cpus: ${os.cpus()[0].model} × ${os.cpus().length}`,
      `cwd: ${process.cwd().replace(os.homedir(), '~')}}`,
    ].join('\n');
  },
});
