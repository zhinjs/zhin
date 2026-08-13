import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import {
  applyInboundMediaInjection,
  resolveTurnMediaInjection,
} from '../../src/turn/inbound-media.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-media-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveTurnMediaInjection', () => {
  it('无媒体段 → 空注入', async () => {
    const injection = await resolveTurnMediaInjection([]);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual([]);
  });

  it('image：url / base64 MediaRef 直挂为媒体块', async () => {
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'url', value: 'https://cdn.example/a.jpg' }, mimeType: 'image/jpeg' },
      { kind: 'image', source: { kind: 'base64', value: 'QUJD' }, mimeType: 'image/png' },
    ]);
    expect(injection.blocks).toEqual([
      { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg', mime_type: 'image/jpeg' } } },
      { type: 'image', data: { media: { kind: 'base64', value: 'QUJD', mime_type: 'image/png' } } },
    ]);
    expect(injection.textAppends).toEqual([]);
  });

  it('image：path 经 media pipeline 物化为 base64 块', async () => {
    const file = path.join(root, 'pic.png');
    fs.writeFileSync(file, Buffer.from('fake-png'));
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'path', value: file } },
    ]);
    expect(injection.blocks).toHaveLength(1);
    const block = injection.blocks[0]!;
    expect(block.type).toBe('image');
    expect(block.data.media.kind).toBe('base64');
    expect(block.data.media.mime_type).toBe('image/png');
    expect(Buffer.from(block.data.media.value, 'base64').toString()).toBe('fake-png');
  });

  it('image：path 读盘失败 → 占位文本', async () => {
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'path', value: path.join(root, 'missing.png') } },
    ]);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual(['[图片]']);
  });

  it('audio：无 STT 管线时降级占位；video / file → 占位文本', async () => {
    const injection = await resolveTurnMediaInjection([
      { kind: 'audio', source: { kind: 'base64', value: 'QUJD' }, mimeType: 'audio/mpeg' },
      { kind: 'video', source: { kind: 'url', value: 'https://cdn.example/v.mp4' } },
      { kind: 'file', source: { kind: 'url', value: 'https://cdn.example/f.zip' }, name: 'f.zip' },
    ]);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual(['[音频]', '[视频]', '[f.zip]']);
  });

  it('platform_ref 降级为占位文本', async () => {
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'platform_ref', value: 'opaque-image-id' } },
    ]);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual(['[图片]']);
  });
});

describe('applyInboundMediaInjection', () => {
  it('媒体块与文本补充挂到最后一个 user 消息，历史不动', () => {
    const history = createUserMessage('旧消息');
    const current = createUserMessage('看这个');
    const out = applyInboundMediaInjection([history, current], {
      blocks: [{
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg' } },
      }],
      textAppends: ['[语音转写] 你好'],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(history);
    const updated = out[1] as ReturnType<typeof createUserMessage>;
    expect(updated.media).toEqual([{
      type: 'image',
      data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg' } },
    }]);
    expect(updated.content.map((b) => (b as { text?: string }).text)).toEqual(['看这个', '[语音转写] 你好']);
  });

  it('空注入原样返回', () => {
    const messages = [createUserMessage('hi')];
    const out = applyInboundMediaInjection(messages, { blocks: [], textAppends: [] });
    expect(out[0]).toBe(messages[0]);
  });
});
