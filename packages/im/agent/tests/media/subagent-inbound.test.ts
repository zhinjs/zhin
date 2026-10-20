import { describe, it, expect } from 'vitest';
import type { AIProvider } from '@zhin.js/ai';
import { buildSubagentInboundTask } from '../../src/media/subagent-inbound.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../../src/media/media-types.js';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type SegmentMediaRef = Parameters<typeof buildSubagentInboundTask>[1][number];

describe('buildSubagentInboundTask', () => {
  it('无视觉能力时应明确拒绝图片理解并保留落盘路径', async () => {
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
    expect(text).toContain('当前模型不支持图片输入');
    expect(text).toContain(inbound.spooledPaths[0]!);
  });

  it('vision provider 应注入 multimodal runInput', async () => {
    const provider = {
      name: 'mock-vision',
      models: ['m'],
      capabilities: { input: ['text', 'image'] },
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
