/**
 * Bing 搜索结果 HTML 解析（参考 claude-code-best/claude-code WebSearchTool bingAdapter）
 * https://github.com/claude-code-best/claude-code/blob/main/packages/builtin-tools/src/tools/WebSearchTool/adapters/bingAdapter.ts
 */
import he from 'he';
import { acceptLanguageForMarket, DEFAULT_WEB_SEARCH_MARKET } from './web-search-locale.js';

export interface BingSearchResultRow {
  title: string;
  url: string;
  snippet?: string;
}

export const decodeHtmlEntities = (s: string): string => he.decode(s);

/**
 * 从 Bing 结果页 HTML 提取有机结果。
 * 结果位于 <ol id="b_results"> 内 <li class="b_algo"> 块中。
 */
export function extractBingResults(html: string): BingSearchResultRow[] {
  const results: BingSearchResultRow[] = [];
  const algoBlockRegex = /<li\s+class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = algoBlockRegex.exec(html)) !== null) {
    const block = blockMatch[1];
    const h2LinkRegex = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
    const linkMatch = h2LinkRegex.exec(block);
    if (!linkMatch) continue;

    const rawUrl = decodeHtmlEntities(linkMatch[1]);
    const titleHtml = linkMatch[2];
    const url = resolveBingUrl(rawUrl);
    if (!url) continue;

    const title = decodeHtmlEntities(titleHtml.replace(/<[^>]+>/g, '').trim());
    const snippet = extractSnippet(block);
    results.push({ title, url, snippet });
  }

  return results;
}

function extractSnippet(block: string): string | undefined {
  const lineclampRegex = /<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i;
  let match = lineclampRegex.exec(block);
  if (match) {
    return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '').trim());
  }

  const captionPRegex =
    /<div[^>]*class="b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i;
  match = captionPRegex.exec(block);
  if (match) {
    return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '').trim());
  }

  const fallbackRegex = /<div[^>]*class="b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const fallbackMatch = fallbackRegex.exec(block);
  if (fallbackMatch) {
    const text = fallbackMatch[1].replace(/<[^>]+>/g, '').trim();
    if (text) return decodeHtmlEntities(text);
  }

  return undefined;
}

/**
 * 将 Bing 跳转链接解析为真实 URL（/ck/a?...&u=a1aHR0cHM6Ly9...）
 */
export function resolveBingUrl(rawUrl: string): string | undefined {
  if (rawUrl.startsWith('/') || rawUrl.startsWith('#')) return undefined;

  const uMatch = rawUrl.match(/[?&]u=([a-zA-Z0-9+/_=-]+)/);
  if (uMatch) {
    const encoded = uMatch[1];
    if (encoded.length >= 3) {
      const b64 = encoded.slice(2);
      try {
        const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(padded, 'base64').toString('utf-8');
        if (decoded.startsWith('http')) return decoded;
      } catch {
        /* fall through */
      }
    }
  }

  if (!rawUrl.includes('bing.com')) return rawUrl;
  return undefined;
}

/** 与 bingAdapter 一致：浏览器风格请求头（不含 Accept-Language，由 {@link bingSearchFetchHeaders} 按市场注入） */
const BING_SEARCH_BROWSER_HEADERS_BASE = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Ch-Ua': '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
} as const;

/** @deprecated 单测兼容：请用 {@link bingSearchFetchHeaders}；默认语言为 en-US 旧行为已弃用 */
export const BING_SEARCH_BROWSER_HEADERS = {
  ...BING_SEARCH_BROWSER_HEADERS_BASE,
  'Accept-Language': 'en-US,en;q=0.9',
} as const;

export function bingSearchFetchHeaders(market: string): Record<string, string> {
  return {
    ...BING_SEARCH_BROWSER_HEADERS_BASE,
    'Accept-Language': acceptLanguageForMarket(market),
  };
}

export const BING_SEARCH_FETCH_TIMEOUT_MS = 30_000;

export function buildBingSearchUrl(
  query: string,
  market: string = DEFAULT_WEB_SEARCH_MARKET,
): string {
  const mkt = encodeURIComponent(market);
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&setmkt=${mkt}`;
}

export function hostnameMatchesList(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase().replace(/^\.+/, '');
  return h === d || h.endsWith(`.${d}`);
}
