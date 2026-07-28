import { describe, expect, it, vi, afterEach } from 'vitest';
import { getAllBuiltinFonts } from '@zhin.js/satori';
import {
  createHtmlRenderer,
  serializeJsxToHtml,
  type FontConfig,
} from '../src/index.js';

const EMOJI_SVG_RESPONSE = {
  ok: true,
  text: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"></svg>',
} as Response;

function makeFont(name: string, style?: FontConfig['style']): FontConfig {
  // 用真实字体数据：fontCache 是模块级共享的，假数据会污染后续渲染
  return { name, data: getAllBuiltinFonts()[0].data, weight: 400, style };
}

describe('@zhin.js/html-renderer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createHtmlRenderer renders simple html to png', async () => {
    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    const result = await renderer.render('<div>Hi</div>', { format: 'png' });
    expect(result.format).toBe('png');
    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect((result.data as Buffer).length).toBeGreaterThan(100);
  });
});

describe('serializeJsxToHtml（renderJsx 注入防护）', () => {
  it('文本节点一律转义', () => {
    expect(serializeJsxToHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(
      serializeJsxToHtml({ type: 'div', props: { children: '<script>alert(1)</script>' } }),
    ).toBe('<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
  });

  it('属性值转义，null/false 属性被丢弃', () => {
    const html = serializeJsxToHtml({
      type: 'img',
      props: { src: 'x" onerror="alert(1)', title: null, hidden: false },
    });
    expect(html).toContain('src="x&quot; onerror=&quot;alert(1)"');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('hidden=');
  });

  it('boolean children 渲染为空串', () => {
    expect(serializeJsxToHtml(true)).toBe('');
    expect(
      serializeJsxToHtml({ type: 'div', props: { children: [true, 'a', false] } }),
    ).toBe('<div>a</div>');
  });

  it('Raw HTML 只走显式通道 dangerouslySetInnerHTML', () => {
    expect(
      serializeJsxToHtml({
        type: 'div',
        props: { dangerouslySetInnerHTML: { __html: '<b>raw</b>' } },
      }),
    ).toBe('<div><b>raw</b></div>');
  });
});

describe('fontCache', () => {
  it('同名同 weight 不同 style 的字体不互相覆盖', () => {
    const renderer = createHtmlRenderer();
    renderer.clearFonts();
    const before = renderer.getFonts().length;
    renderer.registerFont(makeFont('MyFont', 'normal'));
    renderer.registerFont(makeFont('MyFont', 'italic'));
    expect(renderer.getFonts().length).toBe(before + 2);
    renderer.clearFonts();
  });

  it('clearFonts 后 defaultFonts 不丢失', () => {
    const renderer = createHtmlRenderer({ defaultFonts: [makeFont('CfgFont')] });
    expect(renderer.getFonts().some((f) => f.name === 'CfgFont')).toBe(true);
    renderer.clearFonts();
    expect(renderer.getFonts().some((f) => f.name === 'CfgFont')).toBe(true);
    renderer.clearFonts();
  });
});

describe('emoji 加载', () => {
  it('同一 emoji 第二次渲染命中缓存，且请求带超时 signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(EMOJI_SVG_RESPONSE);
    vi.stubGlobal('fetch', fetchMock);

    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    await renderer.render('<div>😀</div>', { format: 'svg' });
    await renderer.render('<div>😀</div>', { format: 'svg' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('加载失败短 TTL 负缓存：TTL 内不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    await renderer.render('<div>😂</div>', { format: 'svg' });
    await renderer.render('<div>😂</div>', { format: 'svg' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enableEmoji: false 时不请求 twemoji', async () => {
    const fetchMock = vi.fn().mockResolvedValue(EMOJI_SVG_RESPONSE);
    vi.stubGlobal('fetch', fetchMock);

    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    await renderer.render('<div>😎</div>', { format: 'svg', enableEmoji: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('渲染并发闸：最多 2 个并发，其余排队', async () => {
    const pending: Array<(r: Response) => void> = [];
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => pending.push(resolve)),
    );
    vi.stubGlobal('fetch', fetchMock);

    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    const renders = ['🚀', '💡', '🔥'].map((emoji) =>
      renderer.render(`<div>${emoji}</div>`, { format: 'svg' }),
    );

    // 等前两个渲染进入 emoji fetch
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // 第三个仍在排队
    expect(pending.length).toBe(2);

    // 放行全部，最终三个渲染都完成
    while (pending.length) pending.shift()!(EMOJI_SVG_RESPONSE);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    while (pending.length) pending.shift()!(EMOJI_SVG_RESPONSE);
    await Promise.all(renders);
  });
});
