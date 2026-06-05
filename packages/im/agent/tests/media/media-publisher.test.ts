import { describe, it, expect } from 'vitest';
import { publishOutboundElements } from '../../src/media/media-publisher.js';
import type { OutputElement } from '@zhin.js/ai';

describe('publishOutboundElements', () => {
  it('应将 ImageElement.base64 转为 image segment', async () => {
    const elements: OutputElement[] = [
      { type: 'image', url: '', base64: 'aGVsbG8=', alt: 'test' },
    ];
    const segs = await publishOutboundElements(elements, 'sandbox');
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('image');
    expect((segs[0].data as { base64?: string }).base64).toBe('aGVsbG8=');
  });

  it('cap 不含 audio 时应降级为文本', async () => {
    const elements: OutputElement[] = [
      { type: 'audio', url: '', base64: 'YWFh' },
    ];
    const segs = await publishOutboundElements(elements, undefined, {
      image: true,
      audio: false,
      video: false,
      file: false,
    });
    expect(segs.some(s => s.type === 'record')).toBe(false);
    expect(segs.some(s => s.type === 'text')).toBe(true);
  });

  it('cap 含 audio 时应产出 record segment', async () => {
    const elements: OutputElement[] = [
      { type: 'audio', url: '', base64: 'YWFh' },
    ];
    const segs = await publishOutboundElements(elements, 'sandbox');
    expect(segs.some(s => s.type === 'record')).toBe(true);
  });

  it('sandbox 大体积 base64 应落盘为 file 路径（避免出站模板超 400KB）', async () => {
    const large = Buffer.alloc(48_000, 0xab).toString('base64');
    const elements: OutputElement[] = [
      { type: 'image', url: `data:image/png;base64,${large}`, base64: large },
    ];
    const segs = await publishOutboundElements(elements, 'sandbox');
    expect(segs[0]?.type).toBe('image');
    const data = segs[0]?.data as { file?: string; base64?: string };
    expect(data.file).toBeTruthy();
    expect(data.base64).toBeUndefined();
  });

  it('icqq 大体积 base64 应保留在 segment（由适配器 CQ base64:// 发出）', async () => {
    const large = Buffer.alloc(48_000, 0xab).toString('base64');
    const elements: OutputElement[] = [
      { type: 'image', url: `data:image/png;base64,${large}`, base64: large },
    ];
    const segs = await publishOutboundElements(elements, 'icqq');
    const data = segs[0]?.data as { file?: string; base64?: string };
    expect(data.base64).toBe(large);
    expect(data.file).toBeUndefined();
  });
});
