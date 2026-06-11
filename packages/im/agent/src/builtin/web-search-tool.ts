/**
 * web_search — Bing HTML 搜索、域名过滤、会话内次数上限
 * （DuckDuckGo HTML 接口已易触发人机验证，故改用 Bing；解析逻辑对齐
 * claude-code bingAdapter）
 */
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import {
  BING_SEARCH_FETCH_TIMEOUT_MS,
  bingSearchFetchHeaders,
  buildBingSearchUrl,
  extractBingResults,
  hostnameMatchesList,
  type BingSearchResultRow,
} from './bing-search-html.js';
import { resolveWebSearchMarketFromContext } from './web-search-locale.js';

export const MAX_WEB_SEARCH_COUNT = 20;

export const WEB_SEARCH_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索关键词或完整查询语句' },
    limit: { type: 'number', description: '返回结果数量（默认 5，建议 1–10）' },
    allowed_domains: {
      type: 'array',
      description: '仅保留这些域名的结果（可选，如 ["github.com", "stackoverflow.com"]）；含子域',
      items: { type: 'string' },
    },
    blocked_domains: {
      type: 'array',
      description: '排除这些域名的结果（可选）；含子域',
      items: { type: 'string' },
    },
  },
  required: ['query'],
};

function filterByDomains(
  rows: BingSearchResultRow[],
  allowedDomains: unknown,
  blockedDomains: unknown,
): BingSearchResultRow[] {
  let filtered = rows;
  if (Array.isArray(allowedDomains) && allowedDomains.length) {
    const allowed = allowedDomains.filter(
      (d): d is string => typeof d === 'string' && d.trim().length > 0,
    );
    filtered = filtered.filter(r => {
      try {
        const hostname = new URL(r.url).hostname;
        return allowed.some(d => hostnameMatchesList(hostname, d));
      } catch {
        return false;
      }
    });
  }
  if (Array.isArray(blockedDomains) && blockedDomains.length) {
    const blocked = blockedDomains.filter(
      (d): d is string => typeof d === 'string' && d.trim().length > 0,
    );
    filtered = filtered.filter(r => {
      try {
        const hostname = new URL(r.url).hostname;
        return !blocked.some(d => hostnameMatchesList(hostname, d));
      } catch {
        return true;
      }
    });
  }
  return filtered;
}

export class WebSearchBuiltinTool extends BuiltinBaseTool {
  readonly name = 'web_search';
  readonly description =
    '在互联网上搜索（Bing），返回匹配的标题、URL 和摘要片段。用于查资料、找网页。支持域名过滤。默认中文结果；用户可在 user_profile 中设置 language 或 preferred_language 覆盖；也可由集成方设置 Message.extra.web_search_locale。';
  readonly parameters = WEB_SEARCH_PARAMETERS;
  readonly kind = 'web';

  private searchCount = 0;

  constructor() {
    super();
    this.tags.push('web', 'search');
    this.keywords.push(
      '搜索',
      '网上搜',
      '网页搜索',
      '搜索引擎',
      'search',
      'google',
      '百度',
      'bing',
      '查询',
      '搜一下',
    );
  }

  async run(args: Record<string, unknown>, _commMessage?: Message): Promise<ToolResult> {
    try {
      this.searchCount++;
      if (this.searchCount > MAX_WEB_SEARCH_COUNT) {
        return `Error: 搜索次数已达上限 (${MAX_WEB_SEARCH_COUNT})。请使用已获取的信息回答。`;
      }

      const limitRaw = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 5;
      const limit = Math.max(1, Math.min(20, limitRaw));
      const query = String(args.query ?? '').trim();
      if (!query) return 'Error: query is required';

      const market = resolveWebSearchMarketFromContext(_commMessage);
      const url = buildBingSearchUrl(query, market);
      const res = await fetch(url, {
        headers: bingSearchFetchHeaders(market),
        redirect: 'follow',
        signal: AbortSignal.timeout(BING_SEARCH_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
      const html = await res.text();

      const rawRows = extractBingResults(html);
      const filtered = filterByDomains(rawRows, args.allowed_domains, args.blocked_domains).slice(0, limit);

      if (filtered.length === 0) {
        if (rawRows.length === 0) {
          return 'No results found.（若页面为人机验证或结构变化，可稍后重试或改用 web_fetch 打开已知 URL）';
        }
        return 'No results found.';
      }

      return (
        `(${this.searchCount}/${MAX_WEB_SEARCH_COUNT} searches)\n` +
        filtered
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet ?? ''}`.trimEnd(),
          )
          .join('\n\n')
      );
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createWebSearchTool(): Tool {
  return new WebSearchBuiltinTool().toTool();
}
