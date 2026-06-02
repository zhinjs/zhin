/**
 * 多模态功能测试
 * 
 * 测试 ContentPart 类型扩展、contentToText 辅助函数等多模态相关功能
 */
import { describe, it, expect } from 'vitest';
import type { ContentPart } from '@zhin.js/core';
import { contentToText } from '@zhin.js/agent';

describe('contentToText 多模态支持', () => {
  it('应处理纯文本', () => {
    expect(contentToText('hello')).toBe('hello');
  });

  it('应处理 null 和 undefined', () => {
    expect(contentToText(null)).toBe('');
    expect(contentToText(undefined)).toBe('');
  });

  it('应处理 text ContentPart', () => {
    const parts: ContentPart[] = [{ type: 'text', text: '你好' }];
    expect(contentToText(parts)).toBe('你好');
  });

  it('应将 image_url ContentPart 转为 [图片]', () => {
    const parts: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
    ];
    expect(contentToText(parts)).toBe('[图片]');
  });

  it('应将 video_url ContentPart 转为 [视频]', () => {
    const parts: ContentPart[] = [
      { type: 'video_url', video_url: { url: 'https://example.com/video.mp4' } },
    ];
    expect(contentToText(parts)).toBe('[视频]');
  });

  it('应将 audio ContentPart 转为 [音频]', () => {
    const parts: ContentPart[] = [
      { type: 'audio', audio: { data: 'base64data', format: 'mp3' } },
    ];
    expect(contentToText(parts)).toBe('[音频]');
  });

  it('应将 face ContentPart 转为表情文字', () => {
    const parts: ContentPart[] = [
      { type: 'face', face: { id: '178', text: '笑哭' } },
    ];
    expect(contentToText(parts)).toBe('笑哭');
  });

  it('应将无文字 face ContentPart 转为 [表情]', () => {
    const parts: ContentPart[] = [
      { type: 'face', face: { id: '178' } },
    ];
    expect(contentToText(parts)).toBe('[表情]');
  });

  it('应正确处理混合内容', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: '看看这个' },
      { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
      { type: 'face', face: { id: '1', text: '微笑' } },
    ];
    expect(contentToText(parts)).toBe('看看这个[图片]微笑');
  });

  it('应处理单个 ContentPart（非数组）', () => {
    const part: ContentPart = { type: 'text', text: '单个' };
    expect(contentToText(part)).toBe('单个');
  });
});

describe('ContentPart 类型完整性', () => {
  it('应支持所有多模态类型', () => {
    const textPart: ContentPart = { type: 'text', text: 'hello' };
    const imagePart: ContentPart = { type: 'image_url', image_url: { url: 'https://img.png' } };
    const audioPart: ContentPart = { type: 'audio', audio: { data: 'data', format: 'mp3' } };
    const videoPart: ContentPart = { type: 'video_url', video_url: { url: 'https://vid.mp4' } };
    const facePart: ContentPart = { type: 'face', face: { id: '1', text: '微笑' } };

    expect(textPart.type).toBe('text');
    expect(imagePart.type).toBe('image_url');
    expect(audioPart.type).toBe('audio');
    expect(videoPart.type).toBe('video_url');
    expect(facePart.type).toBe('face');
  });

  it('image_url 应支持 detail 参数', () => {
    const part: ContentPart = {
      type: 'image_url',
      image_url: { url: 'https://img.png', detail: 'high' },
    };
    if (part.type === 'image_url') {
      expect(part.image_url.detail).toBe('high');
    }
  });

  it('face 的 text 应为可选', () => {
    const part: ContentPart = { type: 'face', face: { id: '100' } };
    if (part.type === 'face') {
      expect(part.face.text).toBeUndefined();
    }
  });
});
