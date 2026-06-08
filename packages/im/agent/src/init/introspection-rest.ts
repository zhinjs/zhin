/**
 * Host REST 内省 API 数据层（供 @zhin.js/host-api 注册路由）
 */
import type { Plugin } from '@zhin.js/core';
import {
  INTROSPECTION_PAGE_SIZES,
  parseIntrospectionQuery,
  type IntrospectionCommandKind,
} from './introspection-args.js';
import { filterByFields, paginateItems } from './introspection-pagination.js';
import {
  collectIntrospectionBindings,
  collectIntrospectionBots,
  collectIntrospectionCommands,
  collectIntrospectionMcpWithConfigFallback,
  collectIntrospectionTools,
} from './introspection-collectors.js';
import type {
  AgentRow,
  BotRow,
  CommandRow,
  McpServerRow,
  ToolRow,
} from './introspection-commands-format.js';

export interface IntrospectionJsonResponse<T> {
  success: boolean;
  data: {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    filter?: string;
    note?: string;
  };
  error?: string;
}

function ok<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
  totalPages: number,
  filter?: string,
  note?: string,
): IntrospectionJsonResponse<T> {
  return {
    success: true,
    data: {
      items,
      page,
      pageSize,
      total,
      totalPages,
      filter,
      note,
    },
  };
}

function err<T>(message: string): IntrospectionJsonResponse<T> {
  return { success: false, data: { items: [], page: 1, pageSize: 0, total: 0, totalPages: 0 }, error: message };
}

function sliceResponse<T>(
  kind: IntrospectionCommandKind,
  all: T[],
  query: Record<string, string | undefined>,
): IntrospectionJsonResponse<T> {
  const parsed = parseIntrospectionQuery(query);
  const pageSize = parsed.pageSize ?? INTROSPECTION_PAGE_SIZES[kind];
  const slice = paginateItems(all, parsed.page, pageSize);
  return ok(slice.items, slice.page, slice.pageSize, slice.total, slice.totalPages, parsed.filter);
}

export function introspectionRestCommands(
  root: Plugin,
  query: Record<string, string | undefined>,
): IntrospectionJsonResponse<CommandRow> {
  const commandService = root.inject('command');
  if (!commandService) return err('CommandFeature 不可用');
  const parsed = parseIntrospectionQuery(query);
  const all = filterByFields(
    collectIntrospectionCommands(commandService),
    parsed.filter,
    [(c) => c.pattern, (c) => c.desc, (c) => c.plugin],
  );
  return sliceResponse('cmd', all, query);
}

export function introspectionRestBots(
  root: Plugin,
  query: Record<string, string | undefined>,
): IntrospectionJsonResponse<BotRow> {
  const parsed = parseIntrospectionQuery(query);
  const all = filterByFields(
    collectIntrospectionBots(root),
    parsed.filter,
    [(b) => b.adapter, (b) => b.name],
  );
  return sliceResponse('bots', all, query);
}

export function introspectionRestBindings(
  root: Plugin,
  query: Record<string, string | undefined>,
): IntrospectionJsonResponse<AgentRow> {
  const collected = collectIntrospectionBindings(root);
  if ('error' in collected) return err(collected.error);
  const parsed = parseIntrospectionQuery(query);
  const all = filterByFields(
    collected,
    parsed.filter,
    [(a) => a.name, (a) => a.provider, (a) => a.model],
  );
  return sliceResponse('bindings', all, query);
}

export function introspectionRestTools(
  root: Plugin,
  query: Record<string, string | undefined>,
): IntrospectionJsonResponse<ToolRow> {
  const collected = collectIntrospectionTools(root);
  if ('error' in collected) return err(collected.error);
  const parsed = parseIntrospectionQuery(query);
  const all = filterByFields(
    collected,
    parsed.filter,
    [(t) => t.name, (t) => t.source, (t) => t.description],
  );
  return sliceResponse('tools', all, query);
}

export function introspectionRestMcp(
  root: Plugin,
  query: Record<string, string | undefined>,
): IntrospectionJsonResponse<McpServerRow> {
  const { rows, note } = collectIntrospectionMcpWithConfigFallback(root);
  const parsed = parseIntrospectionQuery(query);
  const all = filterByFields(rows, parsed.filter, [(s) => s.name]);
  const resp = sliceResponse('mcp', all, query);
  if (note) resp.data.note = note;
  return resp;
}
