import { describe, expect, it, vi } from 'vitest';
import type { HtmlRendererHost, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  applyOutboundInteractivePolicy,
  normalizeOutboundPayload,
  resolveOutboundInteractivePolicy,
  resolveOutboundMediaPolicy,
  type OutboundMediaPolicy,
} from '../../src/plugin-runtime/im/outbound-segments.js';

function mockRenderer(result?: Partial<Awaited<ReturnType<HtmlRendererHost['render']>>>): HtmlRendererHost {
  return {
    async render(html, options) {
      return {
        data: Buffer.from(`png:${html}:${options?.width ?? 0}`),
        format: 'png',
        width: options?.width ?? 800,
        height: 200,
        mimeType: 'image/png',
        ...result,
      };
    },
  };
}

function mockSnapshot(input: {
  readonly packageName?: string;
  readonly definition?: unknown;
}): RuntimeSnapshot {
  const slot = {
    id: 'adapter:test',
    owner: 'plugin:adapter',
    feature: 'feature:adapter',
    localName: 'default',
    source: 'test',
    definition: input.definition ?? {},
  };
  return {
    capabilities: new Map([['adapter:test', slot]]),
    tree: new Map([['plugin:adapter', { packageName: input.packageName }]]),
  } as unknown as RuntimeSnapshot;
}

describe('normalizeOutboundPayload', () => {
  it('wraps a single segment object into a one-element array', async () => {
    const segment = { type: 'text', data: { text: 'hi' } };
    expect(await normalizeOutboundPayload(segment)).toEqual([segment]);
  });

  it('renders html segments to canonical image segments when a renderer is available', async () => {
    const base64 = Buffer.from('png:<b>hi</b>:400').toString('base64');
    const payload = await normalizeOutboundPayload(
      { type: 'html', data: { html: '<b>hi</b>', width: 400, fileName: 'zt.png' } },
      mockRenderer(),
      { mediaPolicy: 'base64' },
    );
    expect(payload).toEqual([{
      type: 'image',
      data: {
        media: { kind: 'base64', value: base64, mime_type: 'image/png', file_name: 'zt.png' },
      },
    }]);
  });

  it('renders html segments inside arrays, canonicalizing other elements', async () => {
    const base64 = Buffer.from('png:<i>x</i>:540').toString('base64');
    const payload = await normalizeOutboundPayload(
      [
        'plain',
        { type: 'at', data: { qq: '2' } },
        { type: 'html', data: { html: '<i>x</i>' } },
      ],
      mockRenderer(),
      { mediaPolicy: 'base64' },
    );
    expect(payload).toEqual([
      { type: 'text', data: { text: 'plain' } },
      { type: 'mention', data: { target: '2' } },
      {
        type: 'image',
        data: {
          media: { kind: 'base64', value: base64, mime_type: 'image/png', file_name: 'card.png' },
        },
      },
    ]);
  });

  it('falls back to the segment text when no renderer is available', async () => {
    const payload = await normalizeOutboundPayload({
      type: 'html',
      data: { html: '<b>hi</b>', text: 'fallback-text' },
    });
    expect(payload).toEqual([{ type: 'text', data: { text: 'fallback-text' } }]);
  });

  it('derives fallback text from html when no renderer is available', async () => {
    const payload = await normalizeOutboundPayload({
      type: 'html',
      data: { html: '<h1>Title</h1><p>body<br>line</p>' },
    });
    expect(payload).toEqual([{ type: 'text', data: { text: '# Title\n\n body\nline' } }]);
  });

  it('falls back to text when rendering throws', async () => {
    const renderer: HtmlRendererHost = {
      async render() { throw new Error('render failed'); },
    };
    const payload = await normalizeOutboundPayload(
      { type: 'html', data: { html: '<b>hi</b>', text: 'oops' } },
      renderer,
    );
    expect(payload).toEqual([{ type: 'text', data: { text: 'oops' } }]);
  });

  it('falls back to text when the render result is not a png buffer', async () => {
    const payload = await normalizeOutboundPayload(
      { type: 'html', data: { html: '<b>hi</b>' } },
      mockRenderer({ data: '<svg/>', format: 'svg', mimeType: 'image/svg+xml' }),
    );
    expect(payload).toEqual([{ type: 'text', data: { text: 'hi' } }]);
  });

  it('passes non-segment payloads through untouched', async () => {
    expect(await normalizeOutboundPayload('hello')).toBe('hello');
    expect(await normalizeOutboundPayload({ text: 'legacy', hooked: true }))
      .toEqual({ text: 'legacy', hooked: true });
    expect(await normalizeOutboundPayload(null)).toBeNull();
  });
});

describe('normalizeOutboundPayload canonical 归一矩阵', () => {
  // url-or-text 会对 base64/path 媒体做文本降级，归一形状见「媒体协商降级」专项。
  const policies: Array<OutboundMediaPolicy | undefined> = [
    'base64',
    'passthrough',
  ];

  it('缺省 policy 为 url-or-text（未声明 adapter 的保守兜底）', async () => {
    const payload = await normalizeOutboundPayload([
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/local.png' }, alt: '本地图' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' } } },
    ]);
    expect(payload).toEqual([
      { type: 'text', data: { text: '本地图' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' } } },
    ]);
  });

  it.each(policies)('canonical 媒体段原样归一（policy=%s）', async (mediaPolicy) => {
    const payload = await normalizeOutboundPayload(
      [
        { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' } } },
        { type: 'image', data: { media: { kind: 'path', value: '/tmp/local.png' } } },
        { type: 'reply', data: { id: 'm-1' } },
        { type: 'at', data: { id: '42', name: 'Ada' } },
      ],
      undefined,
      { mediaPolicy },
    );
    expect(payload).toEqual([
      {
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' } },
      },
      {
        type: 'image',
        data: { media: { kind: 'path', value: '/tmp/local.png' } },
      },
      { type: 'reply', data: { message_id: 'm-1' } },
      { type: 'mention', data: { target: '42', name: 'Ada' } },
    ]);
  });

  it('legacy wire 媒体字段在核心边界归一为 canonical MediaRef', async () => {
    const payload = await normalizeOutboundPayload(
      [
        { type: 'image', data: { url: 'https://cdn.example.com/a.png' } },
        { type: 'image', data: { file: '/tmp/local.png' } },
      ],
      undefined,
      { mediaPolicy: 'base64' },
    );
    expect(payload).toEqual([
      {
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' } },
      },
      {
        type: 'image',
        data: { media: { kind: 'path', value: '/tmp/local.png' } },
      },
    ]);
  });

  // 仅含 URL 媒体的输入在全部 policy 下归一形状一致（含 url-or-text）。
  const allPolicies: Array<OutboundMediaPolicy | undefined> = [...policies, 'url-or-text'];

  it.each(allPolicies)('单段对象同样归一（policy=%s）', async (mediaPolicy) => {
    const payload = await normalizeOutboundPayload(
      { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' }, alt: 'cover' } },
      undefined,
      { mediaPolicy },
    );
    expect(payload).toEqual([{
      type: 'image',
      data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' }, alt: 'cover' },
    }]);
  });

  it.each(allPolicies)('已是 canonical 的段保持不变（policy=%s）', async (mediaPolicy) => {
    const canonical = [
      { type: 'text', data: { text: 'hi' } },
      { type: 'mention', data: { target: 'all' } },
      {
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example.com/b.png' } },
      },
    ];
    expect(await normalizeOutboundPayload(canonical, undefined, { mediaPolicy }))
      .toEqual(canonical);
  });
});

describe('normalizeOutboundPayload 媒体协商降级', () => {
  it('url-or-text：base64 image 段降级为文本（alt 优先）', async () => {
    const payload = await normalizeOutboundPayload(
      [{ type: 'image', data: { media: { kind: 'base64', value: 'QUJD' }, alt: '截图' } }],
      undefined,
      { mediaPolicy: 'url-or-text' },
    );
    expect(payload).toEqual([{ type: 'text', data: { text: '截图' } }]);
  });

  it('url-or-text：base64 image 段无 alt 时降级为占位文本', async () => {
    const payload = await normalizeOutboundPayload(
      [{ type: 'image', data: { media: { kind: 'base64', value: 'QUJD' } } }],
      undefined,
      { mediaPolicy: 'url-or-text' },
    );
    expect(payload).toEqual([{ type: 'text', data: { text: '[image]' } }]);
  });

  it('url-or-text：本地路径 image 段同样降级，URL image 段保留', async () => {
    const payload = await normalizeOutboundPayload(
      [
        { type: 'image', data: { media: { kind: 'path', value: '/tmp/local.png' }, alt: '本地图' } },
        { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' } } },
      ],
      undefined,
      { mediaPolicy: 'url-or-text' },
    );
    expect(payload).toEqual([
      { type: 'text', data: { text: '本地图' } },
      {
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' } },
      },
    ]);
  });

  it('base64 / passthrough：base64 image 段原样直发', async () => {
    for (const mediaPolicy of ['base64', 'passthrough'] as const) {
      const payload = await normalizeOutboundPayload(
        [{ type: 'image', data: { media: { kind: 'base64', value: 'QUJD' } } }],
        undefined,
        { mediaPolicy },
      );
      expect(payload).toEqual([{
        type: 'image',
        data: { media: { kind: 'base64', value: 'QUJD' } },
      }]);
    }
  });

  it('url-or-text：html 段跳过渲染直接文本降级', async () => {
    const render = vi.fn();
    const renderer: HtmlRendererHost = { render };
    const payload = await normalizeOutboundPayload(
      { type: 'html', data: { html: '<b>hi</b>', text: 'card-fallback' } },
      renderer,
      { mediaPolicy: 'url-or-text' },
    );
    expect(render).not.toHaveBeenCalled();
    expect(payload).toEqual([{ type: 'text', data: { text: 'card-fallback' } }]);
  });

  it('passthrough：html 段照常渲染为 base64 图片', async () => {
    const base64 = Buffer.from('png:<b>hi</b>:540').toString('base64');
    const payload = await normalizeOutboundPayload(
      { type: 'html', data: { html: '<b>hi</b>' } },
      mockRenderer(),
      { mediaPolicy: 'passthrough' },
    );
    expect(payload).toEqual([{
      type: 'image',
      data: {
        media: { kind: 'base64', value: base64, mime_type: 'image/png', file_name: 'card.png' },
      },
    }]);
  });
});

describe('resolveOutboundMediaPolicy', () => {
  it('adapter definition 声明的 segments.outboundMedia 数组映射投递策略', () => {
    const withMedia = (outboundMedia: readonly string[]) => mockSnapshot({
      definition: { segments: { outboundMedia } },
    });
    const resolve = (forms: readonly string[]) =>
      resolveOutboundMediaPolicy('adapter:test' as never, withMedia(forms));
    expect(resolve(['base64', 'url'])).toBe('base64');
    expect(resolve(['url', 'upload'])).toBe('passthrough');
    expect(resolve(['url', 'path'])).toBe('passthrough');
    expect(resolve(['url'])).toBe('url-or-text');
  });

  it('未声明 / 非法声明一律回退 url-or-text（无内置表）', () => {
    for (const definition of [
      undefined,
      {},
      { segments: {} },
      { segments: { outboundMedia: 'bogus' } },
      { segments: { outboundMedia: [] } },
      { segments: { outboundMedia: ['ftp'] } },
    ]) {
      const snapshot = mockSnapshot({ packageName: '@zhin.js/adapter-qq', definition });
      expect(resolveOutboundMediaPolicy('adapter:test' as never, snapshot)).toBe('url-or-text');
    }
    // 未声明与平台名无关（内置表已删除）
    const unknown = mockSnapshot({ packageName: '@acme/adapter-unknown' });
    expect(resolveOutboundMediaPolicy('adapter:missing' as never, unknown)).toBe('url-or-text');
  });

  it('多 endpoint 展开的 slot~entry id 回退到 slot 声明', () => {
    const snapshot = mockSnapshot({
      definition: { segments: { outboundMedia: ['base64'] } },
    });
    expect(resolveOutboundMediaPolicy('adapter:test~8596' as never, snapshot)).toBe('base64');
    // 无 ~ 的未知 id 不命中 slot，回退 url-or-text
    expect(resolveOutboundMediaPolicy('adapter:missing' as never, snapshot)).toBe('url-or-text');
  });
});


describe('resolveOutboundInteractivePolicy', () => {
  it('adapter definition 声明的 segments.interactive 优先', () => {
    const snapshot = mockSnapshot({
      packageName: '@zhin.js/adapter-telegram',
      definition: { segments: { interactive: 'text' } },
    });
    expect(resolveOutboundInteractivePolicy('adapter:test' as never, snapshot)).toBe('text');
  });

  it('未声明时按平台名查内置表（telegram / discord 原生按钮）', () => {
    for (const packageName of ['@zhin.js/adapter-telegram', '@zhin.js/adapter-discord']) {
      const snapshot = mockSnapshot({ packageName });
      expect(resolveOutboundInteractivePolicy('adapter:test' as never, snapshot)).toBe('native');
    }
  });

  it('非法声明值忽略，未知平台回退 text（旧轨默认）', () => {
    expect(resolveOutboundInteractivePolicy(
      'adapter:test' as never,
      mockSnapshot({
        packageName: '@zhin.js/adapter-telegram',
        definition: { segments: { interactive: 'fancy' } },
      }),
    )).toBe('native');
    expect(resolveOutboundInteractivePolicy(
      'adapter:test' as never,
      mockSnapshot({ packageName: '@acme/adapter-unknown' }),
    )).toBe('text');
  });

  it('多 endpoint 展开的 slot~entry id 回退到 slot 声明', () => {
    const snapshot = mockSnapshot({
      packageName: '@zhin.js/adapter-qq',
      definition: { segments: { interactive: 'native' } },
    });
    expect(resolveOutboundInteractivePolicy('adapter:test~8596' as never, snapshot)).toBe('native');
  });
});

describe('applyOutboundInteractivePolicy', () => {
  const keyboard = {
    type: 'keyboard',
    data: {
      rows: [[
        { id: 'c0', label: '井字棋', payload: 'hub:h1:g_ttt' },
        { id: 'c1', label: '猜数字', payload: 'hub:h1:g_guess' },
      ]],
      fallback: { hint: '回复数字进入对应游戏', map: { '1': 'hub:h1:g_ttt', '2': 'hub:h1:g_guess' } },
    },
  };

  it("'text'：keyboard 降级为编号文本并交出 fallback map", () => {
    const maps: Record<string, string>[] = [];
    const payload = applyOutboundInteractivePolicy(
      [{ type: 'text', data: { text: '🎮 游戏大厅' } }, keyboard],
      'text',
      (map) => maps.push(map),
    ) as Array<{ type: string; data: { text?: string } }>;

    expect(payload[0]).toEqual({ type: 'text', data: { text: '🎮 游戏大厅' } });
    expect(payload[1]?.type).toBe('text');
    expect(payload[1]?.data.text).toContain('回复数字进入对应游戏');
    expect(payload[1]?.data.text).toContain('1. 井字棋');
    expect(payload[1]?.data.text).toContain('2. 猜数字');
    expect(maps).toEqual([{ '1': 'hub:h1:g_ttt', '2': 'hub:h1:g_guess' }]);
  });

  it("'text'：无显式 fallback 时按按钮顺序自动编号", () => {
    const maps: Record<string, string>[] = [];
    const payload = applyOutboundInteractivePolicy(
      [{ type: 'keyboard', data: { rows: [[
        { id: 'a', label: '甲', payload: 'x:s:a' },
        { id: 'b', label: '乙', payload: 'x:s:b' },
      ]] } }],
      'text',
      (map) => maps.push(map),
    ) as Array<{ type: string; data: { text?: string } }>;

    expect(payload[0]?.data.text).toContain('1. 甲');
    expect(payload[0]?.data.text).toContain('2. 乙');
    expect(maps).toEqual([{ '1': 'x:s:a', '2': 'x:s:b' }]);
  });

  it("'native'：keyboard 透传，不触发 remember", () => {
    const remember = vi.fn();
    const input = [keyboard];
    expect(applyOutboundInteractivePolicy(input, 'native', remember)).toBe(input);
    expect(remember).not.toHaveBeenCalled();
  });

  it('非数组 payload 原样透传', () => {
    expect(applyOutboundInteractivePolicy('plain', 'text')).toBe('plain');
    expect(applyOutboundInteractivePolicy(null, 'text')).toBeNull();
  });
});
