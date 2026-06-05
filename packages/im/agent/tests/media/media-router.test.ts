import { describe, it, expect } from 'vitest';
import type { ContentPart } from '@zhin.js/ai';
import { preprocessInboundMedia } from '../../src/media/media-router.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../../src/media/media-types.js';

describe('preprocessInboundMedia', () => {
  it('应为 data URI 图片生成 vision part', async () => {
    const parts: ContentPart[] = [
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
      },
    ];
    const pre = await preprocessInboundMedia(parts, DEFAULT_MULTIMODAL_CONFIG);
    expect(pre.visionParts.length).toBe(1);
    expect(pre.textAppend).toContain('图片');
  });
});
