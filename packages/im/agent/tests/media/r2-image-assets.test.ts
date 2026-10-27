import { R2ImageAssetPublisher } from '../../src/media/r2-image-assets.js';
import { publishReplyImages } from '../../src/media/publish-image-reply.js';
import { publishOutboundElements } from '../../src/media/media-publisher.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '@zhin.js/ai';

const config = {
  accountId: 'a'.repeat(32), bucket: 'test-images', prefix: 'generated/',
  accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret', publicBaseUrl: 'https://images.example.test',
};
// Two-frame GIF: shared header/palette, two graphic-control/image blocks, trailer.
const frame = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const gif = Buffer.concat([frame.subarray(0, -1), frame.subarray(19, -1), Buffer.from([0x3b])]);
function fixture(status = 200) {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status }));
  return { fetchImpl, publisher: new R2ImageAssetPublisher(config, fetchImpl) };
}

it('signs one PUT and returns only the public URL and detected image metadata', async () => {
  const { fetchImpl, publisher } = fixture();
  const image = await publisher.publish(gif);
  const request = fetchImpl.mock.calls[0][0] as Request;
  expect(request.url).toMatch(/^https:\/\/a{32}\.r2\.cloudflarestorage\.com\/test-images\/generated\/[0-9a-f-]+\.gif$/);
  expect(request.method).toBe('PUT');
  expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
  expect(request.headers.get('content-type')).toBe('image/gif');
  expect(request.headers.get('cache-control')).toBe('no-store');
  expect(Buffer.from(await request.arrayBuffer())).toEqual(gif);
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  expect(image).toMatchObject({ mime: 'image/gif', size: gif.length });
  expect(publisher.ownsUrl(image.image_url)).toBe(true);
  expect(JSON.stringify(image)).not.toContain(gif.toString('base64'));
  expect(JSON.stringify(image)).not.toContain('fixture-secret');
});

it('does not retry failed uploads or accept arbitrary files disguised as images', async () => {
  const { fetchImpl, publisher } = fixture(503);
  await expect(publisher.publish(gif)).rejects.toThrow('HTTP 503');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await expect(publisher.publish(Buffer.from('<script>no</script>'))).rejects.toThrow('Only PNG');
  await expect(publisher.publish(Buffer.alloc(26_214_401))).rejects.toThrow('25 MiB');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('propagates cancellation to upload and never sends an already-cancelled request', async () => {
  const { fetchImpl, publisher } = fixture();
  const controller = new AbortController();
  await publisher.publish(gif, controller.signal);
  expect(fetchImpl.mock.calls[0][1]?.signal).toBe(controller.signal);
  controller.abort();
  await expect(publisher.publish(gif, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('passes only its exact public image namespace to the outbound gateway without downloading it', async () => {
  const { publisher } = fixture();
  const image = await publisher.publish(gif);
  for (const url of [image.image_url + '?redirect=1', image.image_url + '/extra', image.image_url.replace('generated/', 'other/'),
    image.image_url.replace('images.example.test', 'images.example.test.evil')]) expect(publisher.ownsUrl(url)).toBe(false);
  const fetchImpl = vi.fn();
  vi.stubGlobal('fetch', fetchImpl);
  try {
    const segments = await publishOutboundElements([{ type: 'image', url: image.image_url }], 'icqq', undefined, { imageAssets: publisher });
    expect(segments).toEqual([{ type: 'image', data: { media: { kind: 'url', value: image.image_url } } }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

function reply(value: string, kind = 'base64'): AssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ messages: [{ segments: [
      { type: 'image', data: { media: { kind, value } } },
      { type: 'text', data: { text: 'Here is the image.' } },
    ] }] }) }],
    usage: EMPTY_TOKEN_USAGE, api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop', timestamp: 1,
  };
}

it.each(['base64', 'url'])('replaces final image bytes before history and delivery: %s', async kind => {
  const { publisher } = fixture();
  const base64 = gif.toString('base64');
  const original = reply(kind === 'base64' ? base64 : `data:image/gif;base64,${base64}`, kind);
  const output = await publishReplyImages(original, publisher);
  expect(JSON.stringify(output)).not.toContain(base64);
  expect(JSON.stringify(output)).toContain('https://images.example.test/generated/');
  expect(JSON.stringify(original)).toContain(base64);
  expect(output.usage).toBe(original.usage);
});

it.each(['fence', 'encoded', 'bracket'])('normalizes the same recoverable reply forms as the existing parser: %s', async wrapper => {
  const { publisher } = fixture();
  const original = reply(gif.toString('base64'));
  const block = original.content[0];
  if (block.type !== 'text') throw new Error('Missing fixture text');
  block.text = wrapper === 'encoded' ? JSON.stringify(block.text)
    : wrapper === 'fence' ? `\u0060\u0060\u0060json\n${block.text}\n\u0060\u0060\u0060` : block.text.slice(0, -1);
  const output = await publishReplyImages(original, publisher);
  expect(JSON.stringify(output)).not.toContain(gif.toString('base64'));
  expect(JSON.stringify(output)).toContain('https://images.example.test/generated/');
});

it('stores a short upload failure without bytes or another generation call', async () => {
  const { publisher, fetchImpl } = fixture(503);
  const output = await publishReplyImages(reply(gif.toString('base64')), publisher);
  expect(JSON.stringify(output)).not.toContain(gif.toString('base64'));
  expect(JSON.stringify(output)).toContain('图片上传失败');
  expect(JSON.stringify(output)).toContain('Here is the image.');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
