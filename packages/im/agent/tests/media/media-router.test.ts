import { describe, expect, it, vi } from 'vitest';
import type { ContentPart } from '@zhin.js/ai';
import {
  preprocessInboundMedia,
  resetPreprocessInboundMediaForTests,
} from '../../src/media/media-router.js';
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

  it('transcribe 成功时追加语音转写文本', async () => {
    resetPreprocessInboundMediaForTests();
    const parts: ContentPart[] = [
      { type: 'audio', audio: { data: 'YWFh', format: 'mp3' } },
    ];
    const pre = await preprocessInboundMedia(
      parts,
      { ...DEFAULT_MULTIMODAL_CONFIG, audio: { strategy: 'transcribe' } },
      undefined,
      {
        transcribe: async () => '你好世界',
      },
    );
    expect(pre.textAppend).toContain('[语音转写] 你好世界');
  });

  it('transcribe 未安装 speech 时降级为占位', async () => {
    resetPreprocessInboundMediaForTests();
    const parts: ContentPart[] = [
      { type: 'audio', audio: { data: 'YWFh', format: 'mp3' } },
    ];
    const warn = vi.fn();
    const pre = await preprocessInboundMedia(
      parts,
      { ...DEFAULT_MULTIMODAL_CONFIG, audio: { strategy: 'transcribe' } },
      undefined,
      { warn },
    );
    expect(pre.textAppend).toContain('用户发送音频');
    expect(warn).toHaveBeenCalled();
  });

  it('transcribe 失败时降级为占位', async () => {
    resetPreprocessInboundMediaForTests();
    const parts: ContentPart[] = [
      { type: 'audio', audio: { data: 'YWFh', format: 'mp3' } },
    ];
    const pre = await preprocessInboundMedia(
      parts,
      { ...DEFAULT_MULTIMODAL_CONFIG, audio: { strategy: 'transcribe' } },
      undefined,
      {
        transcribe: async () => {
          throw new Error('stt failed');
        },
      },
    );
    expect(pre.textAppend).toContain('用户发送音频');
  });

  it('mcp 策略仍落盘', async () => {
    const parts: ContentPart[] = [
      { type: 'audio', audio: { data: 'YWFh', format: 'mp3' } },
    ];
    const pre = await preprocessInboundMedia(
      parts,
      { ...DEFAULT_MULTIMODAL_CONFIG, audio: { strategy: 'mcp' } },
      '/tmp/workspace',
    );
    expect(pre.textAppend).toContain('已落盘');
  });
});
