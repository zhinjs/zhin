import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WEB_SEARCH_MARKET,
  WEB_SEARCH_LOCALE_EXTRA_KEY,
  acceptLanguageForMarket,
  normalizeWebSearchLocaleHint,
  resolveWebSearchMarketFromContext,
} from '../../src/builtin/web-search-locale.js';
import type { ToolContext } from '@zhin.js/core';

describe('normalizeWebSearchLocaleHint', () => {
  it('默认空串回退中文', () => {
    expect(normalizeWebSearchLocaleHint('')).toBe(DEFAULT_WEB_SEARCH_MARKET);
    expect(normalizeWebSearchLocaleHint('   ')).toBe(DEFAULT_WEB_SEARCH_MARKET);
  });

  it('常见别名', () => {
    expect(normalizeWebSearchLocaleHint('英文')).toBe('en-US');
    expect(normalizeWebSearchLocaleHint('中文')).toBe('zh-CN');
    expect(normalizeWebSearchLocaleHint('en')).toBe('en-US');
    expect(normalizeWebSearchLocaleHint('zh')).toBe('zh-CN');
  });

  it('合法 BCP47 形式保留大小写规范', () => {
    expect(normalizeWebSearchLocaleHint('de-de')).toBe('de-DE');
  });
});

describe('acceptLanguageForMarket', () => {
  it('含主语言回退权重', () => {
    expect(acceptLanguageForMarket('zh-CN')).toContain('zh-CN');
    expect(acceptLanguageForMarket('zh-CN')).toContain('zh;');
  });
});

describe('resolveWebSearchMarketFromContext', () => {
  it('无 extra 时默认中文', () => {
    expect(resolveWebSearchMarketFromContext(undefined)).toBe('zh-CN');
    expect(resolveWebSearchMarketFromContext({} as ToolContext)).toBe('zh-CN');
  });

  it('extra.web_search_locale 优先', () => {
    const ctx = {
      extra: { [WEB_SEARCH_LOCALE_EXTRA_KEY]: 'ja' },
    } as ToolContext;
    expect(resolveWebSearchMarketFromContext(ctx)).toBe('ja-JP');
  });
});
