import { defineCommand } from '@zhin.js/command';
import * as os from 'node:os';
import { formatBytes } from '../lib/bytes.js';

/** Process memory breakdown for kitchen-sink diagnostics. */
export default defineCommand({
  description: '进程内存明细（RSS / heap / OS）',
  execute: () => {
    const mem = process.memoryUsage();
    const heapRatio = mem.heapTotal > 0
      ? ((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)
      : '—';
    return [
      'mem-debug',
      '',
      `RSS: ${formatBytes(mem.rss)}`,
      `heap: ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)} (${heapRatio}%)`,
      `external: ${formatBytes(mem.external)}`,
      `arrayBuffers: ${formatBytes(mem.arrayBuffers)}`,
      `os free/total: ${formatBytes(os.freemem())} / ${formatBytes(os.totalmem())}`,
      `uptime: ${Math.floor(process.uptime())}s`,
      '',
      '更深：heap（写 heapsnapshot）/ gc（需 --expose-gc）',
    ].join('\n');
  },
});
