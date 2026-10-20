import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import {
  applyInboundMediaInjection,
  resolveTurnMediaInjection,
} from '../../src/turn/inbound-media.js';
import type { MediaPerceptionPort } from '../../src/media/perception.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-media-'));
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const bytes = url.endsWith('.mp4')
      ? Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
      : url.endsWith('.zip')
        ? Buffer.from([0x50, 0x4b, 0x03, 0x04])
        : url.endsWith('.jpg')
          ? Buffer.from([0xff, 0xd8, 0xff, 0xe0])
          : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return new Response(bytes, { status: 200 });
  }));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('resolveTurnMediaInjection', () => {
  it('无媒体段 → 空注入', async () => {
    const injection = await resolveTurnMediaInjection([]);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual([]);
    expect(injection.outcomes).toEqual([]);
  });

  it('image：URL / base64 均先物化并校验真实内容', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'url', value: 'https://cdn.example/a.jpg' }, mimeType: 'image/jpeg' },
      { kind: 'image', source: { kind: 'base64', value: png }, mimeType: 'application/pdf' },
    ], { signal: new AbortController().signal, providerInput: ['text', 'image'] });
    expect(injection.blocks.map((block) => block.data.media)).toEqual([
      { kind: 'base64', value: '/9j/4A==', mime_type: 'image/jpeg' },
      { kind: 'base64', value: png, mime_type: 'image/png' },
    ]);
    expect(injection.textAppends).toEqual([]);
    expect(injection.outcomes).toEqual([
      { kind: 'image', status: 'accepted', code: 'validated_provider_input' },
      { kind: 'image', status: 'accepted', code: 'validated_provider_input' },
    ]);
  });

  it('image：path 经 media pipeline 物化为 base64 块', async () => {
    const file = path.join(root, 'pic.png');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(file, png);
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'path', value: file } },
    ], { signal: new AbortController().signal, providerInput: ['text', 'image'] });
    expect(injection.blocks).toHaveLength(1);
    const block = injection.blocks[0]!;
    expect(block.type).toBe('image');
    expect(block.data.media.kind).toBe('base64');
    expect(block.data.media.mime_type).toBe('image/png');
    expect(Buffer.from(block.data.media.value, 'base64')).toEqual(png);
  });

  it('image：path 读盘失败 → 明确 rejected 终态', async () => {
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'path', value: path.join(root, 'missing.png') } },
    ]);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual(['[Media rejected:media_validation_failed: image]']);
    expect(injection.outcomes).toEqual([{ kind: 'image', status: 'rejected', code: 'media_validation_failed' }]);
  });

  it('audio / video / file 保留给显式支持相应输入的 provider', async () => {
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]).toString('base64');
    const injection = await resolveTurnMediaInjection([
      { kind: 'audio', source: { kind: 'base64', value: mp3 }, mimeType: 'audio/mpeg' },
      { kind: 'video', source: { kind: 'url', value: 'https://cdn.example/v.mp4' } },
      { kind: 'file', source: { kind: 'url', value: 'https://cdn.example/f.zip' }, name: 'f.zip' },
    ], { signal: new AbortController().signal, providerInput: ['text', 'audio', 'video', 'file'] });
    expect(injection.blocks.map((block) => block.type)).toEqual(['audio', 'video', 'file']);
    expect(injection.textAppends).toEqual([]);
    expect(injection.outcomes).toEqual([
      { kind: 'audio', status: 'accepted', code: 'validated_provider_input' },
      { kind: 'video', status: 'accepted', code: 'validated_provider_input' },
      { kind: 'file', status: 'accepted', code: 'validated_provider_input' },
    ]);
  });

  it('audio transcription uses only the explicitly injected host port', async () => {
    const transcribe = vi.fn(async () => '宿主转写结果');
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]).toString('base64');
    const signal = new AbortController().signal;
    const injection = await resolveTurnMediaInjection([
      { kind: 'audio', source: { kind: 'base64', value: mp3 }, mimeType: 'audio/mpeg' },
    ], {
      signal,
      providerInput: ['text'],
      transcriber: { transcribe },
    });

    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'audio',
      mimeType: 'audio/mpeg',
    }), signal);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual(['[语音转写] 宿主转写结果']);
    expect(injection.outcomes).toEqual([
      { kind: 'audio', status: 'derived', code: 'speech_transcription' },
    ]);
  });

  it('platform_ref 未物化时明确 unsupported', async () => {
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'platform_ref', value: 'opaque-image-id' } },
    ]);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual(['[Media unsupported:unresolved_platform_reference: image]']);
    expect(injection.outcomes).toEqual([
      { kind: 'image', status: 'unsupported', code: 'unresolved_platform_reference' },
    ]);
  });

  it('Provider 省略输入能力声明时按 text-only 处理并产生 unsupported 终态', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'base64', value: png }, mimeType: 'image/png' },
    ]);

    expect(injection.blocks).toEqual([]);
    expect(injection.outcomes).toEqual([
      { kind: 'image', status: 'unsupported', code: 'provider_input' },
    ]);
    expect(injection.textAppends).toEqual(['[Media unsupported:provider_input: image]']);
  });

  it('通过当前 turn 的 ReferencePort 物化 platform_ref', async () => {
    const injection = await resolveTurnMediaInjection([{
      kind: 'image',
      source: { kind: 'platform_ref', value: 'opaque-image-id' },
      referenceKey: 'ref-1',
    }], { references: {
      async resolve(key) {
        expect(key).toBe('ref-1');
        return {
          status: 'resolved',
          content: { kind: 'url', value: 'https://cdn.example/resolved.png', mime_type: 'image/png' },
        };
      },
    }, signal: new AbortController().signal, providerInput: ['text', 'image'] });
    expect(injection.blocks[0]).toMatchObject({
      type: 'image',
      data: { media: { kind: 'base64', mime_type: 'image/png' } },
    });
    expect(injection.outcomes).toEqual([{ kind: 'image', status: 'accepted', code: 'validated_provider_input' }]);
  });
});

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

function fakePerception(
  describe: MediaPerceptionPort['describe'],
  overrides: Partial<MediaPerceptionPort> = {},
): MediaPerceptionPort & { calls: number } {
  const port = {
    calls: 0,
    kinds: ['image'] as const,
    maxItemsPerTurn: 4,
    accepts: (payload: { kind: string }) => payload.kind === 'image',
    describe: async (...args: Parameters<MediaPerceptionPort['describe']>) => {
      port.calls += 1;
      return describe(...args);
    },
    ...overrides,
  };
  return port as MediaPerceptionPort & { calls: number };
}

describe('resolveTurnMediaInjection — perception pre-pass', () => {
  const pngTurn = () => ({ kind: 'image' as const, source: { kind: 'base64' as const, value: PNG_B64 }, mimeType: 'image/png' });

  it('text-only model + image → derived description, framed untrusted, with provenance', async () => {
    const perception = fakePerception(async () => ({ text: '白底红色圆形', provider: 'g', model: 'flash-lite', cached: false }));
    const injection = await resolveTurnMediaInjection([pngTurn()], { providerInput: ['text'], perception });
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toHaveLength(1);
    expect(injection.textAppends[0]).toMatch(/^\[图片描述\] \[Untrusted media description/);
    expect(injection.textAppends[0]).toContain('source=external_content) 白底红色圆形');
    expect(injection.outcomes).toEqual([{
      kind: 'image', status: 'derived', code: 'media_perception',
      provenance: { source: 'media_perception', provider: 'g', model: 'flash-lite', cached: false },
    }]);
  });

  it('a model that takes images gets the image itself; perception is not called', async () => {
    const perception = fakePerception(async () => ({ text: 'x', provider: 'g', model: 'm', cached: false }));
    const injection = await resolveTurnMediaInjection([pngTurn()], { providerInput: ['text', 'image'], perception });
    expect(injection.outcomes).toEqual([{ kind: 'image', status: 'accepted', code: 'validated_provider_input' }]);
    expect(perception.calls).toBe(0);
  });

  it('perception failure (throw or empty) → today\'s placeholder', async () => {
    const failing = fakePerception(async () => { throw new Error('503'); });
    const empty = fakePerception(async () => ({ text: '  ', provider: 'g', model: 'm', cached: false }));
    for (const perception of [failing, empty]) {
      const injection = await resolveTurnMediaInjection([pngTurn()], { providerInput: ['text'], perception });
      expect(injection.textAppends).toEqual(['[Media unsupported:provider_input: image]']);
      expect(injection.outcomes).toEqual([{ kind: 'image', status: 'unsupported', code: 'provider_input' }]);
    }
  });

  it('kinds not accepted by the port keep the placeholder', async () => {
    const perception = fakePerception(async () => ({ text: 'x', provider: 'g', model: 'm', cached: false }), { accepts: () => false });
    const injection = await resolveTurnMediaInjection([pngTurn()], { providerInput: ['text'], perception });
    expect(injection.outcomes[0]).toMatchObject({ status: 'unsupported', code: 'provider_input' });
    expect(perception.calls).toBe(0);
  });

  it('maxItemsPerTurn bounds the perception calls; the rest keep placeholders', async () => {
    const perception = fakePerception(async () => ({ text: '图', provider: 'g', model: 'm', cached: false }), { maxItemsPerTurn: 2 });
    const injection = await resolveTurnMediaInjection([pngTurn(), pngTurn(), pngTurn()], { providerInput: ['text'], perception });
    expect(perception.calls).toBe(2);
    expect(injection.outcomes.map((outcome) => outcome.code)).toEqual(['media_perception', 'media_perception', 'provider_input']);
  });

  it('audio stays on STT first; perception is never asked for audio', async () => {
    const perception = fakePerception(async () => ({ text: 'x', provider: 'g', model: 'm', cached: false }), { accepts: () => true });
    const wav = Buffer.from('RIFF\0\0\0\0WAVEfmt ').toString('base64');
    const injection = await resolveTurnMediaInjection([
      { kind: 'audio', source: { kind: 'base64', value: wav }, mimeType: 'audio/wav' },
    ], { providerInput: ['text'], perception, transcriber: { transcribe: async () => '你好' } });
    expect(injection.textAppends).toEqual(['[语音转写] 你好']);
    expect(perception.calls).toBe(0);
  });

  it('an abort during perception propagates instead of degrading to a placeholder', async () => {
    const controller = new AbortController();
    const perception = fakePerception(async () => {
      controller.abort(new Error('cancelled'));
      throw new Error('aborted');
    });
    await expect(resolveTurnMediaInjection([pngTurn()], { providerInput: ['text'], perception, signal: controller.signal }))
      .rejects.toThrow('cancelled');
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
      outcomes: [],
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
    const out = applyInboundMediaInjection(messages, { blocks: [], textAppends: [], outcomes: [] });
    expect(out[0]).toBe(messages[0]);
  });
});
