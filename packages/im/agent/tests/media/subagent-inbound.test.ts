import { describe, it, expect } from 'vitest';
import type { AIProvider } from '@zhin.js/ai';
import type { SegmentMediaRef } from '@zhin.js/core';
import { buildSubagentInboundTask } from '../../src/media/subagent-inbound.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../../src/media/media-types.js';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('buildSubagentInboundTask', () => {
  it('应为图片落盘并写入 analyze_media 路径提示', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-subagent-inbound-'));
    const refs: SegmentMediaRef[] = [
      {
        type: 'image',
        media: { kind: 'base64', value: 'iVBORw0KGgo=', mime_type: 'image/png' },
      },
    ];
    const inbound = await buildSubagentInboundTask('@{bot}', refs, {
      workspaceDir: tmp,
      config: { ...DEFAULT_MULTIMODAL_CONFIG, inboundDir: 'inbound-test' },
    });
    expect(inbound.payloadCount).toBe(1);
    expect(inbound.spooledPaths.length).toBe(1);
    expect(fs.existsSync(inbound.spooledPaths[0]!)).toBe(true);
    const text = typeof inbound.runInput === 'string'
      ? inbound.runInput
      : inbound.runInput.filter(p => p.type === 'text').map(p => p.text).join('\n');
    expect(text).toContain('analyze_media');
    expect(text).toContain(inbound.spooledPaths[0]!);
  });

  it('vision provider 应注入 multimodal runInput', async () => {
    const provider = {
      name: 'mock-vision',
      models: ['m'],
      capabilities: { vision: true },
      chat: async () => {
        throw new Error('not used');
      },
    } as unknown as AIProvider;
    const refs: SegmentMediaRef[] = [
      {
        type: 'image',
        media: { kind: 'base64', value: 'iVBORw0KGgo=', mime_type: 'image/png' },
      },
    ];
    const inbound = await buildSubagentInboundTask('hi', refs, { provider });
    expect(inbound.useNativeVision).toBe(true);
    expect(Array.isArray(inbound.runInput)).toBe(true);
    expect(inbound.visionPartCount).toBe(1);
  });
});
