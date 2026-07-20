import { defineCommand } from '@zhin.js/command';
import * as os from 'node:os';
import { formatBytes } from '../lib/bytes.js';

/**
 * Runtime mem-profile — process/host facts (no require.cache; ESM Runtime).
 * Legacy `src/plugins/plugin-memory-profiler.ts` remains for `dev:legacy`.
 */
export default defineCommand({
  description: '内存画像（进程 + 主机）',
  execute: () => {
    const mem = process.memoryUsage();
    const cpus = os.cpus();
    const load = os.loadavg().map((n) => n.toFixed(2)).join(' ');
    return [
      'mem-profile',
      '',
      `host: ${os.hostname()} (${os.platform()}/${os.arch()})`,
      `cpus: ${cpus.length} · load ${load}`,
      `rss: ${formatBytes(mem.rss)}`,
      `heap: ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
      `external: ${formatBytes(mem.external)}`,
      `os: ${formatBytes(os.totalmem() - os.freemem())} used / ${formatBytes(os.totalmem())}`,
      `uptime: ${Math.floor(process.uptime())}s`,
      '',
      '插件模块级画像见 `pnpm run dev:legacy`（依赖 CJS require.cache）。',
    ].join('\n');
  },
});
