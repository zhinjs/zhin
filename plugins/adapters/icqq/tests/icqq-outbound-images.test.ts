import { projectLocaleToken } from 'zhin.js/i18n';
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  SnapshotStore, createCapabilitySlot, createSnapshotView, htmlRendererToken, rootPluginId,
  type CapabilityId, type CapabilitySlot, type FeatureId, type SnapshotState, type TokenId,
} from '../../../../packages/im/plugin-runtime/src/index.js';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken } from 'zhin.js/adapter';
import { MiddlewareIndex, defineMiddleware, middlewareFeatureId } from '../../../../packages/im/middleware/src/index.js';
import { ImRuntime, loginAssistToken, type OutboundEnvelope, type SendContent } from '@zhin.js/core/runtime';
import { Html, Image, jsx } from 'zhin.js/jsx';
import type { ImageElem } from '@icqqjs/icqq';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import definition from '../adapters/icqq/index.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import { formatOutboundBody, normalizeIcqqImageMedia } from '../src/protocol.js';
import { prepareIcqqOutboundMedia } from '../src/outbound-media.js';

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64');
const base64 = bytes.toString('base64');
const dataUrl = `data:image/png;base64,${base64}`;

describe('ICQQ inline image projection', () => {
  it.each(['url', 'path', 'file', 'base64'] as const)('converts a data URL in canonical %s media without mutating the source', kind => {
    const content = { type: 'image', data: { media: { kind, value: dataUrl } } };
    expect(formatOutboundBody(content)).toEqual({ type: 'image', file: `base64://${base64}` });
    expect(normalizeIcqqImageMedia(content)).toMatchObject({ data: { media: { kind: 'base64', value: base64, mime_type: 'image/png' } } });
    expect(content.data.media).toEqual({ kind, value: dataUrl });
  });

  it('handles MIME parameters and leaves supported canonical source formats unchanged', () => {
    expect(formatOutboundBody({ type: 'image', data: { media: { kind: 'url', value: `data:image/png;charset=utf-8;BASE64,${base64}` } } }))
      .toEqual({ type: 'image', file: `base64://${base64}` });
    for (const [kind, value, file] of [
      ['url', 'https://example.com/image.png', 'https://example.com/image.png'],
      ['path', '/tmp/image.png', '/tmp/image.png'],
      ['path', 'C:\\images\\image.png', 'C:\\images\\image.png'],
      ['base64', base64, `base64://${base64}`],
      ['base64', `base64://${base64}`, `base64://${base64}`],
    ] as const) {
      const content = { type: 'image', data: { media: { kind, value } } };
      expect(normalizeIcqqImageMedia(content)).toBe(content);
      expect(formatOutboundBody(content)).toEqual({ type: 'image', file });
    }
    expect(() => formatOutboundBody({ type: 'image', data: { media: { kind: 'url', value: 'data:image/png,not-base64' } } }))
      .toThrow('ICQQ image data URL must contain base64 image data');
  });

  it.each([undefined, 'IMAGE/PNG'])('normalizes mixed-case MIME before temporary-file delivery (override=%s)', mime_type => {
    const content = { type: 'image', data: { media: { kind: 'url' as const,
      value: `DATA:IMAGE/PNG;charset=utf-8;BASE64,${base64}`, ...(mime_type ? { mime_type } : {}),
    } } };
    const normalized = normalizeIcqqImageMedia(content);
    expect(normalized).toMatchObject({ data: { media: { mime_type: 'image/png' } } });
    const prepared = prepareIcqqOutboundMedia(normalized, 'file');
    let file: string;
    try {
      const projected = formatOutboundBody(prepared.content) as ImageElem;
      expect(typeof projected.file).toBe('string');
      if (typeof projected.file !== 'string') throw new Error('Expected materialized file');
      file = projected.file;
      expect(file).toMatch(/\.png$/);
      expect(readFileSync(file)).toEqual(bytes);
      expect(content.data.media.value).toContain('IMAGE/PNG');
    } finally { prepared.dispose(); }
    expect(existsSync(file)).toBe(false);
  });

  it('produces native base64 input that the installed SDK can actually probe', async () => {
    const sdk = await vi.importActual<typeof import('@icqqjs/icqq')>('@icqqjs/icqq');
    const image = formatOutboundBody({ type: 'image', data: { media: { kind: 'url', value: dataUrl } } }) as ImageElem;
    // Image probing uses this flag only; no account, network, or platform send.
    const native = new sdk.Image({ useQQNT: false } as import('@icqqjs/icqq').Client, image);
    await native.task;
    expect(native.width).toBe(1);
    expect(native.height).toBe(1);
    expect(native.size).toBe(bytes.length);
    native.readable?.destroy();
  });
});

describe('unified IM image delivery to ICQQ', () => {
  it.each(['  hello  ', ' \n '])('does not certify rewritten primitive text as exact canonical history: %j', async text => {
    const fixture = await imageFixture('base64', async (input, next) => { input.replace(text); await next(); });
    try {
      const receipt = await fixture.im.send({ requester: fixture.root, conversation: fixture.conversation, content: 'planned' });
      expect(fixture.endpoint.sendGroupMsg).toHaveBeenCalledExactlyOnceWith(100, text.trim() || '\u200b');
      expect(receipt).toMatchObject({ status: 'sent', message: { id: 'sent-1' }, parts: [{ message: { id: 'sent-1' } }] });
      expect(receipt.parts?.[0]?.sourceIndices).toBeUndefined();
      expect(receipt.parts?.[0]?.outboundTextDigest).toBeUndefined();
      expect(receipt.outboundTextDigest).toBeUndefined();
      const pending = await fixture.im.readConversationContext(fixture.conversation, 'test-consumer', Number.MAX_SAFE_INTEGER);
      expect(pending.blocks).toHaveLength(1);
      expect(pending.blocks[0]?.text).toContain('content unavailable');
      expect(pending.blocks[0]?.messageTextDigest).toBeUndefined();
    } finally { await fixture.adapters.stop(); await fixture.store.close(); }
  });

  it.each(['base64', 'file'] as const)('routes native, JSX, HTML and tool images through middleware in %s mode', async mode => {
    const seen: unknown[] = [];
    const fixture = await imageFixture(mode, async (input, next) => { seen.push(input.payload); await next(); });
    const delivered: string[] = [];
    const temporaryFiles: string[] = [];
    vi.spyOn(fixture.endpoint, 'sendGroupMsg').mockImplementation(async (_group, image) => {
      if (typeof image !== 'object' || Array.isArray(image) || image.type !== 'image') throw new Error('Expected native image element');
      const file = image.file;
      expect(typeof file).toBe('string');
      if (typeof file !== 'string') throw new Error('Expected canonical image projection');
      expect(file).not.toMatch(/^data:/i);
      if (mode === 'file') {
        expect(readFileSync(file)).toEqual(bytes);
        temporaryFiles.push(file);
      } else expect(file).toBe(`base64://${base64}`);
      delivered.push(file);
      return { message_id: `image-${delivered.length}`, seq: 1, rand: 1, time: 1 };
    });
    const CustomImage = () => jsx('image', { src: dataUrl });
    // Tool results use the same SendContent contract as commands and replies.
    const toolImage = async (): Promise<SendContent> => ({ type: 'image', data: { url: dataUrl } });
    const contents: SendContent[] = [
      { type: 'image', data: { media: { kind: 'url', value: dataUrl } } },
      { type: 'image', data: { media: { kind: 'base64', value: dataUrl } } },
      jsx('image', { src: dataUrl }),
      Image({ src: dataUrl }),
      jsx(CustomImage, {}),
      jsx(Html, { children: jsx('b', { children: 'screenshot' }) }),
      await toolImage(),
    ];
    try {
      for (const content of contents) {
        expect(await fixture.im.send({ requester: fixture.root, conversation: fixture.conversation, content })).toMatchObject({ status: 'sent' });
      }
      expect(seen).toHaveLength(contents.length);
      expect(delivered).toHaveLength(contents.length);
      expect(fixture.renderHtml).toHaveBeenCalled();
      for (const file of temporaryFiles) expect(existsSync(file)).toBe(false);
    } finally { await fixture.adapters.stop(); await fixture.store.close(); }
  });

  it('normalizes images introduced by outbound middleware and respects suppression', async () => {
    let suppress = false;
    const fixture = await imageFixture('base64', async (input, next) => {
      input.replace({ type: 'image', data: { url: dataUrl } });
      if (!suppress) await next();
    });
    try {
      expect(await fixture.im.send({ requester: fixture.root, conversation: fixture.conversation, content: 'tool placeholder' })).toMatchObject({ status: 'sent' });
      expect(fixture.endpoint.sendGroupMsg).toHaveBeenCalledWith(100, { type: 'image', file: `base64://${base64}` });
      suppress = true;
      expect(await fixture.im.send({ requester: fixture.root, conversation: fixture.conversation, content: 'blocked' })).toMatchObject({ status: 'suppressed' });
      expect(fixture.endpoint.sendGroupMsg).toHaveBeenCalledTimes(1);
    } finally { await fixture.adapters.stop(); await fixture.store.close(); }
  });
});

async function imageFixture(mode: 'file' | 'base64', handle: (input: OutboundEnvelope, next: () => Promise<void>) => Promise<void>) {
  const root = rootPluginId();
  const im = new ImRuntime();
  const renderHtml = vi.fn(async () => ({ data: bytes, format: 'png' as const, width: 1, height: 1, mimeType: 'image/png' }));
  const adapter = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'icqq',
    source: '/project/adapters/icqq/index.ts', definition });
  const middleware = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'before-send',
    source: '/project/middlewares/before-send/index.ts', definition: defineMiddleware<OutboundEnvelope>({ target: 'outbound', handle: ({ input }, next) => handle(input, next) }) });
  const resources = new Map<TokenId, unknown>([
    [projectLocaleToken.id, 'zh-CN'],
    [endpointEventGatewayToken.id, im.endpointEvents], [loginAssistToken.id, im.loginAssist],
    [htmlRendererToken.id, { render: renderHtml }],
  ]);
  const state: SnapshotState = {
    root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@zhin.js/adapter-icqq', packageRoot: '/project', children: [] }]]),
    config: new Map([[root, { id: '10001', autoReconnect: false, outboundMedia: mode }]]),
    resources: new Map([[root, resources]]), capabilities: new Map<CapabilityId, CapabilitySlot>([[adapter.id, adapter], [middleware.id, middleware]]), projections: new Map(),
  };
  const view = createSnapshotView(0, state);
  const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map<FeatureId, unknown>([
    [adapterFeatureId, adapters], [middlewareFeatureId, new MiddlewareIndex([middleware], view)],
  ]) });
  im.attach(store);
  await adapters.start();
  adapters.open();
  const endpoint = adapters.client<import('../src/endpoint.js').IcqqEndpoint>('icqq', 'icqq');
  if (!(endpoint instanceof IcqqEndpoint)) throw new Error('Expected ICQQ endpoint');
  return { root, im, adapters, store, endpoint, renderHtml,
    conversation: { endpoint: { id: String(adapter.id), adapter: 'icqq' }, kind: 'group' as const, id: '100' } };
}
