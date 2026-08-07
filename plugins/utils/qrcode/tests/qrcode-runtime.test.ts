import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { isRawContent } from '@zhin.js/core/runtime';
import { buildQrImageUrl, qrImageSegment } from '../src/qrcode-lib.js';
import plugin from '../plugin.js';
import qrcodeCommand from '../commands/gen/[text].js';
import scanCommand from '../commands/scan/[url].js';

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
      segments: [],
      input: undefined,
    });
    expect(isRawContent(content)).toBe(true);
    expect(isRawContent(content) && content.payload).toEqual({
      type: 'image',
      data: { url: buildQrImageUrl('ping') },
    });
  });

  it('joins args so text with spaces is fully encoded', async () => {
    const content = await qrcodeCommand.execute({
      owner: {} as never,
      generation: 0,
      config: {},
      use: () => {
        throw new Error('unused');
      },
      args: ['beautiful', 'world'],
      params: { text: 'hello' },
      segments: [],
      input: undefined,
    });
    expect(isRawContent(content)).toBe(true);
    expect(isRawContent(content) && content.payload).toEqual({
      type: 'image',
      data: { url: buildQrImageUrl('hello beautiful world') },
    });
  });
});
