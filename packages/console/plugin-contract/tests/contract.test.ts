import { describe, expect, it } from 'vitest';
import {
  definePage,
  normalizePageMetadata,
  pageRoute,
  type ConsoleTopologyResponse,
} from '../src/index.js';

describe('Console contract', () => {
  it('normalizes author metadata without adding route authority', () => {
    expect(definePage({ title: 'Status', requiredRoles: ['admin', 'admin'] })).toEqual({
      title: 'Status',
      icon: undefined,
      order: undefined,
      hideInNav: undefined,
      requiredPermissions: [],
      requiredRoles: ['admin'],
    });
    expect(normalizePageMetadata('service-status', undefined)).toMatchObject({
      title: 'Service Status',
      order: 100,
      hideInNav: false,
    });
  });

  it('preserves explicit titles without translating keys, routes or fallback titles', () => {
    const translations = { en: 'Try a conversation', 'zh-CN': '试聊一下' };
    const result = definePage({ title: 'Sandbox', titleI18n: translations });
    expect(result.title).toBe('Sandbox');
    expect(result.titleI18n).toEqual(translations);
    expect(Object.isFrozen(result.titleI18n)).toBe(true);
    translations.en = 'Changed outside';
    expect(result.titleI18n?.en).toBe('Try a conversation');
    expect(normalizePageMetadata('sandbox', { title: 'Original' })).not.toHaveProperty('titleI18n');
    for (const value of [null, [], 'English', { en: '' }, { en: 2 }, { en: undefined }, { fr: 'Français' }]) {
      expect(() => definePage({ titleI18n: value } as never)).toThrow();
    }
  });

  it('derives routes only from Root-relative ownership', () => {
    expect(pageRoute('root', 'root', 'home')).toBe('/p-home');
    expect(pageRoute('root/a/b', 'root', 'status')).toBe('/a/b/p-status');
    expect(() => pageRoute('other/a', 'root', 'status')).toThrow('outside Root');
  });

  it('maps pages/index to the plugin path (no p- leaf)', () => {
    expect(pageRoute('root', 'root', 'index')).toBe('/');
    expect(pageRoute('root/sandbox', 'root', 'index')).toBe('/sandbox');
    expect(pageRoute('root/a/b', 'root', 'index')).toBe('/a/b');
  });

  it('rejects metadata that would otherwise be silently ignored', () => {
    expect(() => definePage({ route: '/custom' } as never)).toThrow('Unknown Page metadata: route');
  });

  it('keeps route layouts in the topology response contract', () => {
    const response = {
      generation: 7,
      pages: [],
      navigation: [],
      route: '/a/p-status',
      resolution: {
        status: 'found',
        page: {
          id: 'page', owner: 'root/a', localName: 'status', source: '/a/pages/status.tsx',
          module: '/assets/status.js', hash: 'status', route: '/a/p-status', title: 'Status',
          order: 10, hideInNav: false, requiredPermissions: [], requiredRoles: [],
        },
        layouts: {
          nav: { id: 'nav', owner: 'root/a', slot: 'nav', source: '/a/pages/nav/index.tsx', module: '/assets/a-nav.js', hash: 'nav' },
          footer: { id: 'footer', owner: 'root', slot: 'footer', source: '/pages/footer/index.tsx', module: '/assets/footer.js', hash: 'footer' },
        },
      },
    } satisfies ConsoleTopologyResponse;
    expect(response.resolution?.status).toBe('found');
  });
});
