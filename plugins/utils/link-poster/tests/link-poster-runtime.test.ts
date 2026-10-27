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
