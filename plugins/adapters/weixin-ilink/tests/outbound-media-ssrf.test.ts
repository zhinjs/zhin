import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { materializeOutboundMedia } from '../src/outbound-media.js';
import { downloadRemoteImageToTemp } from '../src/upload.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PNG, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';

let dir: string;
let network: ReturnType<typeof fakeOutboundMediaNetwork>;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilink-ssrf-')); network = fakeOutboundMediaNetwork(); });
afterEach(() => { network.restore(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('weixin-ilink outbound media URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not download a %s on this host and keeps the message with a notice', async (_label, url) => {
    const out = await materializeOutboundMedia([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: url } } },
    ], dir, undefined, network.fetchMedia);
    expect(out).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'text', data: { text: '[图片未发送：媒体地址不被允许]' } },
    ]);
    expect(fs.readdirSync(dir)).toEqual([]);
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS image through the pinned fetch to a local file', async () => {
    const out = await materializeOutboundMedia([{ type: 'image', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL } } }], dir, undefined, network.fetchMedia) as Array<{ data: { media: { kind: string; value: string } } }>;
    expect(out[0]!.data.media.kind).toBe('path');
    expect(fs.readFileSync(out[0]!.data.media.value).equals(PNG)).toBe(true);
    expect(out[0]!.data.media.value.endsWith('.png')).toBe(true);
    network.expectNoPrivateConnection();
  });

  it('downloadRemoteImageToTemp rethrows a refusal for the caller', async () => {
    await expect(downloadRemoteImageToTemp('http://cdn.example/a.png', dir, undefined, network.fetchMedia))
      .rejects.toMatchObject({ code: 'outbound_media_url_blocked', refused: true });
  });
});
