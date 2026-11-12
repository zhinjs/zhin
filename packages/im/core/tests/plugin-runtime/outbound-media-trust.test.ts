import { describe, expect, it, vi } from 'vitest';
import { componentHostToken, type ComponentHost, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ConversationRef, MediaRef, Segment } from '@zhin.js/im-contract';
import { renderTemplatePaths } from '@zhin.js/kernel';
import { OutboundRenderer } from '../../src/plugin-runtime/im/outbound-renderer.js';
import { untrustedContent, type SendContent } from '../../src/plugin-runtime/im/contracts.js';
import {
  checkUntrustedMediaRef,
  DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES,
  isPlatformFileToken,
  trustedMediaRef,
  type OutboundMediaTrust,
} from '../../src/built/outbound-media-trust.js';

const rootId = 'plugin:root';
const host: ComponentHost = { compileTemplate: (text, ctx) => renderTemplatePaths(text, { ...ctx }) };
const snapshot = {
  root: rootId,
  projections: new Map(),
  resources: new Map([[rootId, new Map([[componentHostToken.id, host]])]]),
} as unknown as RuntimeSnapshot;
const conversation: ConversationRef = { endpoint: { id: 'napcat:bot', adapter: 'napcat' }, kind: 'group', id: '1' };
const renderer = new OutboundRenderer();
const render = (content: SendContent) => renderer.render(content, {
  requester: 'plugin:agent' as never, snapshot, conversation,
  incoming: { sender: { id: 'u1', name: 'Alice' }, content: 'hi', timestamp: 0 },
});
const image = (media: Record<string, unknown>): Segment => ({ type: 'image', data: { media } } as Segment);
const MODEL: OutboundMediaTrust = { source: 'test:model' };
const refused = (value: unknown) => Array.isArray(value) && value.length === 1
  && (value[0] as Segment).type === 'text' && String((value[0] as Segment).data.text).includes('未发送');

describe('outbound media from untrusted sources (ADR 0056 §2)', () => {
  it('reproduction: a host path or file token in plain content reaches the adapter unchanged', async () => {
    // Plugin code is trusted: what it constructs is delivered as is. Before this policy the Agent's
    // model output took this same path, so `/etc/passwd` reached the OneBot `file` parameter.
    for (const media of [
      { kind: 'path', value: '/etc/passwd' },
      { kind: 'file', value: 'file:///etc/passwd' },
      { kind: 'url', value: 'file:///etc/passwd' },
    ]) {
      expect(await render([image(media)])).toEqual([image(media)]);
    }
  });

  it('refuses host paths, file: URIs and path-like platform refs in untrusted content', async () => {
    for (const media of [
      { kind: 'path', value: '/etc/passwd' },
      { kind: 'path', value: '../../.env' },
      { kind: 'path', value: 'file:///etc/passwd' },
      { kind: 'file', value: '/etc/passwd' },
      { kind: 'file', value: 'file:///etc/passwd' },
      { kind: 'file', value: 'data/bot.db' },
      { kind: 'file', value: '~/.ssh/id_rsa' },
      { kind: 'file', value: 'C:\\Windows\\win.ini' },
      { kind: 'url', value: 'file:///etc/passwd' },
      { kind: 'url', value: 'ftp://example.com/a.png' },
    ]) {
      expect(refused(await render(untrustedContent([image(media)], MODEL)))).toBe(true);
    }
  });

  it('canonicalizes legacy media fields before deciding', async () => {
    const legacy = [{ type: 'image', data: { file: '/etc/passwd' } }, { type: 'record', data: { path: '/etc/passwd' } }];
    const result = await render(untrustedContent(legacy as never, MODEL)) as Segment[];
    expect(result).toHaveLength(2);
    expect(result.every(segment => segment.type === 'text')).toBe(true);
  });

  it('admits remote URLs, bounded inline data and bare platform tokens', async () => {
    const allowed = [
      image({ kind: 'url', value: 'https://cdn.example.com/a.png' }),
      image({ kind: 'url', value: 'data:image/png;base64,iVBORw0KGgo=' }),
      image({ kind: 'base64', value: 'iVBORw0KGgo=' }),
      image({ kind: 'base64', value: 'base64://iVBORw0KGgo=' }),
      image({ kind: 'file', value: 'AgACAgQAAxkBAAIBY2Zh_telegram-file-id' }),
    ];
    expect(await render(untrustedContent(allowed, MODEL))).toEqual(allowed);
  });

  it('caps inline media size', async () => {
    const tooBig = 'A'.repeat(Math.ceil((DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES + 4) * 4 / 3));
    expect(refused(await render(untrustedContent([image({ kind: 'base64', value: tooBig })], MODEL)))).toBe(true);
    expect(refused(await render(untrustedContent([image({ kind: 'base64', value: 'QUJD' })], { ...MODEL, maxInlineBytes: 2 })))).toBe(true);
    expect(refused(await render(untrustedContent([image({ kind: 'base64', value: 'not base64 at all!' })], MODEL)))).toBe(true);
  });

  it('admits a local path only through the sender authorizer, with the canonical path', async () => {
    const authorizePath = vi.fn(async (path: string) => (path === 'chart.png' || path === '/ws/chart.png' ? '/ws/chart.png' : undefined));
    const trust = { ...MODEL, authorizePath };
    const result = await render(untrustedContent([
      image({ kind: 'path', value: 'chart.png' }),
      image({ kind: 'path', value: 'file:///ws/chart.png' }),
      image({ kind: 'path', value: 'secret.png' }),
    ], trust)) as Segment[];
    expect(authorizePath).toHaveBeenCalledWith('/ws/chart.png');
    expect((result[0]!.data as { media: MediaRef }).media).toMatchObject({ kind: 'path', value: '/ws/chart.png' });
    expect((result[1]!.data as { media: MediaRef }).media).toMatchObject({ kind: 'path', value: '/ws/chart.png' });
    expect(result[2]).toMatchObject({ type: 'text' });
  });

  it('keeps media that trusted code constructed (identity, not a copy)', async () => {
    const spooled = trustedMediaRef({ kind: 'path', value: '/tmp/zhin-outbound-media/image-1.png' } as MediaRef);
    const segment = { type: 'image', data: { media: spooled } } as Segment;
    expect(await render(untrustedContent([segment], MODEL))).toEqual([segment]);
    const copy = { type: 'image', data: { media: { ...spooled } } } as Segment;
    expect(refused(await render(untrustedContent([copy], MODEL)))).toBe(true);
  });

  it('refuses host sources nested in other segments (forward nodes, extensions, platform fields)', async () => {
    const nested = [
      { type: 'forward', data: { forward_id: 'f1', messages: [[image({ kind: 'path', value: '/etc/passwd' })]] } },
      { type: 'napcat:node', data: { content: [{ type: 'image', data: { file: 'file:///etc/passwd' } }] } },
      { ...image({ kind: 'url', value: 'https://a.example/x.png' }), platform: { file: '/etc/passwd' } },
    ];
    const result = await render(untrustedContent(nested as never, MODEL)) as Segment[];
    expect(result.map(segment => segment.type)).toEqual(['text', 'text', 'text']);
    const fine = [{ type: 'keyboard', data: { rows: [[{ id: 'a', label: 'Open', payload: 'x', url: 'tg://resolve?domain=x' }]] } }];
    expect(await render(untrustedContent(fine as never, MODEL))).toEqual(fine);
  });

  it('never compiles templates in untrusted text and reduces html to text', async () => {
    expect(await render(untrustedContent(['hi ${sender.name}', { type: 'text', data: { text: '${sender.id}' } }], MODEL)))
      .toEqual(['hi ${sender.name}', { type: 'text', data: { text: '${sender.id}' } }]);
    expect(await render('hi ${sender.name}')).toBe('hi Alice');
    expect(await render(untrustedContent({ type: 'html', data: { html: '<img src="file:///etc/passwd"><p>ok</p>' } }, MODEL)))
      .toEqual([{ type: 'text', data: { text: 'ok' } }]);
  });

  it('localizes the visible notice and never logs the media value', async () => {
    const result = await render(untrustedContent([image({ kind: 'file', value: '/root/secret-name.txt' })], { ...MODEL, locale: 'en' }));
    expect(result).toEqual([{ type: 'text', data: { text: '[image not sent: media source not allowed]' } }]);
  });

  it('classifies platform tokens', () => {
    expect(isPlatformFileToken('abc.image')).toBe(true);
    for (const value of ['', ' x', '/a', 'a/b', 'a\\b', 'file:x', 'C:x', '~x', '.x', '..']) expect(isPlatformFileToken(value)).toBe(false);
  });

  it('decides a single ref without an authorizer', async () => {
    expect(await checkUntrustedMediaRef({ kind: 'path', value: 'a.png' }, MODEL)).toEqual({ allowed: false, reason: 'host_path' });
    expect(await checkUntrustedMediaRef({ kind: 'url', value: 'javascript:alert(1)' }, MODEL)).toEqual({ allowed: false, reason: 'url_scheme' });
  });
});
