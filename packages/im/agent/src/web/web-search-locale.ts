/** 无用户设置时的 Bing setmkt / 界面语言 */
export const DEFAULT_WEB_SEARCH_MARKET = 'zh-CN';

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
