import { defineCommand } from '@zhin.js/command';
import * as os from 'node:os';

function formatSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let index = 0;
  while (value > 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(2)}${units[index]}`;
}

export default defineCommand({
  description: '查看进程内存（RSS / heap / external）',
  execute: () => {
    const mem = process.memoryUsage();
    return [
      '📊 mem',
      `RSS: ${formatSize(mem.rss)}`,
      `heapUsed: ${formatSize(mem.heapUsed)} / ${formatSize(mem.heapTotal)}`,
      `external: ${formatSize(mem.external)}`,
      `arrayBuffers: ${formatSize(mem.arrayBuffers)}`,
      `free: ${formatSize(os.freemem())} / ${formatSize(os.totalmem())}`,
    ].join('\n');
  },
});
