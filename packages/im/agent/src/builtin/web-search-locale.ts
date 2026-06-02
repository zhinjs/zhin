/**
 * web_search 的 Bing 市场/语言：优先 ToolContext.extra，其次用户档案，默认中文。
 */
import type { ToolContext } from '@zhin.js/core';

/** 写入 ToolContext.extra 的键（集成方也可直接设置以覆盖档案） */
export const WEB_SEARCH_LOCALE_EXTRA_KEY = 'web_search_locale' as const;

/** 无用户设置时的 Bing setmkt / 界面语言 */
export const DEFAULT_WEB_SEARCH_MARKET = 'zh-CN';

/**
 * 将 user_profile 中的自然语言或简写规范为 `xx-YY`（Bing setmkt 常用形式）。
 */
export function normalizeWebSearchLocaleHint(raw: string): string {
  const s = raw.trim().replace(/_/g, '-');
  if (!s) return DEFAULT_WEB_SEARCH_MARKET;

  const lower = s.toLowerCase();
  const aliases: Record<string, string> = {
    中文: 'zh-CN',
    简体: 'zh-CN',
    简体中文: 'zh-CN',
    繁体: 'zh-TW',
    繁中: 'zh-TW',
    繁體中文: 'zh-TW',
    english: 'en-US',
    英文: 'en-US',
    英語: 'en-US',
    ja: 'ja-JP',
    日语: 'ja-JP',
    日本語: 'ja-JP',
    ko: 'ko-KR',
    韩语: 'ko-KR',
    한국어: 'ko-KR',
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    zh: 'zh-CN',
    en: 'en-US',
  };
  if (aliases[lower]) return aliases[lower];

  if (/^[a-z]{2}-[a-z]{2}$/i.test(s)) {
    const [a, b] = s.split('-');
    return `${a.toLowerCase()}-${b.toUpperCase()}`;
  }
  if (/^[a-z]{2}$/i.test(s)) {
    const two = lower;
    const byTwo: Record<string, string> = {
      zh: 'zh-CN',
      en: 'en-US',
      ja: 'ja-JP',
      ko: 'ko-KR',
      de: 'de-DE',
      fr: 'fr-FR',
      es: 'es-ES',
    };
    return byTwo[two] ?? `${two}-${two.toUpperCase()}`;
  }

  return DEFAULT_WEB_SEARCH_MARKET;
}

/** 随 Bing 市场生成 Accept-Language，与 setmkt 一致 */
export function acceptLanguageForMarket(market: string): string {
  const m = market.trim();
  const parts = m.split('-');
  if (parts.length >= 2) {
    const lang = parts[0].toLowerCase();
    return `${m},${lang};q=0.9,en;q=0.8`;
  }
  return `${m},${m};q=0.9,en;q=0.8`;
}

export function resolveWebSearchMarketFromContext(context?: ToolContext): string {
  const raw = context?.extra?.[WEB_SEARCH_LOCALE_EXTRA_KEY];
  if (typeof raw === 'string' && raw.trim()) {
    return normalizeWebSearchLocaleHint(raw);
  }
  return DEFAULT_WEB_SEARCH_MARKET;
}
