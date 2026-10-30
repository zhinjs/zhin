import { qqFixture } from './fixture.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { collectOutboundImageSizes, formatOutbound, formatOutboundMessages } from '../src/outbound.js';
import { imageSizeFromBytes, probeImageSize } from '../src/image-size.js';

/** Builds the real SDK request body so the test sees what QQ actually receives. */
async function buildSdkPayload(message: unknown): Promise<{ msg_type?: number; markdown?: { content?: string }; keyboard?: unknown }> {
  const require = createRequire(import.meta.url);
  const { MessageBuilder } = require(join(dirname(require.resolve('qq-official-bot/package.json')), 'lib/message/builder.js'));
  const built = await new MessageBuilder('appid', false, { id: 'source-msg' }).build(message);
  return built.messagePayload;
}

// Canonical payload produced by commandMenuReply for a multi-page menu on a
// native markdown + native keyboard endpoint (see core im-runtime.test.ts):
// [menu body text, markdown page title, keyboard].
const menuBody = '=== root 指令菜单 ===\n第 1/3 页 · 60 条指令 · 0 个子插件\n\n  /cmd1  - 指令一\n  /cmd2  - 指令二\n\n下一页：/菜单 --page 2';
const menuPayload = [
  { type: 'text', data: { text: menuBody } },
  { type: 'markdown', data: { content: '**指令菜单** · 第 1/3 页' } },
  { type: 'keyboard', data: { rows: [[
    { label: '上一页', payload: 'prev', disabled: true, style: 'secondary' },
    { label: '下一页', payload: 'next', disabled: false, style: 'primary' },
  ]] } },
];

describe('paginated command menu on QQ official', () => {
  it('keeps the command list alongside the page title and buttons', async () => {
    const body = await buildSdkPayload(formatOutbound(menuPayload));
    expect(body.msg_type).toBe(2);
    expect(body.keyboard).toBeDefined();
    expect(body.markdown?.content).toContain('/cmd1  - 指令一');
    expect(body.markdown?.content).toContain('/cmd2  - 指令二');
    expect(body.markdown?.content).toContain('**指令菜单** · 第 1/3 页');
  });

  it('merges every inline markdown segment of a button message into one, in order', () => {
    const out = formatOutbound([
      { type: 'markdown', data: { content: 'first' } },
      { type: 'markdown', data: { content: 'second' } },
      { type: 'keyboard', data: { rows: [[{ label: 'ok', payload: 'ok' }]] } },
    ]) as Array<{ type: string; data: { content?: string } }>;
    expect(out.filter(part => part.type === 'markdown')).toEqual([{ type: 'markdown', data: { content: 'first\n\nsecond' } }]);
  });
});

describe('text + inline markdown without buttons on QQ official', () => {
  it('keeps the text by merging it into the single markdown, in order', async () => {
    const out = formatOutbound([
      { type: 'text', data: { text: '正文第一段' } },
      { type: 'markdown', data: { content: '**标题**' } },
      { type: 'text', data: { text: '结尾' } },
    ]);
    expect(out).toEqual({ type: 'markdown', data: { content: '正文第一段\n\n**标题**\n\n结尾' } });
    const body = await buildSdkPayload(out);
    expect(body.msg_type).toBe(2);
    expect(body.markdown?.content).toBe('正文第一段\n\n**标题**\n\n结尾');
  });

  it('keeps one markdown when an @ splits the text', () => {
    const out = formatOutbound([
      { type: 'text', data: { text: 'a' } },
      { type: 'at', data: { user_id: 'u1' } },
      { type: 'text', data: { text: 'b' } },
      { type: 'markdown', data: { content: 'c' } },
    ]) as Array<{ type: string; data: Record<string, unknown> }>;
    expect(out.filter(part => part.type === 'markdown')).toEqual([{ type: 'markdown', data: { content: 'ab\n\nc' } }]);
  });

  it('leaves template markdown and plain text unchanged', () => {
    expect(formatOutbound([
      { type: 'text', data: { text: 'hi' } },
      { type: 'markdown', data: { custom_template_id: 'tpl', params: [{ key: 'k', values: ['v'] }] } },
    ])).toEqual(['hi', { type: 'markdown', data: { custom_template_id: 'tpl', params: [{ key: 'k', values: ['v'] }] } }]);
    expect(formatOutbound([{ type: 'text', data: { text: 'hi' } }, { type: 'text', data: { text: ' there' } }])).toBe('hi there');
    expect(formatOutbound('plain')).toBe('plain');
  });
});

async function buildSdkMessage(message: unknown): Promise<{ isFile: boolean; filePayload: Record<string, unknown>; messagePayload: { msg_type?: number; msg_id?: string; markdown?: { content?: string }; keyboard?: unknown } }> {
  const require = createRequire(import.meta.url);
  const { MessageBuilder } = require(join(dirname(require.resolve('qq-official-bot/package.json')), 'lib/message/builder.js'));
  return new MessageBuilder('appid', false).build(message);
}

// commandMenuReply with an HTML renderer: [menu image, markdown page title, keyboard]
const imageMenuPayload = [
  { type: 'reply', data: { message_id: 'src-1' } },
  { type: 'image', data: { media: { kind: 'base64', value: 'iVBORw0KGgo=' } } },
  ...menuPayload.slice(1),
];

describe('image menu (image + markdown + keyboard) on QQ official', () => {
  it('loses the image when sent as one message (documents the SDK conflict)', async () => {
    const built = await buildSdkMessage(formatOutbound(imageMenuPayload));
    expect(built.isFile).toBe(true);
    expect(built.messagePayload.msg_type).toBe(2); // media msg_type 7 overwritten by markdown
  });

  it('sends the image first as its own media message, then markdown + buttons', async () => {
    const messages = formatOutboundMessages(imageMenuPayload);
    expect(messages).toHaveLength(2);
    const [image, menu] = await Promise.all(messages.map(buildSdkMessage));
    expect(image!.isFile).toBe(true);
    expect(image!.messagePayload.msg_type).toBe(7);
    expect(image!.messagePayload.msg_id).toBe('src-1');
    expect(image!.filePayload.file).toBe('base64://iVBORw0KGgo=');
    expect(image!.messagePayload.markdown).toBeUndefined();
    expect(menu!.isFile).toBe(false);
    expect(menu!.messagePayload.msg_type).toBe(2);
    expect(menu!.messagePayload.msg_id).toBe('src-1');
    expect(menu!.messagePayload.markdown?.content).toBe('**指令菜单** · 第 1/3 页');
    expect(menu!.messagePayload.keyboard).toBeDefined();
  });

  it('keeps single-message payloads as one message', () => {
    expect(formatOutboundMessages('plain')).toEqual(['plain']);
    expect(formatOutboundMessages(menuPayload)).toHaveLength(1);
    expect(formatOutboundMessages([{ type: 'text', data: { text: 'cap' } }, { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } }])).toEqual([
      ['cap', { type: 'image', data: { url: 'https://x/y.png' } }],
    ]);
  });

  it('endpoint sends the image message before the menu message and returns the menu message id', async () => {
    const { QqWebsocketEndpoint } = await import('../src/endpoint.js');
    const { resolveQqConfig } = await import('../src/protocol.js');
    const { capabilityId, rootPluginId, featureId } = await import('zhin.js');
    const sent: unknown[] = [];
    const endpoint = await qqFixture(() => new QqWebsocketEndpoint({id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'qq'),config: resolveQqConfig({ id: 'fixture', appid: 'fixture', secret: 'fixture' }) as any}), () => ({ api: {}, start: async () => {}, stop: async () => {}, on: () => {}, removeAllListeners: () => {}, sendGroupMessage: async (_id: string, message: unknown) => { sent.push(message); return { id: `m${sent.length}` }; } }) as any);
    try {
      await endpoint.start();
      const id = await endpoint.send({ conversation: { endpoint: { id: 'fixture', adapter: 'root/qq' }, kind: 'group', id: 'g1' } as any, payload: imageMenuPayload });
      expect(sent).toHaveLength(2);
      expect(JSON.stringify(sent[0])).toContain('"image"');
      expect(JSON.stringify(sent[0])).not.toContain('markdown');
      expect(JSON.stringify(sent[1])).toContain('指令菜单');
      expect(id).toMatch(/:m2$/);
    } finally { await endpoint.stop(); }
  });
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const urlMenuPayload = [
  { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example/menu.png' } } },
  ...menuPayload.slice(1),
];

describe('image menu with a public URL: embedded in the markdown', () => {
  it('embeds the image as ![图片 #Wpx #Hpx](url) in the single markdown + keyboard message', async () => {
    const messages = formatOutboundMessages(urlMenuPayload, { imageSizes: new Map([['https://cdn.example/menu.png', { width: 1080, height: 1200 }]]) });
    expect(messages).toHaveLength(1);
    const built = await buildSdkMessage(messages[0]);
    expect(built.isFile).toBe(false);
    expect(built.messagePayload.msg_type).toBe(2);
    expect(built.messagePayload.markdown?.content).toBe('![图片 #1080px #1200px](https://cdn.example/menu.png)\n\n**指令菜单** · 第 1/3 页');
    expect(built.messagePayload.keyboard).toBeDefined();
  });

  it('builds a markdown from the image alone when the message only has buttons', () => {
    const [message] = formatOutboundMessages([urlMenuPayload[0], menuPayload[2]], { imageSizes: new Map([['https://cdn.example/menu.png', { width: 10, height: 20 }]]) });
    expect((message as Array<{ type: string; data: Record<string, unknown> }>)[0]).toEqual({ type: 'markdown', data: { content: '![图片 #10px #20px](https://cdn.example/menu.png)' } });
  });

  it('falls back to a separate media message when the size is unknown or the markdown is a template', () => {
    expect(formatOutboundMessages(urlMenuPayload)).toHaveLength(2);
    const sizes = new Map([['https://cdn.example/menu.png', { width: 1, height: 1 }]]);
    const template = [urlMenuPayload[0], { type: 'markdown', data: { custom_template_id: 'tpl' } }, menuPayload[2]];
    const messages = formatOutboundMessages(template, { imageSizes: sizes });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: 'image', data: { url: 'https://cdn.example/menu.png' } });
  });

  it('collects sizes only for http(s) images in markdown/button messages', async () => {
    const probe = vi.fn(async () => ({ width: 3, height: 4 }));
    expect(await collectOutboundImageSizes(urlMenuPayload, probe)).toEqual(new Map([['https://cdn.example/menu.png', { width: 3, height: 4 }]]));
    expect(await collectOutboundImageSizes([urlMenuPayload[0]], probe)).toEqual(new Map());
    expect(await collectOutboundImageSizes(imageMenuPayload, probe)).toEqual(new Map());
    expect(probe).toHaveBeenCalledTimes(1);
    expect(await collectOutboundImageSizes(urlMenuPayload, async () => undefined)).toEqual(new Map());
  });

  it('endpoint probes the URL image and sends one embedded message', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, body: null, arrayBuffer: async () => pngHeader(800, 600).buffer }));
    vi.stubGlobal('fetch', fetchMock);
    const { QqWebsocketEndpoint } = await import('../src/endpoint.js');
    const { resolveQqConfig } = await import('../src/protocol.js');
    const { capabilityId, rootPluginId, featureId } = await import('zhin.js');
    const sent: unknown[] = [];
    const endpoint = await qqFixture(() => new QqWebsocketEndpoint({id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'qq'),config: resolveQqConfig({ id: 'fixture', appid: 'fixture', secret: 'fixture' }) as any}), () => ({ api: {}, start: async () => {}, stop: async () => {}, on: () => {}, removeAllListeners: () => {}, sendGroupMessage: async (_id: string, message: unknown) => { sent.push(message); return { id: `m${sent.length}` }; } }) as any);
    try {
      await endpoint.start();
      await endpoint.send({ conversation: { endpoint: { id: 'fixture', adapter: 'root/qq' }, kind: 'group', id: 'g1' } as any, payload: urlMenuPayload });
      expect(sent).toHaveLength(1);
      expect(JSON.stringify(sent[0])).toContain('![图片 #800px #600px](https://cdn.example/menu.png)');
      expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/menu.png', expect.objectContaining({ headers: { Range: 'bytes=0-65535' } }));
    } finally { await endpoint.stop(); vi.unstubAllGlobals(); }
  });
});

describe('image size probing', () => {
  it('parses PNG, GIF, JPEG and WebP headers', () => {
    expect(imageSizeFromBytes(pngHeader(1080, 1200))).toEqual({ width: 1080, height: 1200 });
    expect(imageSizeFromBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]))).toEqual({ width: 320, height: 240 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03]);
    expect(imageSizeFromBytes(jpeg)).toEqual({ width: 640, height: 480 });
    const webp = new Uint8Array(30);
    webp.set([...'RIFF'].map(c => c.charCodeAt(0)), 0);
    webp.set([...'WEBPVP8X'].map(c => c.charCodeAt(0)), 8);
    webp.set([0x1f, 0x03, 0x00, 0x57, 0x02, 0x00], 24); // 800 x 600
    expect(imageSizeFromBytes(webp)).toEqual({ width: 800, height: 600 });
    expect(imageSizeFromBytes(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it('returns undefined on HTTP errors, network errors and unknown formats', async () => {
    expect(await probeImageSize('https://x/a.png', async () => ({ ok: true, body: null, arrayBuffer: async () => pngHeader(5, 6).buffer }))).toEqual({ width: 5, height: 6 });
    expect(await probeImageSize('https://x/a.png', async () => ({ ok: false, body: null, arrayBuffer: async () => new ArrayBuffer(0) }))).toBeUndefined();
    expect(await probeImageSize('https://x/a.png', async () => { throw new Error('offline'); })).toBeUndefined();
    expect(await probeImageSize('https://x/a.txt', async () => ({ ok: true, body: null, arrayBuffer: async () => new TextEncoder().encode('hello').buffer }))).toBeUndefined();
  });

  it('reads at most the header from a streamed body', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; controller.enqueue(pulls === 1 ? pngHeader(7, 8) : new Uint8Array(40000)); } });
    expect(await probeImageSize('https://x/a.png', async () => ({ ok: true, body, arrayBuffer: async () => new ArrayBuffer(0) }))).toEqual({ width: 7, height: 8 });
    expect(pulls).toBeLessThan(10);
  });
});

