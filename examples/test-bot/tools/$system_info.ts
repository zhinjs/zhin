import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import * as os from 'node:os';
import { formatBytes } from '../lib/bytes.js';

const schema = z.object({
  section: z.enum(['time', 'memory', 'system', 'all']).default('all'),
});

export default defineAgentTool<{ section?: 'time' | 'memory' | 'system' | 'all' }>({
  description: 'Read process/system facts (time, memory, platform)',
  approval: 'never',
  inputSchema: schema,
  execute: (input) => {
    const { section } = schema.parse(input);
    const out: Record<string, unknown> = {};
    if (section === 'time' || section === 'all') {
      out.time = {
        iso: new Date().toISOString(),
        local: new Date().toLocaleString('zh-CN'),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    if (section === 'memory' || section === 'all') {
      const mem = process.memoryUsage();
      out.memory = {
        rss: formatBytes(mem.rss),
        heapUsed: formatBytes(mem.heapUsed),
        heapTotal: formatBytes(mem.heapTotal),
        external: formatBytes(mem.external),
        free: formatBytes(os.freemem()),
        total: formatBytes(os.totalmem()),
      };
    }
    if (section === 'system' || section === 'all') {
      out.system = {
        platform: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
        cpus: os.cpus().length,
        loadavg: os.loadavg().map((n) => Number(n.toFixed(2))),
        uptimeSec: Math.floor(process.uptime()),
        hostname: os.hostname(),
      };
    }
    return out;
  },
});
