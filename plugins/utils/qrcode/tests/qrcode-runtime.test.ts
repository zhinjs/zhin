import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { isRawContent } from '@zhin.js/core/runtime';
import { buildQrImageUrl, qrImageSegment } from '../src/qrcode-lib.js';
import plugin from '../plugin.ts';
import qrcodeCommand from '../commands/[text:string].ts';
import scanCommand from '../commands/scan/[url:string].ts';

describe('@zhin.js/plugin-qrcode', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('qrcode');
  });

  it('builds QR image URL and segment', () => {
    const url = buildQrImageUrl('hello');
    expect(url).toContain('create-qr-code');
    expect(url).toContain(encodeURIComponent('hello'));
    expect(qrImageSegment('hello')).toEqual([
      { type: 'image', data: { url } },
    ]);
  });

  it('exposes qrcode and scan commands', async () => {
    expect(parseCommandDefinition(qrcodeCommand)).toBe(qrcodeCommand);
    expect(parseCommandDefinition(scanCommand)).toBe(scanCommand);
    const content = await qrcodeCommand.execute({
      owner: {} as never,
      generation: 0,
      config: {},
      use: () => {
        throw new Error('unused');
      },
      args: [],
      params: { text: 'ping' },
      input: undefined,
    });
    expect(isRawContent(content)).toBe(true);
    expect(isRawContent(content) && content.payload).toEqual({
      type: 'image',
      data: { url: buildQrImageUrl('ping') },
    });
  });
});
