import { describe, expect, it } from 'vitest';
import { parseMiddlewareDefinition } from '@zhin.js/middleware';
import plugin from '../plugin.ts';
import middleware from '../middlewares/link-poster.ts';
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
