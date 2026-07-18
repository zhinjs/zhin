import { defineCommand } from '@zhin.js/command';
import { component } from '@zhin.js/core/runtime';
import * as os from 'node:os';

function formatSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let index = 0;
  while (value > 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)}${units[index]}`;
}

/** Runtime zt：Satori 状态卡（legacy JSX 见 src/plugins/test-jsx）。 */
export default defineCommand({
  description: '系统状态卡片',
  execute: () => {
    const mem = process.memoryUsage();
    const load = os.loadavg().map((n) => n.toFixed(2)).join(' ');
    return component('status-card', {
      title: os.hostname(),
      lines: [
        { label: 'OS', value: `${os.type()} ${os.release()}` },
        { label: 'CPU', value: `${os.cpus().length} · ${load}` },
        { label: 'RAM', value: `${formatSize(os.totalmem() - os.freemem())}/${formatSize(os.totalmem())}` },
        { label: 'RSS', value: formatSize(mem.rss) },
        { label: 'Heap', value: formatSize(mem.heapUsed) },
        { label: 'Up', value: `${Math.floor(process.uptime() / 60)}m` },
      ],
    });
  },
});
