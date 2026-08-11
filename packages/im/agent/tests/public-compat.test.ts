import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInboundTurnPipeline, normalizeContentPartsToPayloads } from '../src/index.js';
import { ZhinAgent } from '../src/zhin-agent/index.js';

describe('public compatibility exports', () => {
  it('keeps the deprecated shims available until the next major', () => {
    // 带 @deprecated 的薄 shim 仍在（下个大版本删除；替代路径：canonical Segment 注入）
    expect(typeof createInboundTurnPipeline).toBe('function');
    expect(typeof normalizeContentPartsToPayloads).toBe('function');
    expect(typeof ZhinAgent.prototype.processMultimodal).toBe('function');
    const src = readFileSync(
      new URL('../src/collaboration/inbound-turn-compat.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('@deprecated');
  });
});
