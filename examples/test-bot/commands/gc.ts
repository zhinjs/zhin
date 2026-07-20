import { defineCommand } from '@zhin.js/command';
import { formatBytes } from '../lib/bytes.js';

/** Trigger V8 GC when process was started with --expose-gc. */
export default defineCommand({
  description: '强制 GC（需 NODE_OPTIONS=--expose-gc）',
  execute: () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc !== 'function') {
      return [
        'GC unavailable',
        'Start with: NODE_OPTIONS=--expose-gc pnpm dev',
      ].join('\n');
    }
    const before = process.memoryUsage();
    gc();
    const after = process.memoryUsage();
    return [
      'gc done',
      `heap: ${formatBytes(before.heapUsed)} → ${formatBytes(after.heapUsed)}`,
      `freed: ${formatBytes(before.heapUsed - after.heapUsed)}`,
      `RSS: ${formatBytes(before.rss)} → ${formatBytes(after.rss)}`,
    ].join('\n');
  },
});
