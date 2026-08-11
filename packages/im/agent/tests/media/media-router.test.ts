import { describe, expect, it, vi } from 'vitest';
import {
  preprocessInboundMedia,
  resetPreprocessInboundMediaForTests,
} from '../../src/media/media-router.js';
import { DEFAULT_MULTIMODAL_CONFIG, type MediaBinaryPayload } from '../../src/media/media-types.js';

function imagePayload(base64 = 'iVBORw0KGgo='): MediaBinaryPayload {
  return { kind: 'image', base64, mimeType: 'image/png' };
}

function audioPayload(base64 = 'YWFh'): MediaBinaryPayload {
  return { kind: 'audio', base64, mimeType: 'audio/mpeg' };
}

describe('preprocessInboundMedia', () => {
  it('应为图片载荷生成 vision 媒体块', async () => {
    const pre = await preprocessInboundMedia([imagePayload()], DEFAULT_MULTIMODAL_CONFIG);
    expect(pre.visionParts.length).toBe(1);
    expect(pre.textAppend).toContain('图片');
  });

  it('transcribe 成功时追加语音转写文本', async () => {
    resetPreprocessInboundMediaForTests();
    const pre = await preprocessInboundMedia(
      [audioPayload()],
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
    const warn = vi.fn();
    const pre = await preprocessInboundMedia(
      [audioPayload()],
      { ...DEFAULT_MULTIMODAL_CONFIG, audio: { strategy: 'transcribe' } },
      undefined,
      { warn },
    );
    expect(pre.textAppend).toContain('用户发送音频');
    expect(warn).toHaveBeenCalled();
  });

  it('transcribe 失败时降级为占位', async () => {
    resetPreprocessInboundMediaForTests();
    const pre = await preprocessInboundMedia(
      [audioPayload()],
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
    const pre = await preprocessInboundMedia(
      [audioPayload()],
      { ...DEFAULT_MULTIMODAL_CONFIG, audio: { strategy: 'mcp' } },
      '/tmp/workspace',
    );
    expect(pre.textAppend).toContain('已落盘');
  });
});
