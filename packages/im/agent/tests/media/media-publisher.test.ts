import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { publishOutboundElements } from '../../src/media/media-publisher.js';
import type { OutputElement } from '@zhin.js/ai';

describe('publishOutboundElements', () => {
  it('保留 AI markdown 语义到 canonical segment', async () => {
    await expect(publishOutboundElements([
      { type: 'text', content: '**完成**', format: 'markdown' },
      { type: 'text', content: 'plain', format: 'plain' },
    ], 'qq')).resolves.toEqual([
      { type: 'markdown', data: { content: '**完成**' } },
      { type: 'text', data: { text: 'plain' } },
    ]);
  });

  it('将带命令按钮的 card 发布为 markdown + keyboard', async () => {
    const segs = await publishOutboundElements([{
      type: 'card',
      title: '确认操作',
      description: '即将部署生产环境。',
      buttons: [
        { text: '确认', command: 'yes' },
        { text: '文档', url: 'https://example.com/docs' },
      ],
    }], 'qq');
    expect(segs).toEqual([
      {
        type: 'markdown',
        data: { content: '## 确认操作\n\n即将部署生产环境。\n\n[文档](https://example.com/docs)' },
      },
      {
        type: 'keyboard',
        data: {
          rows: [[expect.objectContaining({ label: '确认', payload: 'yes', mode: 'command' })]],
          fallback: { hint: '也可以直接发送对应指令。', map: { '1': 'yes' } },
        },
      },
    ]);
  });

  it('应将 ImageElement.base64 转为 image segment', async () => {
    const elements: OutputElement[] = [
      { type: 'image', url: '', base64: 'aGVsbG8=', alt: 'test' },
    ];
    const segs = await publishOutboundElements(elements, 'sandbox');
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('image');
    expect((segs[0].data as { media?: { value?: string } }).media?.value).toBe('aGVsbG8=');
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

  it('cap 含 audio 时应产出 canonical audio segment', async () => {
    const elements: OutputElement[] = [
      { type: 'audio', url: '', base64: 'YWFh' },
    ];
    const segs = await publishOutboundElements(elements, 'sandbox');
    expect(segs.some(s => s.type === 'audio')).toBe(true);
  });

  it('sandbox 大体积 base64 应落盘为 file 路径（避免出站模板超 400KB）', async () => {
    const large = Buffer.alloc(48_000, 0xab).toString('base64');
    const elements: OutputElement[] = [
      { type: 'image', url: `data:image/png;base64,${large}`, base64: large },
    ];
    const segs = await publishOutboundElements(elements, 'sandbox');
    expect(segs[0]?.type).toBe('image');
    const data = segs[0]?.data as { media?: { kind?: string; value?: string } };
    expect(data.media?.kind).toBe('path');
    expect(data.media?.value).toBeTruthy();
    expect((data as { base64?: string }).base64).toBeUndefined();
  });

  it('icqq 大体积 base64 应保留在 segment（由适配器 CQ base64:// 发出）', async () => {
    const large = Buffer.alloc(48_000, 0xab).toString('base64');
    const elements: OutputElement[] = [
      { type: 'image', url: `data:image/png;base64,${large}`, base64: large },
    ];
    const segs = await publishOutboundElements(elements, 'icqq');
    const data = segs[0]?.data as { media?: { kind?: string; value?: string } };
    expect(data.media?.kind).toBe('base64');
    expect(data.media?.value).toBe(large);
  });

  it('file 输出保留 file 意图，不会因扩展名被改写为 image', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-media-test-'));
    const filePath = path.join(directory, 'report.png');
    await fs.writeFile(filePath, 'png bytes');
    try {
      const segs = await publishOutboundElements([
        { type: 'file', name: 'report.png', url: filePath },
      ], 'sandbox');
      expect(segs[0]).toMatchObject({
        type: 'file',
        data: { name: 'report.png', media: { kind: 'base64' } },
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
