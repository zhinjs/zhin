/**
 * 内省指令位置参数解析：/cmd [filter] [page]
 */
import { segment } from '@zhin.js/core';
import type { Message } from '@zhin.js/core';

export interface IntrospectionArgs {
  filter?: string;
  page: number;
}

export const INTROSPECTION_PAGE_SIZES = {
  cmd: 25,
  tools: 15,
  endpoints: 30,
  bindings: 30,
  mcp: 30,
} as const;

export type IntrospectionCommandKind = keyof typeof INTROSPECTION_PAGE_SIZES;

export function messagePlainText(message: Pick<Message, '$content' | '$raw'>): string {
  if (typeof message.$raw === 'string' && message.$raw.trim()) {
    return message.$raw.trim();
  }
  return segment.toString(message.$content).trim();
}

export function parseIntrospectionArgs(raw: string, commandPrefix: string): IntrospectionArgs {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(commandPrefix)) {
    return { page: 1 };
  }
  const rest = trimmed.slice(commandPrefix.length).trim();
  if (!rest) return { page: 1 };

  const tokens = rest.split(/\s+/);
  let page = 1;
  const last = tokens[tokens.length - 1] ?? '';
  if (/^\d+$/.test(last)) {
    page = Math.max(1, parseInt(last, 10));
    tokens.pop();
  }
  const filter = tokens.length > 0 ? tokens.join(' ') : undefined;
  return { filter, page };
}

export function parseIntrospectionArgsFromMessage(
  message: Pick<Message, '$content' | '$raw'>,
  commandPrefix: string,
): IntrospectionArgs {
  return parseIntrospectionArgs(messagePlainText(message), commandPrefix);
}

export function parseIntrospectionQuery(query: Record<string, string | undefined>): IntrospectionArgs & { pageSize?: number } {
  const filter = typeof query.filter === 'string' && query.filter.trim() ? query.filter.trim() : undefined;
  const pageRaw = query.page;
  const page = pageRaw && /^\d+$/.test(pageRaw) ? Math.max(1, parseInt(pageRaw, 10)) : 1;
  const pageSizeRaw = query.pageSize;
  const pageSize = pageSizeRaw && /^\d+$/.test(pageSizeRaw)
    ? Math.max(1, parseInt(pageSizeRaw, 10))
    : undefined;
  return { filter, page, pageSize };
}

/** 内省命令多 pattern 注册（较长 pattern 优先） */
export function introspectionCommandPatterns(base: string): string[] {
  return [
    `${base} <filter:word> <page:int>`,
    `${base} <page:int>`,
    `${base} <filter:word>`,
    base,
  ];
}

export function resolvePublicApiOrigin(config: { http?: { host?: string; port?: number; base?: string } } | undefined): {
  origin: string;
  apiBase: string;
} {
  const host = config?.http?.host ?? '0.0.0.0';
  const port = config?.http?.port ?? 8086;
  const apiPath = config?.http?.base ?? '/api';
  const publicHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const origin = `http://${publicHost}:${port}`;
  const apiBase = `${origin}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  return { origin, apiBase };
}

export const REMOTE_CONSOLE_ORIGIN = 'https://console.zhin.dev';

export function buildConsoleDeepLink(origin: string): string {
  return `${REMOTE_CONSOLE_ORIGIN}/?apiBaseUrl=${encodeURIComponent(origin)}`;
}
