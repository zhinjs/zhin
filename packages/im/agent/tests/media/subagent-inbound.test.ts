import { describe, it, expect } from 'vitest';
import type { ContentPart } from '@zhin.js/ai';
import { buildSubagentInboundTask } from '../../src/media/subagent-inbound.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../../src/media/media-types.js';
import { OpenAIProvider } from '@zhin.js/ai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('buildSubagentInboundTask', () => {
  it('应为图片落盘并写入 analyze_media 路径提示', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-subagent-inbound-'));
    const parts: ContentPart[] = [
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
      },
    ];
    const inbound = await buildSubagentInboundTask('@{bot}', parts, {
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
    const provider = new OpenAIProvider({ apiKey: 'test' });
    const parts: ContentPart[] = [
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
      },
    ];
    const inbound = await buildSubagentInboundTask('hi', parts, { provider });
    expect(inbound.useNativeVision).toBe(true);
    expect(Array.isArray(inbound.runInput)).toBe(true);
    expect(inbound.visionPartCount).toBe(1);
  });
});
