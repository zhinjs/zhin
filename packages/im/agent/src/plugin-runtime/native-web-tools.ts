import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import {
  bingSearchFetchHeaders,
  buildBingSearchUrl,
  extractBingResults,
  hostnameMatchesList,
} from '../builtin/bing-search-html.js';
import { DEFAULT_WEB_SEARCH_MARKET } from '../builtin/web-search-locale.js';
import { ZHIN_WEB_USER_AGENT } from '../builtin/web-tool-utils.js';
import {
  NodeNetworkTransport,
  TurnNetworkClient,
  type NetworkTransport,
} from '../security/turn-network-client.js';

export interface NativeWebToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

/** Native generation ToolFeatures backed by the Turn-scoped network module. */
export function createNativeWebToolFeatures(
  transport: NetworkTransport = new NodeNetworkTransport(),
): readonly NativeWebToolFeature[] {
  return Object.freeze([
    feature('web_fetch', defineAgentTool({
      description: 'Fetch public HTTP(S) content through the Turn network policy and return readable text.',
      inputSchema: objectSchema({
        url: { type: 'string', description: 'Absolute HTTP(S) URL' },
        max_length: { type: 'number', description: 'Maximum returned characters' },
      }, ['url']),
      approval: 'on-risk',
      execute: (input, context) => fetchWeb(input, context, transport),
    })),
    feature('web_search', defineAgentTool({
      description: 'Search the public web through the Turn network policy and return titles, URLs, and snippets.',
      inputSchema: objectSchema({
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Result count from 1 to 20' },
        market: { type: 'string', description: 'Bing market such as en-US or zh-CN' },
        allowed_domains: { type: 'array', items: { type: 'string' } },
        blocked_domains: { type: 'array', items: { type: 'string' } },
      }, ['query']),
      approval: 'never',
      execute: (input, context) => searchWeb(input, context, transport),
    })),
  ]);
}

async function fetchWeb(
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  transport: NetworkTransport,
): Promise<string> {
  const url = requiredString(input.url, 'url');
  const maxLength = positiveInteger(input.max_length, 20 * 1024, 200_000);
  const response = await new TurnNetworkClient(context.policy, context.signal, transport).getText(url, {
    headers: { 'User-Agent': ZHIN_WEB_USER_AGENT },
    timeoutMs: 15_000,
    maxRedirects: 5,
    maxBytes: 2 * 1024 * 1024,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const text = htmlToPlainText(response.body);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...(truncated)` : text;
}

async function searchWeb(
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  transport: NetworkTransport,
): Promise<string> {
  const query = requiredString(input.query, 'query');
  const market = typeof input.market === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(input.market)
    ? input.market
    : DEFAULT_WEB_SEARCH_MARKET;
  const limit = positiveInteger(input.limit, 5, 20);
  const response = await new TurnNetworkClient(context.policy, context.signal, transport).getText(
    buildBingSearchUrl(query, market),
    {
      headers: bingSearchFetchHeaders(market),
      timeoutMs: 30_000,
      maxRedirects: 5,
      maxBytes: 2 * 1024 * 1024,
    },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const rows = filterDomains(
    extractBingResults(response.body),
    stringList(input.allowed_domains),
    stringList(input.blocked_domains),
  ).slice(0, limit);
  if (rows.length === 0) return 'No results found.';
  return rows.map((row, index) => [
    `${index + 1}. ${row.title}`,
    `   URL: ${row.url}`,
    ...(row.snippet ? [`   ${row.snippet}`] : []),
  ].join('\n')).join('\n\n');
}

function filterDomains<T extends { readonly url: string }>(
  rows: readonly T[],
  allowed: readonly string[],
  blocked: readonly string[],
): T[] {
  return rows.filter((row) => {
    let hostname: string;
    try { hostname = new URL(row.url).hostname; } catch { return false; }
    if (allowed.length > 0 && !allowed.some((domain) => hostnameMatchesList(hostname, domain))) return false;
    return !blocked.some((domain) => hostnameMatchesList(hostname, domain));
  });
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function feature(
  name: string,
  definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>,
): NativeWebToolFeature {
  return Object.freeze({ feature: toolFeatureId, name, definition });
}

function objectSchema(properties: Record<string, unknown>, required: readonly string[]): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze([...required]) });
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(maximum, Math.floor(value));
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
