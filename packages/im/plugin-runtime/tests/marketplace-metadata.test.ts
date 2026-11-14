import { describe, expect, it } from 'vitest';
import {
  PLUGIN_CATEGORIES,
  PLUGIN_CATEGORY_LABELS,
  informativeKeywords,
  normalizePluginCategory,
  packageAuthorName,
  pickLocalizedText,
  readPluginMarketplaceMetadata,
} from '../src/marketplace-metadata.js';

describe('plugin marketplace metadata', () => {
  it('labels every category in both locales', () => {
    for (const category of PLUGIN_CATEGORIES) {
      expect(PLUGIN_CATEGORY_LABELS[category]['zh-CN']).toBeTruthy();
      expect(PLUGIN_CATEGORY_LABELS[category].en).toBeTruthy();
    }
  });

  it('maps legacy registry categories and rejects unknown ones', () => {
    expect(normalizePluginCategory('game')).toBe('game');
    expect(normalizePluginCategory('util')).toBe('utility');
    expect(normalizePluginCategory('feature')).toBe('utility');
    expect(normalizePluginCategory('nope')).toBeUndefined();
    expect(normalizePluginCategory(3)).toBeUndefined();
  });

  it('drops generic keywords and duplicates', () => {
    expect(informativeKeywords(['zhin', 'zhin.js', 'Bot', 'chatbot', 'plugin', 'rss', 'RSS', ' atom ', 3, ''])).toEqual(['rss', 'atom']);
    expect(informativeKeywords(undefined)).toEqual([]);
  });

  it('names the author or maintainers, never a publisher', () => {
    expect(packageAuthorName({ author: { name: 'lc-cn', url: 'https://github.com/zhinjs/zhin' } })).toBe('lc-cn');
    expect(packageAuthorName({ author: 'Jane Doe <jane@example.com> (https://example.com)' })).toBe('Jane Doe');
    expect(packageAuthorName({ maintainers: [{ name: 'a' }, { name: 'b' }, { name: 'a' }] })).toBe('a, b');
    expect(packageAuthorName({ _npmUser: { name: 'GitHub Actions' }, publisher: { username: 'GitHub Actions' } } as never)).toBeUndefined();
  });

  it('reads published metadata leniently and picks a locale with fallbacks', () => {
    const metadata = readPluginMarketplaceMetadata({
      metadata: {
        displayName: 'RSS',
        displayNameI18n: { 'zh-CN': 'RSS 订阅', en: 'RSS Feeds', ja: 'x' },
        descriptionI18n: { 'zh-CN': '', en: 'Feed push' },
        category: 'information',
      },
    });
    expect(metadata).toEqual({
      displayName: 'RSS',
      displayNameI18n: { 'zh-CN': 'RSS 订阅', en: 'RSS Feeds' },
      descriptionI18n: { en: 'Feed push' },
      category: 'information',
    });
    expect(readPluginMarketplaceMetadata({ metadata: { category: 'fun' } })).toEqual({});
    expect(readPluginMarketplaceMetadata(null)).toEqual({});
    expect(pickLocalizedText(metadata.descriptionI18n, 'zh-CN', 'raw')).toBe('Feed push');
    expect(pickLocalizedText(undefined, 'en', 'raw')).toBe('raw');
    expect(pickLocalizedText({ 'zh-CN': '中文' }, 'en')).toBe('中文');
  });
});
