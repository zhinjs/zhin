import { describe, expect, it, vi } from 'vitest';
import { parseMiddlewareDefinition } from '@zhin.js/middleware';
import plugin from '../plugin.ts';
import middleware from '../middlewares/link-poster/index.ts';
import { renderPoster } from '../src/render.js';
import type { LinkMeta } from '../src/types.js';

describe('@zhin.js/plugin-link-poster', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('link-poster');
  });

  it('brands inbound middleware', () => {
    expect(parseMiddlewareDefinition(middleware)).toBe(middleware);
  });

  it('renders poster html for github meta', () => {
    const meta: LinkMeta = {
      platform: 'github',
      title: 'zhinjs/zhin',
      description: 'chatbot framework',
      url: 'https://github.com/zhinjs/zhin',
    };
    const html = renderPoster(meta);
    expect(html).toContain('zhinjs/zhin');
    expect(html).toContain('GitHub');
  });
});

it.each([['en', 'Views', '12K'], ['zh-CN', '播放', '1.2万']] as const)(
  'captures %s before async parsing and localizes only generated poster labels', async (locale, label, count) => {
    const input: { locale: 'en' | 'zh-CN'; content: string; $reply: ReturnType<typeof vi.fn> } = { locale, content: 'https://www.bilibili.com/video/BVfixture', $reply: vi.fn() };
    vi.stubGlobal('fetch', vi.fn(async () => {
      // An in-flight operation must not change language with a later preference.
      input.locale = locale === 'en' ? 'zh-CN' : 'en';
      return { json: async () => ({ code: 0, data: { title: '用户标题', desc: '第三方简介', owner: { name: '原作者' }, stat: { view: 12000, danmaku: 100000000, like: 7 } } }) };
    }));
    const render = vi.fn(async (_html: string) => ({ format: 'png', data: Buffer.from('fixture'), mimeType: 'image/png' }));
    const next = vi.fn();
    try {
      await middleware.handle({ input, use: () => ({ render }) } as never, next);
      expect(render).toHaveBeenCalledOnce();
      const html = render.mock.calls[0]![0];
      expect(html).toContain(label);
      expect(html).toContain(count);
      expect(html).toContain('用户标题');
      expect(html).toContain('第三方简介');
      expect(html).toContain('原作者');
      expect(input.$reply).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
it('keeps custom author text while translating generated platform names', () => {
  for (const platform of ['douyin', 'xiaohongshu'] as const) {
    const html = renderPoster({ platform, title: '用户标题', description: '', author: '原作者', url: 'https://example.com' }, 'en');
    expect(html).toContain(platform === 'douyin' ? 'Douyin' : 'Xiaohongshu');
    expect(html).toContain('原作者');
  }
});

describe('link host allow-list', () => {
  it('accepts supported platforms and their subdomains', async () => {
    const { isSupportedLinkHost } = await import('../src/platforms.js');
    expect(isSupportedLinkHost('https://github.com/zhinjs/zhin')).toBe(true);
    expect(isSupportedLinkHost('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    expect(isSupportedLinkHost('https://v.douyin.com/abc/')).toBe(true);
  });

  it('rejects URLs that only mention a platform in the path or query', async () => {
    const { detectAndParse, isSupportedLinkHost } = await import('../src/platforms.js');
    expect(isSupportedLinkHost('http://10.0.0.5:8080/x?v.douyin.com/')).toBe(false);
    expect(isSupportedLinkHost('http://127.0.0.1/github.com/a/b')).toBe(false);
    expect(isSupportedLinkHost('https://evilgithub.com/a/b')).toBe(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      expect(await detectAndParse('see http://10.0.0.5:8080/x?v.douyin.com/')).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('redirect and image host checks', () => {
  it('does not follow a redirect from a supported host to an internal one', async () => {
    const { detectAndParse } = await import('../src/platforms.js');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    );
    try {
      await expect(detectAndParse('https://b23.tv/abc')).rejects.toThrow(/allow-list/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://b23.tv/abc');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('only fetches cover images from public https hosts', async () => {
    const { isPublicImageUrl } = await import('../src/platforms.js');
    expect(isPublicImageUrl('https://i0.hdslb.com/bfs/archive/x.jpg')).toBe(true);
    expect(isPublicImageUrl('http://i0.hdslb.com/x.jpg')).toBe(false);
    expect(isPublicImageUrl('https://10.0.0.5/x.png')).toBe(false);
    expect(isPublicImageUrl('https://[::1]/x.png')).toBe(false);
    expect(isPublicImageUrl('https://localhost/x.png')).toBe(false);
    expect(isPublicImageUrl('https://metadata.google.internal/x.png')).toBe(false);
    expect(isPublicImageUrl('https://intranet/x.png')).toBe(false);
  });
});

describe('image size cap', () => {
  it('drops a cover image larger than the cap instead of buffering it', async () => {
    const { detectAndParse } = await import('../src/platforms.js');
    const huge = new Uint8Array(6 * 1024 * 1024);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify({ full_name: 'zhinjs/zhin', owner: { avatar_url: 'https://avatars.example.com/a.png' } }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(huge, { headers: { 'content-type': 'image/png' } });
    });
    try {
      const meta = await detectAndParse('https://github.com/zhinjs/zhin');
      expect(meta).not.toBeNull();
      expect(meta!.authorAvatar).toBeUndefined();
      expect(meta!.cover).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
