import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { pluginRpc, PluginRpcError } from '../console-utils/remoteApi.js';
import { CommentReviewSession } from '../review-console/CommentReviewPage.js';
import {
  Badge,
  Button,
  Checkbox,
  CheckboxGroup,
  Collapsible,
  ConfirmButton,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  JsonView,
  LoadingState,
  Notice,
  PageHeader,
  PluginPage,
  ProgressBar,
  RadioGroup,
  Section,
  SegmentedControl,
  Select,
  Sparkline,
  StaleNotice,
  Switch,
  Tabs,
  Textarea,
  Timeline,
  type BadgeTone,
  type ButtonVariant,
} from './components.js';
import { useLocale, type PluginUiLocale, type PluginUiText } from './locale.js';
import { resolveSyncPluginId } from './plugin-id.js';
import { usePluginRpc, type RpcResource } from './rpc.js';
import { pluginUiStyles } from './styles.js';

export type DeclarativeI18nText = string | { readonly zh: string; readonly en?: string; readonly 'zh-CN'?: string };

export type DeclarativeValueExpr =
  | { readonly $path: string; readonly fallback?: string | number | boolean }
  | { readonly $count: string }
  | { readonly $sum: { readonly path: string; readonly field: string } }
  | { readonly $format: DeclarativeI18nText; readonly args: readonly string[] }
  | {
      readonly $map: {
        readonly path: string;
        readonly cases: Readonly<Record<string, DeclarativeI18nText>>;
        readonly default?: DeclarativeI18nText;
      };
    }
  | {
      readonly $join: {
        readonly path: string;
        readonly sep?: string;
        readonly empty?: DeclarativeI18nText;
      };
    }
  | { readonly $coalesce: readonly string[]; readonly fallback?: string | number | boolean };

function isDeclarativeValueExpr(value: unknown): value is DeclarativeValueExpr {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.$path === 'string' ||
    typeof rec.$count === 'string' ||
    (rec.$sum !== null && typeof rec.$sum === 'object') ||
    (rec.$format !== undefined && Array.isArray(rec.$args ?? rec.args)) ||
    (rec.$map !== null && typeof rec.$map === 'object') ||
    (rec.$join !== null && typeof rec.$join === 'object') ||
    Array.isArray(rec.$coalesce)
  );
}

function resolveDataPath(data: unknown, path: string): unknown {
  if (!data || typeof data !== 'object' || !path) return undefined;
  const record = data as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, path)) return record[path];
  const segments = path.split('.').filter(Boolean);
  let cursor: unknown = data;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor) && seg === 'length') return cursor.length;
    if (typeof cursor !== 'object') return undefined;
    cursor = Object.prototype.hasOwnProperty.call(cursor, seg)
      ? (cursor as Record<string, unknown>)[seg]
      : undefined;
  }
  return cursor;
}

function evaluateDeclarativeExpr(
  exprOrKey: unknown,
  data: unknown,
  locale: PluginUiLocale,
  t: PluginUiText['t'],
): React.ReactNode {
  if (exprOrKey === null || exprOrKey === undefined) return '-';
  if (typeof exprOrKey === 'string') {
    const val = resolveDataPath(data, exprOrKey);
    return val === undefined || val === null || val === '' ? '-' : String(val);
  }
  if (!isDeclarativeValueExpr(exprOrKey)) {
    return String(exprOrKey);
  }
  const rec = exprOrKey as Record<string, unknown>;
  if (typeof rec.$path === 'string') {
    const val = resolveDataPath(data, rec.$path);
    const out = val !== undefined && val !== null && val !== '' ? val : rec.fallback;
    return out === undefined || out === null || out === '' ? '-' : String(out);
  }
  if (typeof rec.$count === 'string') {
    const target = resolveDataPath(data, rec.$count);
    if (Array.isArray(target)) return String(target.length);
    if (target && typeof target === 'object') return String(Object.keys(target).length);
    return typeof target === 'number' ? String(target) : '0';
  }
  if (rec.$sum && typeof rec.$sum === 'object') {
    const sumSpec = rec.$sum as { readonly path?: string; readonly field?: string };
    const list = sumSpec.path ? resolveDataPath(data, sumSpec.path) : undefined;
    if (!Array.isArray(list) || !sumSpec.field) return '0';
    const total = list.reduce((acc: number, item: unknown) => {
      let raw = resolveDataPath(item, sumSpec.field!);
      if (raw === undefined && sumSpec.field === 'pendingCount') {
        raw = resolveDataPath(item, 'drafts.length');
      }
      const n = Number(raw);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    return String(total);
  }
  const formatArgs = Array.isArray(rec.args)
    ? rec.args
    : Array.isArray(rec.$args)
      ? rec.$args
      : undefined;
  if (rec.$format !== undefined && formatArgs) {
    const template = pickText(rec.$format as DeclarativeI18nText, locale, t);
    const args = (formatArgs as readonly string[]).map((p) => resolveDataPath(data, p));
    if (args.length > 0 && args.every((v) => v === undefined || v === null || v === '')) {
      return '-';
    }
    return template.replace(/\{(\d+)\}/gu, (_m, idx) => {
      const v = args[Number(idx)];
      return v === undefined || v === null ? '' : String(v);
    });
  }
  if (rec.$map && typeof rec.$map === 'object') {
    const mapSpec = rec.$map as {
      readonly path?: string;
      readonly cases?: Readonly<Record<string, DeclarativeI18nText>>;
      readonly default?: DeclarativeI18nText;
    };
    const rawVal = mapSpec.path ? resolveDataPath(data, mapSpec.path) : undefined;
    if (rawVal !== undefined && rawVal !== null && mapSpec.cases) {
      const key = String(rawVal);
      if (Object.prototype.hasOwnProperty.call(mapSpec.cases, key)) {
        return pickText(mapSpec.cases[key]!, locale, t);
      }
    }
    if (mapSpec.default !== undefined) return pickText(mapSpec.default, locale, t);
    return rawVal === undefined || rawVal === null || rawVal === '' ? '-' : String(rawVal);
  }
  if (rec.$join && typeof rec.$join === 'object') {
    const joinSpec = rec.$join as {
      readonly path?: string;
      readonly sep?: string;
      readonly empty?: DeclarativeI18nText;
    };
    const list = joinSpec.path ? resolveDataPath(data, joinSpec.path) : undefined;
    if (!Array.isArray(list) || list.length === 0) {
      return joinSpec.empty !== undefined ? pickText(joinSpec.empty, locale, t) : '-';
    }
    return list.map((item) => String(item ?? '')).join(joinSpec.sep ?? ', ');
  }
  if (Array.isArray(rec.$coalesce)) {
    for (const candidate of rec.$coalesce as readonly string[]) {
      const val = resolveDataPath(data, candidate);
      if (val !== undefined && val !== null && val !== '') return String(val);
    }
    return rec.fallback !== undefined ? String(rec.fallback) : '-';
  }
  return '-';
}

export interface DeclarativeBadgeSpec<TData = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText | DeclarativeValueExpr | ((data: TData, ctx: DeclarativePageContext<TData>) => React.ReactNode);
  readonly tone?: BadgeTone | DeclarativeValueExpr | ((data: TData) => BadgeTone);
}

export interface DeclarativeStatSpec<TData = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText;
  readonly value: (keyof TData & string) | string | DeclarativeValueExpr | ((data: TData, ctx: DeclarativePageContext<TData>) => React.ReactNode);
  readonly unit?: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  readonly image?: string;
  readonly watermark?: React.ReactNode | string;
  readonly tone?: BadgeTone | 'primary' | 'default';
  readonly hint?: DeclarativeI18nText | DeclarativeValueExpr | ((data: TData) => React.ReactNode);
  readonly progress?: number | string | DeclarativeValueExpr;
  readonly sparkline?: string;
  readonly trend?: {
    readonly value: DeclarativeI18nText | DeclarativeValueExpr;
    readonly direction?: 'up' | 'down' | 'flat';
  };
  readonly badge?: {
    readonly label: DeclarativeI18nText | DeclarativeValueExpr | ((data: TData) => React.ReactNode);
    readonly tone?: BadgeTone | DeclarativeValueExpr | ((data: TData) => BadgeTone);
  };
}

export interface DeclarativeActionFieldSpec {
  readonly key: string;
  readonly label: DeclarativeI18nText;
  readonly type?: 'text' | 'password' | 'number' | 'textarea' | 'select' | 'switch' | 'radio' | 'checkbox-group' | 'segmented';
  readonly options?: readonly {
    readonly value: string;
    readonly label: DeclarativeI18nText;
    readonly description?: DeclarativeI18nText;
    readonly icon?: React.ReactNode;
    readonly badge?: React.ReactNode;
    readonly disabled?: boolean;
  }[];
  readonly variant?: 'default' | 'card' | 'button';
  readonly direction?: 'column' | 'row' | 'grid';
  readonly hint?: DeclarativeI18nText;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly defaultValue?: string;
  readonly secret?: boolean;
}

export interface DeclarativeActionSpec<TData = Record<string, unknown>> {
  /** RPC action method name (`plugin.<pluginId>.<name>`). */
  readonly name: string;
  readonly label: DeclarativeI18nText;
  readonly description?: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  readonly variant?: ButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  readonly fields?: readonly DeclarativeActionFieldSpec[];
  readonly params?: Readonly<Record<string, unknown>> | ((data: TData | undefined, values: Readonly<Record<string, string>>) => Readonly<Record<string, unknown>>);
  readonly disabled?: boolean | ((data: TData | undefined) => boolean);
  readonly successMessage?: DeclarativeI18nText;
}

export type DeclarativeColumnType =
  | 'auto'
  | 'text'
  | 'code'
  | 'badge'
  | 'boolean'
  | 'link'
  | 'datetime'
  | 'number'
  | 'progress'
  | 'tags'
  | 'json';

export interface DeclarativeColumnSpec<TRow = Record<string, unknown>, TData = Record<string, unknown>> {
  readonly key: keyof TRow & string;
  readonly label: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  readonly type?: DeclarativeColumnType;
  readonly align?: 'left' | 'center' | 'right';
  /** 固定列位置（水平滚动时粘性锁定在左侧或右侧并附带边缘阴影）。 */
  readonly fixed?: 'left' | 'right';
  readonly sortable?: boolean;
  readonly copyable?: boolean;
  readonly width?: string | number;
  readonly toneMap?: Readonly<Record<string, BadgeTone>>;
  readonly render?: (value: unknown, row: TRow, ctx: DeclarativePageContext<TData>) => React.ReactNode;
}

export interface DeclarativeBatchActionSpec<TRow = Record<string, unknown>, TData = Record<string, unknown>> {
  /** RPC action method name (`plugin.<pluginId>.<name>`) or action identifier. */
  readonly name: string;
  readonly label: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  readonly variant?: ButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  /** Key name in RPC payload for selected row keys; defaults to `'ids'`. */
  readonly idsParamKey?: string;
  readonly params?: (selectedRows: readonly TRow[], selectedKeys: readonly string[], data: TData | undefined) => Readonly<Record<string, unknown>>;
  readonly onExecute?: (selectedRows: readonly TRow[], selectedKeys: readonly string[], ctx: DeclarativePageContext<TData>) => unknown;
  readonly successMessage?: DeclarativeI18nText;
}

export interface DeclarativeRowActionSpec<TRow = Record<string, unknown>, TData = Record<string, unknown>> {
  readonly name: string;
  readonly label: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  readonly variant?: ButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  readonly idParamKey?: string;
  readonly params?: (row: TRow, rowKey: string, data: TData | undefined) => Readonly<Record<string, unknown>>;
  readonly onExecute?: (row: TRow, rowKey: string, ctx: DeclarativePageContext<TData>) => unknown;
  readonly disabled?: boolean | ((row: TRow) => boolean);
  readonly successMessage?: DeclarativeI18nText;
}

export interface DeclarativeSectionSpec<TData = Record<string, unknown>, TRow = Record<string, unknown>> {
  readonly id?: string;
  readonly title?: DeclarativeI18nText;
  readonly description?: DeclarativeI18nText;
  readonly tab?: DeclarativeI18nText;
  readonly layout?: 'table' | 'cards' | 'kv' | 'timeline' | 'json';
  readonly columnsCount?: 1 | 2 | 3;
  readonly collapsible?: boolean;
  readonly defaultCollapsed?: boolean;
  readonly emptyText?: DeclarativeI18nText;
  readonly rowKey?: keyof TRow & string;
  /** 是否开启表格多选与批量操作栏（配置 `batchActions` 时自动开启）。 */
  readonly selectable?: boolean;
  /** 表格批量操作配置。 */
  readonly batchActions?: readonly DeclarativeBatchActionSpec<TRow, TData>[];
  /** 表格行尾操作按钮配置（固定在右侧）。 */
  readonly rowActions?: readonly DeclarativeRowActionSpec<TRow, TData>[];
  /** 可展开详情行渲染函数。 */
  readonly renderExpandedRow?: (row: TRow, index: number, ctx: DeclarativePageContext<TData>) => React.ReactNode;
  /** 小屏下是否自动将表格行堆叠为响应式卡片（带 `data-label`）。 */
  readonly responsiveStack?: boolean;
  /** Extract rows for a declarative table or list. */
  readonly items?: (keyof TData & string) | ((data: TData) => readonly TRow[]);
  /** Columns for a declarative table/card list when `items` is provided. */
  readonly columns?: readonly DeclarativeColumnSpec<TRow, TData>[];
  /** Custom row renderer when `items` is provided. */
  readonly renderItem?: (item: TRow, index: number, ctx: DeclarativePageContext<TData>) => React.ReactNode;
  /** Key-value description list extractor (`<dl className="zk-dl">`). */
  readonly entries?:
    | readonly { readonly label: DeclarativeI18nText | React.ReactNode; readonly value?: React.ReactNode | DeclarativeValueExpr; readonly dataKey?: string; readonly hint?: DeclarativeI18nText }[]
    | ((data: TData, ctx: DeclarativePageContext<TData>) => Readonly<Record<string, React.ReactNode>> | readonly { readonly label: React.ReactNode; readonly value: React.ReactNode }[]);
  /** Custom section body renderer. */
  readonly render?: (data: TData, ctx: DeclarativePageContext<TData>) => React.ReactNode;
}

export interface DeclarativePageContext<TData = Record<string, unknown>> {
  readonly pluginId: string;
  readonly locale: PluginUiLocale;
  readonly t: PluginUiText['t'];
  readonly resource: RpcResource<TData>;
  readonly call: <TResult = unknown>(method: string, params?: Readonly<Record<string, unknown>>) => Promise<TResult>;
  readonly refresh: () => Promise<boolean>;
  readonly notify: (tone: 'info' | 'success' | 'warning' | 'danger', message: string) => void;
}

export interface DeclarativePageSpec<TData = Record<string, unknown>> {
  /** Explicit plugin ID (`root/<name>`); auto-resolved from page props or route when omitted. */
  readonly pluginId?: string;
  readonly title: DeclarativeI18nText;
  readonly description?: DeclarativeI18nText;
  readonly mark?: React.ReactNode;
  /** Status RPC method name; defaults to `'status'`. */
  readonly statusMethod?: string;
  /** Optional polling interval in ms; defaults to 10_000. Pass `0` to disable polling. */
  readonly pollMs?: number;
  readonly dictionary?: Readonly<Record<string, string>>;
  readonly isEmpty?: (data: TData) => boolean;
  readonly emptyTitle?: DeclarativeI18nText;
  readonly emptyDescription?: DeclarativeI18nText;
  readonly badges?: readonly DeclarativeBadgeSpec<TData>[] | ((data: TData, ctx: DeclarativePageContext<TData>) => readonly DeclarativeBadgeSpec<TData>[]);
  readonly stats?: readonly DeclarativeStatSpec<TData>[] | ((data: TData, ctx: DeclarativePageContext<TData>) => readonly DeclarativeStatSpec<TData>[]);
  readonly actions?: readonly DeclarativeActionSpec<TData>[];
  readonly sections?: readonly DeclarativeSectionSpec<TData, Record<string, unknown>>[];
  readonly render?: (data: TData, ctx: DeclarativePageContext<TData>) => React.ReactNode;
  readonly footnote?: DeclarativeI18nText;
}

export interface DeclarativePageComponentProps {
  readonly pluginId?: string;
  readonly owner?: string;
  readonly localName?: string;
  readonly route?: string;
  readonly title?: string;
  readonly [key: string]: unknown;
}

const declarativeStyles = `
.zk-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
.zk-stat-card {
  position: relative; overflow: hidden;
  padding: 16px 18px; border: 1px solid var(--zk-line); border-left: 3px solid var(--zk-primary);
  border-radius: var(--zk-radius-lg);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.04), var(--zk-surface) 65%);
  display: grid; gap: 6px; min-width: 0;
  transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease;
}
.zk-stat-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, var(--zk-primary), transparent); opacity: .75;
}
.zk-stat-card--default, .zk-stat-card--primary {
  border-left-color: var(--zk-primary);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.04), var(--zk-surface) 65%);
}
.zk-stat-card--success {
  border-color: rgba(16, 185, 129, 0.35);
  border-left: 3px solid #10b981;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.07), var(--zk-surface) 65%);
}
.zk-stat-card--success::before { background: linear-gradient(90deg, var(--zk-success), transparent); }
.zk-stat-card--warning {
  border-color: rgba(245, 158, 11, 0.38);
  border-left: 3px solid #f59e0b;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), var(--zk-surface) 65%);
}
.zk-stat-card--warning::before { background: linear-gradient(90deg, var(--zk-warning), transparent); }
.zk-stat-card--danger {
  border-color: rgba(244, 63, 94, 0.38);
  border-left: 3px solid #f43f5e;
  background: linear-gradient(135deg, rgba(244, 63, 94, 0.08), var(--zk-surface) 65%);
}
.zk-stat-card--danger::before { background: linear-gradient(90deg, var(--zk-danger), transparent); }
.zk-stat-card--info {
  border-color: rgba(14, 165, 233, 0.35);
  border-left: 3px solid #0ea5e9;
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.07), var(--zk-surface) 65%);
}
.zk-stat-card--info::before { background: linear-gradient(90deg, var(--zk-info), transparent); }
.zk-stat-card--neutral {
  border-left: 3px solid var(--zk-muted);
  background: var(--zk-surface);
}
.zk-stat-card--neutral::before { background: linear-gradient(90deg, var(--zk-muted), transparent); }
.zk-stat-card:hover {
  border-color: var(--zk-input-line);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px -6px rgba(15, 23, 42, 0.12);
}
.zk-stat-card__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zk-stat-card__label { font-size: var(--zk-text-small); color: var(--zk-muted); font-weight: 500; }
.zk-stat-card__value { font-size: 24px; font-weight: 700; line-height: 1.25; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.zk-table-wrap { overflow-x: auto; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); }
.zk-table { width: 100%; border-collapse: collapse; font-size: var(--zk-text-small); text-align: left; }
.zk-table th, .zk-table td { padding: 11px 14px; border-bottom: 1px solid var(--zk-line); vertical-align: middle; }
.zk-table th { color: var(--zk-muted); font-weight: 600; background: var(--zk-inset); white-space: nowrap; font-size: 12px; letter-spacing: 0.02em; }
.zk-th-sort { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 0; user-select: none; }
.zk-th-sort:hover { color: var(--zk-fg); }
.zk-th-sort__indicator { font-size: 11px; opacity: 0.7; }
.zk-table tbody tr { transition: background-color .12s ease; }
.zk-table tbody tr:hover td { background: var(--zk-inset); }
.zk-table tr:last-child td { border-bottom: none; }
.zk-table-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.zk-search-input {
  width: 220px !important; min-height: var(--zk-control-sm) !important;
  padding: 4px 10px !important; font-size: 12px !important;
  border-radius: var(--zk-radius-sm) !important;
}
.zk-pagination {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 14px; border-top: 1px solid var(--zk-line); background: var(--zk-inset);
  font-size: 12px; color: var(--zk-muted);
}
.zk-chip {
  display: inline-flex; align-items: center; padding: 1px 8px; margin: 1px 4px 1px 0;
  border-radius: 999px; background: var(--zk-inset); border: 1px solid var(--zk-line);
  font-size: 12px; font-weight: 500; color: var(--zk-fg);
}
.zk-code-pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 1px 7px;
  border-radius: 6px; background: var(--zk-inset); border: 1px solid var(--zk-line);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px; color: var(--zk-fg); max-width: 100%; overflow-wrap: anywhere;
}
.zk-copy-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 1px 6px; border-radius: 5px; border: 1px solid var(--zk-line);
  background: transparent; color: var(--zk-muted); font-size: 11px; cursor: pointer;
  transition: color .12s, border-color .12s, background-color .12s;
}
.zk-copy-btn:hover { color: var(--zk-primary); border-color: var(--zk-primary); background: var(--zk-surface); }
.zk-ext-link {
  display: inline-flex; align-items: center; gap: 4px; color: var(--zk-primary);
  font-weight: 500; text-decoration: none; word-break: break-all;
}
.zk-ext-link:hover { text-decoration: underline; }
.zk-sync-meta { font-size: 12px; color: var(--zk-muted); font-variant-numeric: tabular-nums; }
.zk-updated-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px;
  background: var(--zk-inset); border: 1px solid var(--zk-line);
  font-size: 11px; color: var(--zk-muted); font-variant-numeric: tabular-nums;
}
.zk-refresh-select {
  height: var(--zk-control-sm, 30px); padding: 2px 8px;
  border-radius: var(--zk-radius-sm, 6px); border: 1px solid var(--zk-line);
  background: var(--zk-surface); color: var(--zk-fg);
  font-size: 12px; cursor: pointer;
}
.zk-refresh-select:hover { border-color: var(--zk-input-line); }
.zk-action-jump-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--zk-line); background: var(--zk-inset);
  color: var(--zk-fg); font-size: 12px; text-decoration: none; font-weight: 500;
  transition: border-color .12s, color .12s;
}
.zk-action-jump-pill:hover { border-color: var(--zk-primary); color: var(--zk-primary); }
.zk-entries-grid {
  display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 10px;
}
@media (min-width: 640px) {
  .zk-entries-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.zk-entry-card {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 11px 14px; border-radius: var(--zk-radius-md, 8px);
  border: 1px solid var(--zk-line); background: var(--zk-surface);
  min-width: 0; transition: border-color .14s ease;
}
.zk-entry-card:hover { border-color: var(--zk-input-line); }
.zk-entry-card__meta { display: grid; gap: 2px; min-width: 0; }
.zk-entry-card__label { font-size: 12px; color: var(--zk-muted); font-weight: 500; }
.zk-entry-card__value {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; color: var(--zk-fg);
  text-align: right; overflow-wrap: anywhere;
}
.zk-empty-cell { color: var(--zk-muted); opacity: 0.65; }
.zk-action-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
.zk-action-card { display: grid; gap: 12px; align-content: start; }
.zk-action-card__head { display: grid; gap: 4px; }
.zk-action-fields-grid {
  display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 12px;
}
@media (min-width: 640px) {
  .zk-action-fields-grid--multi { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.zk-field--full { grid-column: 1 / -1; }
.zk-action-result-preview {
  margin-top: 6px; padding: 10px 12px;
  border-radius: var(--zk-radius-md, 8px);
  border: 1px solid var(--zk-line); background: var(--zk-inset);
  display: grid; gap: 8px;
}
.zk-action-result-preview__head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 12px; font-weight: 600; color: var(--zk-muted);
}
.zk-action-preview-img {
  max-width: 200px; max-height: 200px; border-radius: 8px;
  border: 1px solid var(--zk-line); background: #fff; padding: 6px; object-fit: contain;
}
`;

function formatTimeHMS(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pickText(text: DeclarativeI18nText | undefined, locale: PluginUiLocale, t: PluginUiText['t']): string {
  if (!text) return '';
  if (typeof text === 'string') return t(text);
  if (locale === 'en' && text.en) return text.en;
  return text['zh-CN'] ?? text.zh;
}

function formatError(error: unknown, t: PluginUiText['t']): string {
  if (error instanceof PluginRpcError && error.code === 'forbidden') return t('没有操作权限');
  return error instanceof Error && error.message ? error.message : t('操作失败');
}

function resolveBlueprintText(text: DeclarativeI18nText | undefined, locale: 'en' | 'zh-CN' = 'en'): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (locale === 'en') return text.en ?? text['zh-CN'] ?? text.zh ?? '';
  return text['zh-CN'] ?? text.zh ?? text.en ?? '';
}

function buildDeclarativeBlueprint<TData = Record<string, unknown>>(spec: DeclarativePageSpec<TData>) {
  if ((spec as { kind?: unknown })?.kind === 'zhin.console.page-blueprint') {
    return spec as unknown as Record<string, unknown>;
  }
  const sections: Record<string, unknown>[] = [];
  if (Array.isArray(spec.stats) && spec.stats.length > 0) {
    sections.push({
      type: 'stats',
      id: 'runtime-stats',
      title: 'Runtime Stats',
      items: spec.stats.map((s, i) => ({
        key: s.key ?? (typeof s.value === 'string' ? s.value : `stat-${i}`),
        label: resolveBlueprintText(s.label, 'en'),
        ...(s.tone ? { tone: s.tone } : {}),
        ...(s.unit ? { unit: resolveBlueprintText(s.unit, 'en') } : {}),
        ...(typeof s.value === 'string' ? { dataKey: s.value } : {}),
        ...(isDeclarativeValueExpr(s.value) ? { expr: s.value } : {}),
      })),
    });
  }
  for (const [idx, sec] of (spec.sections ?? []).entries()) {
    const id = sec.id ?? `section-${idx}`;
    const title = resolveBlueprintText(sec.title, 'en');
    if (sec.columns !== undefined || sec.items !== undefined) {
      sections.push({
        type: 'table',
        id,
        title,
        ...(typeof sec.items === 'string' ? { dataKey: sec.items } : {}),
        rowKey: sec.columns?.[0]?.key ?? 'id',
        columns: (sec.columns ?? []).map((c) => ({
          key: c.key,
          label: resolveBlueprintText(c.label, 'en'),
          ...(c.type ? { type: c.type } : {}),
          ...(c.align ? { align: c.align } : {}),
          ...(c.sortable !== undefined ? { sortable: c.sortable } : {}),
          ...(c.copyable !== undefined ? { copyable: c.copyable } : {}),
        })),
      });
    } else if (sec.entries !== undefined) {
      sections.push({
        type: 'entries',
        id,
        title,
        ...(Array.isArray(sec.entries)
          ? {
              entries: sec.entries.map(
                (e: {
                  readonly label?: DeclarativeI18nText;
                  readonly value?: unknown;
                  readonly dataKey?: string;
                }) => ({
                  label: resolveBlueprintText(e.label, 'en'),
                  value: isDeclarativeValueExpr(e.value) ? '' : String(e.value ?? ''),
                  ...(e.dataKey ? { dataKey: e.dataKey } : {}),
                  ...(isDeclarativeValueExpr(e.value) ? { expr: e.value } : {}),
                }),
              ),
            }
          : {}),
      });
    } else {
      sections.push({ type: 'custom', id, ...(title ? { title } : {}) });
    }
  }
  if (Array.isArray(spec.actions) && spec.actions.length > 0) {
    sections.push({
      type: 'actions',
      id: 'actions',
      title: 'Actions',
      items: spec.actions.map((a) => ({
        label: resolveBlueprintText(a.label, 'en'),
        action: a.name,
        name: a.name,
        ...(a.description !== undefined ? { description: resolveBlueprintText(a.description, 'en') } : {}),
        ...(a.variant !== undefined ? { variant: a.variant } : {}),
        ...(a.confirm !== undefined ? { confirm: a.confirm } : {}),
        ...(a.confirmLabel !== undefined ? { confirmLabel: a.confirmLabel } : {}),
        ...(a.fields !== undefined ? { fields: a.fields } : {}),
        ...(a.params !== undefined ? { params: a.params } : {}),
        ...(a.disabled !== undefined ? { disabled: a.disabled } : {}),
        ...(a.successMessage !== undefined ? { successMessage: a.successMessage } : {}),
      })),
    });
  }
  const description = resolveBlueprintText(spec.description, 'en');
  const rawReviewSpec = (spec as unknown as { readonly reviewSpec?: unknown }).reviewSpec;
  return {
    kind: 'zhin.console.page-blueprint' as const,
    version: 1 as const,
    title: resolveBlueprintText(spec.title, 'en'),
    ...(description ? { description } : {}),
    dataSource: { action: spec.statusMethod ?? 'status' },
    sections,
    spec,
    ...(rawReviewSpec !== undefined ? { reviewSpec: rawReviewSpec } : {}),
  };
}

function normalizeActionField(f: Record<string, unknown>): DeclarativeActionFieldSpec {
  const key = String(f.key ?? f.name ?? '');
  return {
    ...(f as unknown as DeclarativeActionFieldSpec),
    key,
    label: (f.label as DeclarativeI18nText) ?? key,
  };
}

function normalizeActionSpec<TData = Record<string, unknown>>(
  act: Record<string, unknown>,
): DeclarativeActionSpec<TData> | undefined {
  if (!act || typeof act !== 'object') return undefined;
  const name = String(act.action ?? act.name ?? '');
  if (!name) return undefined;
  const rawFields = Array.isArray(act.fields) ? (act.fields as Record<string, unknown>[]) : undefined;
  const fields = rawFields?.filter((f) => f && typeof f === 'object').map(normalizeActionField);
  return {
    ...(act as unknown as DeclarativeActionSpec<TData>),
    name,
    label: (act.label as DeclarativeI18nText) ?? name,
    ...(act.description !== undefined ? { description: act.description as DeclarativeI18nText } : {}),
    ...(act.variant !== undefined ? { variant: act.variant as ButtonVariant } : {}),
    ...(act.confirm !== undefined ? { confirm: act.confirm as DeclarativeI18nText } : {}),
    ...(act.confirmLabel !== undefined ? { confirmLabel: act.confirmLabel as DeclarativeI18nText } : {}),
    ...(fields !== undefined ? { fields } : {}),
    ...(act.params !== undefined ? { params: act.params as DeclarativeActionSpec<TData>['params'] } : {}),
    ...(act.disabled !== undefined ? { disabled: act.disabled as DeclarativeActionSpec<TData>['disabled'] } : {}),
    ...(act.successMessage !== undefined ? { successMessage: act.successMessage as DeclarativeI18nText } : {}),
  };
}

function normalizeDirectSpec<TData = Record<string, unknown>>(
  specObj: DeclarativePageSpec<TData>,
): DeclarativePageSpec<TData> {
  const mergedActions: DeclarativeActionSpec<TData>[] = [];
  const seenNames = new Set<string>();
  const pushAct = (rawAct: unknown) => {
    if (!rawAct || typeof rawAct !== 'object') return;
    const norm = normalizeActionSpec<TData>(rawAct as Record<string, unknown>);
    if (norm && !seenNames.has(norm.name)) {
      seenNames.add(norm.name);
      mergedActions.push(norm);
    }
  };
  for (const act of specObj.actions ?? []) {
    pushAct(act);
  }
  const filteredSections: DeclarativeSectionSpec<TData, Record<string, unknown>>[] = [];
  for (const sec of specObj.sections ?? []) {
    if (!sec || typeof sec !== 'object') continue;
    const rawSec = sec as unknown as Record<string, unknown>;
    const secType = rawSec.type ?? rawSec.kind;
    if (secType === 'actions' || Array.isArray(rawSec.actions)) {
      const actList = Array.isArray(rawSec.actions)
        ? rawSec.actions
        : Array.isArray(rawSec.items)
          ? rawSec.items
          : [];
      for (const act of actList) {
        pushAct(act);
      }
      if (
        secType === 'actions' &&
        sec.columns === undefined &&
        sec.entries === undefined &&
        sec.render === undefined
      ) {
        continue;
      }
    }
    filteredSections.push(sec);
  }
  return {
    ...specObj,
    ...(mergedActions.length > 0 ? { actions: mergedActions } : {}),
    ...(specObj.sections !== undefined ? { sections: filteredSections } : {}),
  };
}

function coerceDeclarativeSpec<TData = Record<string, unknown>>(
  input: DeclarativePageSpec<TData>,
): DeclarativePageSpec<TData> {
  const raw = input as unknown as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return input;
  if (raw.spec && typeof raw.spec === 'object') {
    const inner = normalizeDirectSpec(raw.spec as DeclarativePageSpec<TData>);
    return {
      ...(raw.badges !== undefined && inner.badges === undefined
        ? { badges: raw.badges as DeclarativePageSpec<TData>['badges'] }
        : {}),
      ...(raw.dictionary !== undefined && inner.dictionary === undefined
        ? { dictionary: raw.dictionary as Readonly<Record<string, string>> }
        : {}),
      ...inner,
    };
  }
  if (raw.kind !== 'zhin.console.page-blueprint') {
    return normalizeDirectSpec(input);
  }
  const rawSections = Array.isArray(raw.sections) ? (raw.sections as Record<string, unknown>[]) : [];
  const stats: DeclarativeStatSpec<TData>[] = [];
  const actions: DeclarativeActionSpec<TData>[] = [];
  const seenActionNames = new Set<string>();
  const pushAction = (actObj: unknown) => {
    if (!actObj || typeof actObj !== 'object') return;
    const norm = normalizeActionSpec<TData>(actObj as Record<string, unknown>);
    if (norm && !seenActionNames.has(norm.name)) {
      seenActionNames.add(norm.name);
      actions.push(norm);
    }
  };
  if (Array.isArray(raw.actions)) {
    for (const act of raw.actions) {
      pushAction(act);
    }
  }
  const sections: DeclarativeSectionSpec<TData, Record<string, unknown>>[] = [];

  for (const sec of rawSections) {
    if (!sec || typeof sec !== 'object') continue;
    const secType = sec.type ?? sec.kind;
    if (secType === 'stats') {
      const items = Array.isArray(sec.items) ? (sec.items as Record<string, unknown>[]) : [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const dataKey = typeof item.dataKey === 'string' ? item.dataKey : undefined;
        const expr = isDeclarativeValueExpr(item.expr) ? item.expr : (isDeclarativeValueExpr(item.value) ? item.value : undefined);
        const staticVal = item.value;
        stats.push({
          key: typeof item.key === 'string' ? item.key : dataKey,
          label: (item.label as DeclarativeI18nText) ?? (typeof item.key === 'string' ? item.key : ''),
          ...(typeof item.tone === 'string' ? { tone: item.tone as DeclarativeStatSpec<TData>['tone'] } : {}),
          ...(item.unit !== undefined ? { unit: item.unit as DeclarativeI18nText } : {}),
          ...(item.hint !== undefined ? { hint: item.hint as DeclarativeStatSpec<TData>['hint'] } : {}),
          ...(item.icon !== undefined ? { icon: item.icon as React.ReactNode } : {}),
          value: expr
            ? expr
            : dataKey
              ? ((data: TData) => {
                  const resolved = resolveDataPath(data, dataKey);
                  return String(resolved ?? staticVal ?? '-');
                })
              : ((data: TData) => {
                  if (typeof item.key === 'string') {
                    const resolved = resolveDataPath(data, item.key);
                    if (resolved !== undefined) return String(resolved ?? '-');
                  }
                  return String(staticVal ?? '-');
                }),
        });
      }
    } else if (secType === 'actions') {
      const actItems = Array.isArray(sec.actions)
        ? (sec.actions as Record<string, unknown>[])
        : (Array.isArray(sec.items) ? (sec.items as Record<string, unknown>[]) : []);
      for (const act of actItems) {
        pushAction(act);
      }
    } else if (secType === 'table') {
      const dataKey = typeof sec.dataKey === 'string' ? sec.dataKey : undefined;
      const staticRows = Array.isArray(sec.rows)
        ? (sec.rows as readonly Record<string, unknown>[])
        : (Array.isArray(sec.items) ? (sec.items as readonly Record<string, unknown>[]) : []);
      const cols = Array.isArray(sec.columns) ? (sec.columns as Record<string, unknown>[]) : [];
      sections.push({
        id: typeof sec.id === 'string' ? sec.id : undefined,
        title: sec.title as DeclarativeI18nText | undefined,
        emptyText: sec.emptyText as DeclarativeI18nText | undefined,
        ...(typeof sec.rowKey === 'string' ? { rowKey: sec.rowKey } : {}),
        items: dataKey
          ? ((data: TData) => {
              const fromData = resolveDataPath(data, dataKey);
              return Array.isArray(fromData) ? (fromData as readonly Record<string, unknown>[]) : staticRows;
            })
          : (() => staticRows),
        columns: cols.map((c) => ({
          key: String(c.key ?? ''),
          label: (c.label as DeclarativeI18nText) ?? String(c.key ?? ''),
          ...(typeof c.type === 'string' ? { type: c.type as DeclarativeColumnType } : {}),
          ...(typeof c.align === 'string' ? { align: c.align as 'left' | 'center' | 'right' } : {}),
          ...(typeof c.sortable === 'boolean' ? { sortable: c.sortable } : {}),
          ...(typeof c.copyable === 'boolean' ? { copyable: c.copyable } : {}),
        })),
      });
    } else if (secType === 'entries') {
      const rawEntries = Array.isArray(sec.entries)
        ? (sec.entries as Record<string, unknown>[])
        : (Array.isArray(sec.items) ? (sec.items as Record<string, unknown>[]) : []);
      sections.push({
        id: typeof sec.id === 'string' ? sec.id : undefined,
        title: sec.title as DeclarativeI18nText | undefined,
        entries: (data: TData, ctx: DeclarativePageContext<TData>) =>
          rawEntries.map((e) => {
            const dk = typeof e.dataKey === 'string' ? e.dataKey : (typeof e.key === 'string' ? e.key : undefined);
            const expr = isDeclarativeValueExpr(e.expr)
              ? e.expr
              : (isDeclarativeValueExpr(e.value) ? e.value : undefined);
            const val = expr
              ? evaluateDeclarativeExpr(expr, data, ctx.locale, ctx.t)
              : dk
                ? resolveDataPath(data, dk)
                : e.value;
            return {
              key: dk,
              hint: e.hint ? pickText(e.hint as DeclarativeI18nText, ctx.locale, ctx.t) : undefined,
              label: String(e.label ?? e.key ?? ''),
              value: (val ?? '—') as React.ReactNode,
            };
          }),
      });
    }
  }

  const dataSource = raw.dataSource && typeof raw.dataSource === 'object'
    ? (raw.dataSource as Record<string, unknown>)
    : undefined;
  const statusMethod = typeof dataSource?.action === 'string'
    ? dataSource.action
    : (typeof raw.statusMethod === 'string' ? raw.statusMethod : 'status');

  return {
    pluginId: typeof raw.pluginId === 'string' ? raw.pluginId : undefined,
    title: (raw.title as DeclarativeI18nText) ?? '',
    description: (raw.description ?? raw.subtitle) as DeclarativeI18nText | undefined,
    statusMethod,
    ...(typeof raw.pollMs === 'number' ? { pollMs: raw.pollMs } : {}),
    ...(raw.dictionary && typeof raw.dictionary === 'object'
      ? { dictionary: raw.dictionary as Readonly<Record<string, string>> }
      : {}),
    ...(raw.badges !== undefined ? { badges: raw.badges as DeclarativePageSpec<TData>['badges'] } : {}),
    ...(stats.length > 0 ? { stats } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(sections.length > 0 ? { sections } : {}),
  };
}

const VALID_BADGE_TONES = new Set<BadgeTone>(['neutral', 'success', 'warning', 'danger', 'info']);

function resolveBadgeTone<TData>(
  toneSpec: BadgeTone | DeclarativeValueExpr | ((data: TData) => BadgeTone) | undefined,
  data: TData | undefined,
  locale: PluginUiLocale,
  t: PluginUiText['t'],
): BadgeTone {
  if (!toneSpec) return 'neutral';
  if (typeof toneSpec === 'function') {
    return data !== undefined ? toneSpec(data) : 'neutral';
  }
  if (isDeclarativeValueExpr(toneSpec)) {
    const raw = String(evaluateDeclarativeExpr(toneSpec, data, locale, t)).trim() as BadgeTone;
    return VALID_BADGE_TONES.has(raw) ? raw : 'neutral';
  }
  return VALID_BADGE_TONES.has(toneSpec) ? toneSpec : 'neutral';
}

const CODE_KEY_PATTERN =
  /(?:^id$|Id$|_id$|^pid$|^cron$|Cron$|Path$|Key$|^hostname$|^platform$|^nodeVersion$|^intervalMs$)/u;

function classifySemanticStatus(raw: string): BadgeTone | undefined {
  const lower = raw.trim().toLowerCase();
  if (
    lower === 'true' ||
    lower === 'yes' ||
    lower === 'enabled' ||
    lower === 'active' ||
    lower === 'running' ||
    lower === 'healthy' ||
    lower === 'ready' ||
    lower === 'online' ||
    lower === 'ok' ||
    lower === 'connected' ||
    raw === '已就绪' ||
    raw === '已启用' ||
    raw === '运行中' ||
    raw === '正常' ||
    raw === '已开启' ||
    raw === '开启' ||
    raw === '健康' ||
    raw === '已连接' ||
    raw === '是'
  ) {
    return 'success';
  }
  if (
    lower === 'degraded' ||
    lower === 'not ready' ||
    lower === 'pending' ||
    lower === 'stale' ||
    lower === 'warning' ||
    raw === '未就绪' ||
    raw === '降级' ||
    raw === '待审' ||
    raw === '警告'
  ) {
    return 'warning';
  }
  if (
    lower === 'error' ||
    lower === 'failed' ||
    lower === 'crashed' ||
    lower === 'danger' ||
    raw === '异常' ||
    raw === '失败' ||
    raw === '错误'
  ) {
    return 'danger';
  }
  if (
    lower === 'false' ||
    lower === 'no' ||
    lower === 'disabled' ||
    lower === 'inactive' ||
    lower === 'stopped' ||
    lower === 'offline' ||
    lower === 'disconnected' ||
    lower === 'idle' ||
    raw === '未启用' ||
    raw === '已禁用' ||
    raw === '已关闭' ||
    raw === '关闭' ||
    raw === '离线' ||
    raw === '未连接' ||
    raw === '否'
  ) {
    return 'neutral';
  }
  return undefined;
}

function renderSmartValue(
  raw: unknown,
  fieldKey: string | undefined,
  copiedKey: string,
  copiedState: string,
  onCopy: (key: string, text: string) => void,
  t: PluginUiText['t'],
  colSpec?: {
    readonly type?: DeclarativeColumnType;
    readonly copyable?: boolean;
    readonly toneMap?: Readonly<Record<string, BadgeTone>>;
  },
): React.ReactNode {
  if (raw === null || raw === undefined || raw === '') return <span className="zk-empty-cell">—</span>;
  const colType = colSpec?.type ?? 'auto';
  if (colType === 'progress') {
    const num = Number(raw);
    return Number.isFinite(num) ? <ProgressBar value={num} size="sm" showValue /> : <span className="zk-empty-cell">—</span>;
  }
  if (colType === 'boolean' || typeof raw === 'boolean') {
    const b = typeof raw === 'boolean' ? raw : String(raw).toLowerCase() === 'true';
    return <Badge tone={b ? 'success' : 'neutral'}>{b ? 'true' : 'false'}</Badge>;
  }
  if (colType === 'badge') {
    const s = String(raw);
    const mappedTone = colSpec?.toneMap?.[s] ?? classifySemanticStatus(s) ?? 'neutral';
    return <Badge tone={mappedTone}>{s}</Badge>;
  }
  if (colType === 'datetime') {
    const d = typeof raw === 'number' || typeof raw === 'string' ? new Date(raw) : null;
    if (d && !Number.isNaN(d.getTime())) {
      return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{d.toLocaleString()}</span>;
    }
  }
  if (colType === 'json') {
    return <code className="zk-code-pill">{typeof raw === 'string' ? raw : JSON.stringify(raw)}</code>;
  }
  if (colType === 'tags' || Array.isArray(raw)) {
    const arr = Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim());
    const nonEmpty = arr.filter((item) => item !== null && item !== undefined && item !== '');
    if (nonEmpty.length === 0) return <span className="zk-empty-cell">—</span>;
    return (
      <span>
        {nonEmpty.map((item, idx) => (
          <span key={idx} className="zk-chip">
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </span>
        ))}
      </span>
    );
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '-' || trimmed === '—') return <span className="zk-empty-cell">—</span>;
    if (colType === 'link' || /^https?:\/\/\S+$/iu.test(trimmed)) {
      return (
        <span className="zk-row">
          <a href={trimmed} target="_blank" rel="noopener noreferrer" className="zk-ext-link">
            {trimmed} <span aria-hidden="true">↗</span>
          </a>
          <button
            type="button"
            className="zk-copy-btn"
            onClick={() => onCopy(copiedKey, trimmed)}
          >
            {copiedState === copiedKey ? '✓' : t('复制')}
          </button>
        </span>
      );
    }
    if (colSpec?.toneMap && Object.prototype.hasOwnProperty.call(colSpec.toneMap, trimmed)) {
      return <Badge tone={colSpec.toneMap[trimmed]}>{trimmed}</Badge>;
    }
    if (colType === 'auto') {
      const statusTone = classifySemanticStatus(trimmed);
      if (statusTone !== undefined) {
        return <Badge tone={statusTone}>{trimmed}</Badge>;
      }
    }
    if (colType === 'code' || colSpec?.copyable || (colType === 'auto' && fieldKey && CODE_KEY_PATTERN.test(fieldKey))) {
      return (
        <span className="zk-row">
          <code className="zk-code-pill">{trimmed}</code>
          <button
            type="button"
            className="zk-copy-btn"
            onClick={() => onCopy(copiedKey, trimmed)}
          >
            {copiedState === copiedKey ? '✓' : t('复制')}
          </button>
        </span>
      );
    }
    return trimmed;
  }
  if (typeof raw === 'number') {
    if (colType === 'code' || colSpec?.copyable || (colType === 'auto' && fieldKey && CODE_KEY_PATTERN.test(fieldKey))) {
      return (
        <span className="zk-row">
          <code className="zk-code-pill">{String(raw)}</code>
          <button
            type="button"
            className="zk-copy-btn"
            onClick={() => onCopy(copiedKey, String(raw))}
          >
            {copiedState === copiedKey ? '✓' : t('复制')}
          </button>
        </span>
      );
    }
    return String(raw);
  }
  if (typeof raw === 'object' && !React.isValidElement(raw)) {
    return <code className="zk-code-pill">{JSON.stringify(raw)}</code>;
  }
  return raw as React.ReactNode;
}

const TABLE_PAGE_SIZE = 15;

interface StickyColMeta {
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

function parseNumericWidth(width: string | number | undefined, fallback = 140): number {
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) return width;
  if (typeof width === 'string') {
    const m = /^(\d+(?:\.\d+)?)(?:px)?$/iu.exec(width.trim());
    if (m) return parseFloat(m[1]!);
  }
  return fallback;
}

function computeStickyColumnMeta(
  columns: readonly { readonly fixed?: 'left' | 'right'; readonly width?: string | number }[],
  prefixLeftPx = 0,
  suffixRightPx = 0,
): readonly StickyColMeta[] {
  const metas: { className?: string; style?: React.CSSProperties }[] = columns.map(() => ({}));
  const leftIndices = columns
    .map((c, idx) => (c.fixed === 'left' ? idx : -1))
    .filter((idx) => idx >= 0);
  const rightIndices = columns
    .map((c, idx) => (c.fixed === 'right' ? idx : -1))
    .filter((idx) => idx >= 0);

  let curLeft = prefixLeftPx;
  leftIndices.forEach((colIdx, pos) => {
    const col = columns[colIdx]!;
    const w = parseNumericWidth(col.width, 140);
    const isLastLeft = pos === leftIndices.length - 1;
    metas[colIdx] = {
      className: isLastLeft ? 'zk-cell-fixed-left zk-cell-fixed-left-last' : 'zk-cell-fixed-left',
      style: { left: `${curLeft}px` },
    };
    curLeft += w;
  });

  let curRight = suffixRightPx;
  for (let pos = rightIndices.length - 1; pos >= 0; pos -= 1) {
    const colIdx = rightIndices[pos]!;
    const col = columns[colIdx]!;
    const w = parseNumericWidth(col.width, 140);
    const isFirstRight = pos === 0;
    metas[colIdx] = {
      className: isFirstRight ? 'zk-cell-fixed-right zk-cell-fixed-right-first' : 'zk-cell-fixed-right',
      style: { right: `${curRight}px` },
    };
    curRight += w;
  }
  return metas;
}

export function DeclarativePageView<TData = Record<string, unknown>>({
  spec: rawSpec,
  pageProps,
}: {
  readonly spec: DeclarativePageSpec<TData>;
  readonly pageProps?: DeclarativePageComponentProps;
}) {
  const reviewSpec =
    rawSpec && typeof rawSpec === 'object' && (rawSpec as unknown as { reviewSpec?: unknown }).reviewSpec != null
      ? (rawSpec as unknown as { reviewSpec: unknown }).reviewSpec
      : undefined;
  if (reviewSpec) {
    return <CommentReviewSession spec={reviewSpec as never} />;
  }

  const spec = useMemo(() => coerceDeclarativeSpec(rawSpec), [rawSpec]);
  const { locale, t } = useLocale(spec.dictionary);
  const rawPluginId = resolveSyncPluginId(pageProps?.pluginId ?? pageProps?.owner ?? spec.pluginId);
  const pluginId = rawPluginId === 'unknown' ? undefined : rawPluginId;
  const statusMethod = spec.statusMethod ?? 'status';
  const defaultPollMs = spec.pollMs === undefined ? 15_000 : (spec.pollMs > 0 ? spec.pollMs : 0);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(defaultPollMs);
  const pollMs = pollIntervalMs > 0 ? pollIntervalMs : undefined;

  const resource = usePluginRpc<TData>(pluginId, statusMethod, undefined, {
    pollMs,
    isEmpty: spec.isEmpty ?? (() => false),
  });

  const [notice, setNotice] = useState<{ readonly tone: 'info' | 'success' | 'warning' | 'danger'; readonly message: string } | undefined>();
  const [busyAction, setBusyAction] = useState<string>('');
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
  const [actionInputs, setActionInputs] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>({});
  const [actionResults, setActionResults] = useState<Readonly<Record<string, Record<string, unknown>>>>({});
  const [sectionQueries, setSectionQueries] = useState<Readonly<Record<string, string>>>({});
  const [sectionPages, setSectionPages] = useState<Readonly<Record<string, number>>>({});
  const [sectionSorts, setSectionSorts] = useState<Readonly<Record<string, { readonly key: string; readonly dir: 'asc' | 'desc' } | undefined>>>({});
  const [sectionSelections, setSectionSelections] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [sectionExpanded, setSectionExpanded] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [activeTab, setActiveTab] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string>('');

  const handleCopy = useCallback((key: string, text: string) => {
    try {
      void globalThis.navigator?.clipboard?.writeText?.(text);
    } catch {
      // ignore clipboard errors in non-secure or headless test environments
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? '' : prev));
    }, 1_800);
  }, []);

  useEffect(() => {
    if (!notice || notice.tone === 'danger') return;
    const timer = setTimeout(() => setNotice(undefined), 6_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const notify = useCallback((tone: 'info' | 'success' | 'warning' | 'danger', message: string) => {
    setNotice({ tone, message });
  }, []);

  const call = useCallback(
    async <TResult = unknown,>(method: string, params?: Readonly<Record<string, unknown>>): Promise<TResult> => {
      if (!pluginId) throw new Error('Plugin ID is not resolved');
      return pluginRpc<TResult>(pluginId, method, params);
    },
    [pluginId],
  );

  const ctx = useMemo<DeclarativePageContext<TData>>(
    () => ({
      pluginId: pluginId ?? 'unknown',
      locale,
      t,
      resource,
      call,
      refresh: resource.refresh,
      notify,
    }),
    [pluginId, locale, t, resource, call, notify],
  );

  const handleManualRefresh = async () => {
    setManualRefreshBusy(true);
    try {
      await resource.refresh();
    } finally {
      setManualRefreshBusy(false);
    }
  };

  const runAction = async (action: DeclarativeActionSpec<TData>) => {
    if (!pluginId) return;
    const rawValues = actionInputs[action.name] ?? {};
    const values: Record<string, string> = { ...rawValues };
    for (const field of action.fields ?? []) {
      if (values[field.key] === undefined && field.defaultValue !== undefined) {
        values[field.key] = field.defaultValue;
      }
      const val = (values[field.key] ?? '').trim();
      if (field.required && !val) {
        notify('danger', `${pickText(field.label, locale, t)} ${t('不能为空')}`);
        return;
      }
    }
    setBusyAction(action.name);
    try {
      const payload = typeof action.params === 'function'
        ? action.params(resource.data, values)
        : (action.params ?? (action.fields?.length ? values : undefined));
      const rpcMethod = /[A-Z]/u.test(action.name)
        ? action.name.replace(/[A-Z]/gu, (m) => `-${m.toLowerCase()}`)
        : action.name;
      const res = await call<Record<string, unknown> | undefined>(rpcMethod, payload);
      const msg = (res && typeof res === 'object' && typeof res.message === 'string' && res.message)
        ? res.message
        : (action.successMessage ? pickText(action.successMessage, locale, t) : `${pickText(action.label, locale, t)} ${t('已完成')}`);
      const tone: 'success' | 'warning' | 'danger' =
        res && typeof res === 'object' && (res.passed === false || res.decision === 'block')
          ? 'danger'
          : res && typeof res === 'object' && (res.decision === 'review' || res.decision === 'warn')
            ? 'warning'
            : 'success';
      if (res && typeof res === 'object') {
        const previewKeys = ['dataUrl', 'qrDataUrl', 'imageUrl', 'shortUrl', 'url', 'text', 'output', 'result'];
        const hasPreviewable = previewKeys.some((k) => res[k] !== undefined && res[k] !== null && res[k] !== '');
        if (hasPreviewable) {
          setActionResults((prev) => ({ ...prev, [action.name]: res }));
        }
      }
      notify(tone, msg);
      await resource.refresh();
    } catch (err) {
      notify('danger', formatError(err, t));
    } finally {
      setBusyAction('');
    }
  };

  const renderActionResultPreview = (actionName: string, resObj: Record<string, unknown> | undefined) => {
    if (!resObj) return null;
    const imgUrl =
      (typeof resObj.dataUrl === 'string' && resObj.dataUrl.startsWith('data:image/') ? resObj.dataUrl : undefined) ??
      (typeof resObj.qrDataUrl === 'string' && resObj.qrDataUrl.startsWith('data:image/') ? resObj.qrDataUrl : undefined) ??
      (typeof resObj.imageUrl === 'string' && resObj.imageUrl ? resObj.imageUrl : undefined);
    const copyableText =
      (typeof resObj.shortUrl === 'string' && resObj.shortUrl ? resObj.shortUrl : undefined) ??
      (typeof resObj.url === 'string' && resObj.url ? resObj.url : undefined) ??
      (typeof resObj.text === 'string' && resObj.text ? resObj.text : undefined) ??
      (typeof resObj.output === 'string' && resObj.output ? resObj.output : undefined) ??
      (typeof resObj.result === 'string' && resObj.result ? resObj.result : undefined);
    const structuredData =
      (resObj.output && typeof resObj.output === 'object' ? resObj.output : undefined) ??
      (resObj.result && typeof resObj.result === 'object' ? resObj.result : undefined);
    if (!imgUrl && !copyableText && !structuredData) return null;
    const copyKey = `action-res-${actionName}`;
    return (
      <div className="zk-action-result-preview" data-action-preview={actionName}>
        <div className="zk-action-result-preview__head">
          <span>{locale === 'en' ? 'Result Preview' : '执行结果预览'}</span>
          <button
            type="button"
            className="zk-copy-btn"
            onClick={() =>
              setActionResults((prev) => {
                const next = { ...prev };
                delete next[actionName];
                return next;
              })
            }
          >
            {t('关闭')}
          </button>
        </div>
        {imgUrl && (
          <div className="zk-row" style={{ alignItems: 'center', gap: 12 }}>
            <img src={imgUrl} alt={actionName} className="zk-action-preview-img" />
            <button
              type="button"
              className="zk-copy-btn"
              onClick={() => handleCopy(`${copyKey}-img`, imgUrl)}
            >
              {copiedKey === `${copyKey}-img` ? '✓' : (locale === 'en' ? 'Copy Data URL' : '复制图片数据')}
            </button>
          </div>
        )}
        {copyableText && (
          <div className="zk-row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <code className="zk-code-pill">{copyableText}</code>
            <button
              type="button"
              className="zk-copy-btn"
              onClick={() => handleCopy(`${copyKey}-txt`, copyableText)}
            >
              {copiedKey === `${copyKey}-txt` ? '✓' : t('复制')}
            </button>
          </div>
        )}
        {structuredData !== undefined && <JsonView data={structuredData} />}
      </div>
    );
  };

  const runBatchAction = async (
    secKey: string,
    batchAction: DeclarativeBatchActionSpec<Record<string, unknown>, TData>,
    selectedRows: readonly Record<string, unknown>[],
    selectedKeys: readonly string[],
  ) => {
    setBusyAction(`batch:${secKey}:${batchAction.name}`);
    try {
      if (batchAction.onExecute) {
        await batchAction.onExecute(selectedRows, selectedKeys, ctx);
      } else if (pluginId) {
        const paramKey = batchAction.idsParamKey ?? 'ids';
        const payload = batchAction.params
          ? batchAction.params(selectedRows, selectedKeys, resource.data)
          : { [paramKey]: selectedKeys };
        await call(batchAction.name, payload);
      }
      const msg = batchAction.successMessage
        ? pickText(batchAction.successMessage, locale, t)
        : `${pickText(batchAction.label, locale, t)} (${selectedKeys.length}) ${t('已完成')}`;
      notify('success', msg);
      setSectionSelections((prev) => ({ ...prev, [secKey]: [] }));
      await resource.refresh();
    } catch (err) {
      notify('danger', formatError(err, t));
    } finally {
      setBusyAction('');
    }
  };

  const runRowAction = async (
    secKey: string,
    rowAction: DeclarativeRowActionSpec<Record<string, unknown>, TData>,
    row: Record<string, unknown>,
    rk: string,
  ) => {
    setBusyAction(`row:${secKey}:${rowAction.name}:${rk}`);
    try {
      if (rowAction.onExecute) {
        await rowAction.onExecute(row, rk, ctx);
      } else if (pluginId) {
        const paramKey = rowAction.idParamKey ?? 'id';
        const payload = rowAction.params
          ? rowAction.params(row, rk, resource.data)
          : { [paramKey]: rk };
        await call(rowAction.name, payload);
      }
      const msg = rowAction.successMessage
        ? pickText(rowAction.successMessage, locale, t)
        : `${pickText(rowAction.label, locale, t)} ${t('已完成')}`;
      notify('success', msg);
      await resource.refresh();
    } catch (err) {
      notify('danger', formatError(err, t));
    } finally {
      setBusyAction('');
    }
  };

  const data = resource.data;
  const resolvedTitle = pickText(spec.title, locale, t) || pageProps?.title || 'Plugin';
  const defaultMark = spec.mark ?? resolvedTitle.trim().slice(0, 1).toUpperCase();
  const badges = data !== undefined && spec.badges
    ? (typeof spec.badges === 'function' ? spec.badges(data, ctx) : spec.badges)
    : [];
  const stats = data !== undefined && spec.stats
    ? (typeof spec.stats === 'function' ? spec.stats(data, ctx) : spec.stats)
    : [];
  const headerActions = spec.actions?.filter((a) => !a.fields || a.fields.length === 0) ?? [];
  const formActions = spec.actions?.filter((a) => a.fields && a.fields.length > 0) ?? [];

  return (
    <PluginPage data-zhin-plugin-id={pluginId}>
      <style>{pluginUiStyles}{declarativeStyles}</style>
      <PageHeader
        mark={defaultMark}
        title={resolvedTitle}
        description={spec.description ? pickText(spec.description, locale, t) : undefined}
        actions={
          <div className="zk-row">
            {badges.map((b, idx) => {
              const tone = resolveBadgeTone(b.tone, data, locale, t);
              const label = typeof b.label === 'function'
                ? (data !== undefined ? b.label(data, ctx) : '')
                : isDeclarativeValueExpr(b.label)
                  ? evaluateDeclarativeExpr(b.label, data, locale, t)
                  : pickText(b.label, locale, t);
              return <Badge key={b.key ?? idx} tone={tone}>{label}</Badge>;
            })}
            {data !== undefined && resource.lastSuccessAt !== undefined && (
              <span className="zk-sync-meta zk-updated-badge" title={new Date(resource.lastSuccessAt).toLocaleString()}>
                {locale === 'en'
                  ? `Updated ${formatTimeHMS(resource.lastSuccessAt)}`
                  : `更新于 ${formatTimeHMS(resource.lastSuccessAt)}`}
              </span>
            )}
            {headerActions.map((action) => {
              const label = pickText(action.label, locale, t);
              const isDisabled = typeof action.disabled === 'function' ? action.disabled(data) : Boolean(action.disabled);
              const isBusy = busyAction === action.name;
              if (action.confirm) {
                return (
                  <ConfirmButton
                    key={action.name}
                    variant={action.variant ?? 'secondary'}
                    danger={action.variant === 'danger'}
                    disabled={isDisabled}
                    busy={isBusy}
                    confirmLabel={action.confirmLabel ? pickText(action.confirmLabel, locale, t) : label}
                    message={pickText(action.confirm, locale, t)}
                    onConfirm={() => runAction(action)}
                  >
                    {label}
                  </ConfirmButton>
                );
              }
              return (
                <Button
                  key={action.name}
                  variant={action.variant ?? 'secondary'}
                  icon={action.icon}
                  disabled={isDisabled}
                  busy={isBusy}
                  onClick={() => runAction(action)}
                >
                  {label}
                </Button>
              );
            })}
            {formActions.length > 0 && formActions.length <= 2 && (
              <a href="#zk-actions-section" className="zk-action-jump-pill">
                ⚡ {locale === 'en' ? 'Actions' : '快捷操作'}
              </a>
            )}
            <select
              aria-label={locale === 'en' ? 'Auto refresh interval' : '自动刷新间隔'}
              className="zk-refresh-select"
              value={String(pollIntervalMs)}
              onChange={(e) => setPollIntervalMs(Number(e.target.value))}
            >
              <option value="0">{locale === 'en' ? 'Manual Refresh' : '手动刷新'}</option>
              <option value="5000">{locale === 'en' ? '5s Auto' : '5s 自动'}</option>
              <option value="15000">{locale === 'en' ? '15s Auto' : '15s 自动'}</option>
              <option value="30000">{locale === 'en' ? '30s Auto' : '30s 自动'}</option>
              {![0, 5000, 15000, 30000].includes(pollIntervalMs) && (
                <option value={String(pollIntervalMs)}>
                  {locale === 'en' ? `${Math.round(pollIntervalMs / 1000)}s Auto` : `${Math.round(pollIntervalMs / 1000)}s 自动`}
                </option>
              )}
            </select>
            <Button busy={manualRefreshBusy} onClick={handleManualRefresh}>{t('刷新')}</Button>
          </div>
        }
      />

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(undefined)}>
          {notice.message}
        </Notice>
      )}
      {headerActions.map((a) =>
        actionResults[a.name] ? (
          <React.Fragment key={`header-res-${a.name}`}>
            {renderActionResultPreview(a.name, actionResults[a.name])}
          </React.Fragment>
        ) : null,
      )}

      {resource.state === 'loading' && <LoadingState />}
      {resource.state === 'error' && (
        <ErrorState
          title={t('加载失败')}
          message={formatError(resource.error, t)}
          details={resource.error?.message}
          onRetry={handleManualRefresh}
          retrying={manualRefreshBusy}
        />
      )}
      {resource.state === 'stale' && <StaleNotice lastSuccessAt={resource.lastSuccessAt} error={resource.error?.message} />}
      {resource.state === 'empty' && (
        <EmptyState
          title={spec.emptyTitle ? pickText(spec.emptyTitle, locale, t) : t('暂无数据')}
          description={spec.emptyDescription ? pickText(spec.emptyDescription, locale, t) : undefined}
        />
      )}

      {data !== undefined && resource.state !== 'empty' && stats.length > 0 && (
        <div className="zk-stats-grid">
          {stats.map((stat, idx) => {
            const val = typeof stat.value === 'function'
              ? stat.value(data, ctx)
              : evaluateDeclarativeExpr(stat.value, data, locale, t);
            const unitText = stat.unit ? pickText(stat.unit, locale, t) : undefined;
            const hint = typeof stat.hint === 'function'
              ? stat.hint(data)
              : isDeclarativeValueExpr(stat.hint)
                ? evaluateDeclarativeExpr(stat.hint, data, locale, t)
                : (stat.hint ? pickText(stat.hint, locale, t) : undefined);
            const badgeTone = stat.badge
              ? resolveBadgeTone(stat.badge.tone, data, locale, t)
              : undefined;
            const badgeLabel = stat.badge
              ? (typeof stat.badge.label === 'function'
                ? stat.badge.label(data)
                : isDeclarativeValueExpr(stat.badge.label)
                  ? evaluateDeclarativeExpr(stat.badge.label, data, locale, t)
                  : pickText(stat.badge.label, locale, t))
              : undefined;
            const rawProgress =
              typeof stat.progress === 'number'
                ? stat.progress
                : typeof stat.progress === 'string'
                  ? Number(resolveDataPath(data, stat.progress))
                  : isDeclarativeValueExpr(stat.progress)
                    ? Number(evaluateDeclarativeExpr(stat.progress, data, locale, t))
                    : undefined;
            const sparklineVals = stat.sparkline ? resolveDataPath(data, stat.sparkline) : undefined;
            const trendText = stat.trend
              ? (isDeclarativeValueExpr(stat.trend.value)
                ? evaluateDeclarativeExpr(stat.trend.value, data, locale, t)
                : pickText(stat.trend.value, locale, t))
              : undefined;
            const trendTone: BadgeTone =
              stat.trend?.direction === 'up' ? 'success' : stat.trend?.direction === 'down' ? 'danger' : 'neutral';
            const trendArrow =
              stat.trend?.direction === 'up' ? '↑ ' : stat.trend?.direction === 'down' ? '↓ ' : '';
            const cardTone = stat.tone ?? 'default';
            const chartTone = cardTone === 'neutral' || cardTone === 'default' ? 'primary' : cardTone;
            return (
              <div
                key={stat.key ?? idx}
                data-stat-tone={cardTone}
                className={`zk-stat-card zk-stat-card--${cardTone}`}
              >
                {stat.watermark && (
                  <span className="zk-stat-watermark" aria-hidden="true">
                    {typeof stat.watermark === 'string' && (stat.watermark.startsWith('http') || stat.watermark.startsWith('/') || stat.watermark.startsWith('data:')) ? (
                      <img src={stat.watermark} alt="" />
                    ) : (
                      stat.watermark
                    )}
                  </span>
                )}
                <div className="zk-stat-card__head">
                  <span className="zk-stat-card__label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {stat.image && <img src={stat.image} alt="" className="zk-stat-icon-img" />}
                    {stat.icon && <span>{stat.icon}</span>}
                    {pickText(stat.label, locale, t)}
                  </span>
                  {stat.badge && <Badge tone={badgeTone}>{badgeLabel}</Badge>}
                </div>
                <div className="zk-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div className="zk-stat-card__value tabular-nums">
                    {val}
                    {unitText && <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--zk-muted)', marginLeft: 4 }}>{unitText}</span>}
                  </div>
                  {trendText && (
                    <Badge tone={trendTone}>
                      {trendArrow}
                      {trendText}
                    </Badge>
                  )}
                  {Array.isArray(sparklineVals) && sparklineVals.length >= 2 && (
                    <Sparkline
                      values={sparklineVals.map(Number).filter(Number.isFinite)}
                      width={84}
                      height={26}
                      tone={chartTone}
                    />
                  )}
                </div>
                {rawProgress !== undefined && Number.isFinite(rawProgress) && (
                  <ProgressBar
                    value={rawProgress}
                    size="sm"
                    tone={chartTone}
                  />
                )}
                {hint && <span className="zk-hint">{hint}</span>}
              </div>
            );
          })}
        </div>
      )}

      {data !== undefined && resource.state !== 'empty' && formActions.length > 0 && (
        <Section id="zk-actions-section" title={t('操作')}>
          <div className="zk-action-grid">
            {formActions.map((action) => {
              const label = pickText(action.label, locale, t);
              const isBusy = busyAction === action.name;
              const isDisabled = typeof action.disabled === 'function' ? action.disabled(data) : Boolean(action.disabled);
              const currentValues = actionInputs[action.name] ?? {};
              const fieldsList = action.fields ?? [];
              const isMultiField = fieldsList.length >= 2;
              return (
                <div key={action.name} id={`zk-action-${action.name}`} className="zk-card zk-action-card">
                  <div className="zk-action-card__head">
                    <strong>{label}</strong>
                    {action.description && <p className="zk-hint">{pickText(action.description, locale, t)}</p>}
                  </div>
                  <div className={`zk-action-fields-grid grid grid-cols-1${isMultiField ? ' sm:grid-cols-2 zk-action-fields-grid--multi' : ''} gap-3`}>
                    {fieldsList.map((field) => {
                      const fieldVal = currentValues[field.key] ?? field.defaultValue ?? '';
                      const setVal = (nextVal: string) =>
                        setActionInputs((prev) => ({
                          ...prev,
                          [action.name]: { ...(prev[action.name] ?? {}), [field.key]: nextVal },
                        }));
                      const fieldLabelText = pickText(field.label, locale, t);
                      const fieldHint = field.hint ? pickText(field.hint, locale, t) : undefined;
                      const isFullWidth =
                        !isMultiField ||
                        field.type === 'textarea' ||
                        field.type === 'radio' ||
                        field.type === 'checkbox-group';
                      const wrapperClass = isFullWidth ? 'zk-field--full col-span-full' : undefined;
                      if (field.type === 'switch') {
                        return (
                          <div key={field.key} className={wrapperClass}>
                            <Switch
                              checked={fieldVal === 'true'}
                              onChange={(checked) => setVal(String(checked))}
                              label={fieldLabelText}
                              description={fieldHint}
                              disabled={isDisabled || isBusy}
                            />
                          </div>
                        );
                      }
                      if (field.type === 'radio' && field.options) {
                        return (
                          <div key={field.key} className={wrapperClass}>
                            <Field label={fieldLabelText} hint={fieldHint} required={field.required}>
                              <RadioGroup
                                value={fieldVal}
                                onChange={setVal}
                                variant={field.variant}
                                direction={field.direction}
                                options={field.options.map((opt) => ({
                                  value: opt.value,
                                  label: pickText(opt.label, locale, t),
                                  description: opt.description ? pickText(opt.description, locale, t) : undefined,
                                  icon: opt.icon,
                                  badge: opt.badge,
                                  disabled: opt.disabled || isDisabled || isBusy,
                                }))}
                              />
                            </Field>
                          </div>
                        );
                      }
                      if (field.type === 'checkbox-group' && field.options) {
                        const selectedList = fieldVal ? fieldVal.split(',').filter(Boolean) : [];
                        return (
                          <div key={field.key} className={wrapperClass}>
                            <Field label={fieldLabelText} hint={fieldHint} required={field.required}>
                              <CheckboxGroup
                                value={selectedList}
                                onChange={(next) => setVal(next.join(','))}
                                variant={field.variant === 'card' ? 'card' : 'default'}
                                direction={field.direction}
                                options={field.options.map((opt) => ({
                                  value: opt.value,
                                  label: pickText(opt.label, locale, t),
                                  description: opt.description ? pickText(opt.description, locale, t) : undefined,
                                  icon: opt.icon,
                                  badge: opt.badge,
                                  disabled: opt.disabled || isDisabled || isBusy,
                                }))}
                              />
                            </Field>
                          </div>
                        );
                      }
                      if (field.type === 'segmented' && field.options) {
                        return (
                          <div key={field.key} className={wrapperClass}>
                            <Field label={fieldLabelText} hint={fieldHint} required={field.required}>
                              <SegmentedControl
                                value={fieldVal || (field.options[0]?.value ?? '')}
                                onChange={setVal}
                                options={field.options.map((opt) => ({
                                  value: opt.value,
                                  label: pickText(opt.label, locale, t),
                                  icon: opt.icon,
                                  badge: opt.badge,
                                  disabled: opt.disabled || isDisabled || isBusy,
                                }))}
                              />
                            </Field>
                          </div>
                        );
                      }
                      return (
                        <div key={field.key} className={wrapperClass}>
                          <Field label={fieldLabelText} hint={fieldHint} required={field.required}>
                            {field.type === 'select' && field.options ? (
                              <Select
                                value={fieldVal}
                                placeholder={field.placeholder}
                                onValueChange={setVal}
                                options={field.options.map((opt) => ({
                                  value: opt.value,
                                  label: pickText(opt.label, locale, t),
                                  disabled: opt.disabled,
                                }))}
                              />
                            ) : field.type === 'textarea' ? (
                              <Textarea
                                rows={field.rows ?? 3}
                                placeholder={field.placeholder ?? (locale === 'en' ? `Enter ${fieldLabelText}…` : `请输入${fieldLabelText}…`)}
                                value={fieldVal}
                                onChange={(e) => setVal(e.target.value)}
                              />
                            ) : (
                              <input
                                className="zk-input"
                                type={field.secret || field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                                placeholder={field.placeholder ?? (locale === 'en' ? `Enter ${fieldLabelText}…` : `请输入${fieldLabelText}…`)}
                                value={fieldVal}
                                onChange={(e) => setVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !isBusy && !isDisabled) {
                                    e.preventDefault();
                                    void runAction(action);
                                  }
                                }}
                              />
                            )}
                          </Field>
                        </div>
                      );
                    })}
                  </div>
                  <div className="zk-row">
                    {action.confirm ? (
                      <ConfirmButton
                        variant={action.variant ?? 'primary'}
                        danger={action.variant === 'danger'}
                        disabled={isDisabled}
                        busy={isBusy}
                        confirmLabel={action.confirmLabel ? pickText(action.confirmLabel, locale, t) : label}
                        message={pickText(action.confirm, locale, t)}
                        onConfirm={() => runAction(action)}
                      >
                        {label}
                      </ConfirmButton>
                    ) : (
                      <Button variant={action.variant ?? 'primary'} icon={action.icon} busy={isBusy} disabled={isDisabled} onClick={() => runAction(action)}>
                        {label}
                      </Button>
                    )}
                  </div>
                  {renderActionResultPreview(action.name, actionResults[action.name])}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {data !== undefined && resource.state !== 'empty' && (() => {
        const allSections = spec.sections ?? [];
        const tabLabels = Array.from(
          new Set(allSections.map((s) => (s.tab ? pickText(s.tab, locale, t) : '')).filter(Boolean)),
        );
        const currentTab = activeTab && tabLabels.includes(activeTab) ? activeTab : (tabLabels[0] ?? '');
        const visibleSections = tabLabels.length > 1
          ? allSections.filter((s) => !s.tab || pickText(s.tab, locale, t) === currentTab)
          : allSections;

        return (
          <>
            {tabLabels.length > 1 && (
              <Tabs
                value={currentTab}
                onChange={setActiveTab}
                items={tabLabels.map((lbl) => ({ key: lbl, label: lbl }))}
              />
            )}
            {visibleSections.map((section, idx) => {
              const secKey = section.id ?? `sec-${idx}`;
              const rows: readonly Record<string, unknown>[] | undefined = section.items
                ? (typeof section.items === 'function'
                  ? section.items(data)
                  : (() => {
                      const resolved = resolveDataPath(data, section.items);
                      return Array.isArray(resolved) ? (resolved as readonly Record<string, unknown>[]) : [];
                    })())
                : undefined;
              const query = (sectionQueries[secKey] ?? '').trim().toLowerCase();
              const filteredRows = rows && query
                ? rows.filter((row) => {
                    const colVals = (section.columns ?? []).map((col) => resolveDataPath(row, col.key));
                    const rawVals = Object.values(row ?? {}).filter(
                      (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
                    );
                    return [...colVals, ...rawVals].some((v) => {
                      if (v === null || v === undefined) return false;
                      if (Array.isArray(v)) return v.map(String).join(' ').toLowerCase().includes(query);
                      if (typeof v === 'object') return false;
                      return String(v).toLowerCase().includes(query);
                    });
                  })
                : rows;
              const sortState = sectionSorts[secKey];
              const sortedRows = filteredRows && sortState
                ? [...filteredRows].sort((a, b) => {
                    const va = resolveDataPath(a, sortState.key);
                    const vb = resolveDataPath(b, sortState.key);
                    if (va === vb) return 0;
                    if (va === undefined || va === null) return 1;
                    if (vb === undefined || vb === null) return -1;
                    const cmp =
                      typeof va === 'number' && typeof vb === 'number'
                        ? va - vb
                        : String(va).localeCompare(String(vb), undefined, { numeric: true });
                    return sortState.dir === 'asc' ? cmp : -cmp;
                  })
                : filteredRows;
              const totalFiltered = sortedRows?.length ?? 0;
              const totalPages = Math.max(1, Math.ceil(totalFiltered / TABLE_PAGE_SIZE));
              const currentPage = Math.min(sectionPages[secKey] ?? 1, totalPages);
              const pagedRows = sortedRows
                ? sortedRows.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE)
                : undefined;

              const getRowKey = (row: Record<string, unknown>, fallbackIdx: number): string => {
                const raw =
                  (section.rowKey ? resolveDataPath(row, section.rowKey) : undefined) ??
                  row.id ??
                  row.key ??
                  row.ownerKey ??
                  (section.columns?.[0]?.key ? resolveDataPath(row, section.columns[0].key) : undefined) ??
                  fallbackIdx;
                return String(raw);
              };

              const isSelectable = Boolean(section.selectable || (section.batchActions && section.batchActions.length > 0));
              const hasExpandable = Boolean(section.renderExpandedRow);
              const hasRowActions = Boolean(section.rowActions && section.rowActions.length > 0);
              const selectedKeysForSec = sectionSelections[secKey] ?? [];
              const selectedKeySet = new Set(selectedKeysForSec);
              const expandedKeysForSec = sectionExpanded[secKey] ?? [];
              const expandedKeySet = new Set(expandedKeysForSec);

              const prefixLeftPx = (isSelectable ? 42 : 0) + (hasExpandable ? 40 : 0);
              const suffixRightPx = hasRowActions ? 96 : 0;
              const stickyMetas = section.columns
                ? computeStickyColumnMeta(section.columns, prefixLeftPx, suffixRightPx)
                : [];
              const anyFixedLeft = Boolean(section.columns?.some((c) => c.fixed === 'left'));
              const anyFixedRight = Boolean(section.columns?.some((c) => c.fixed === 'right'));

              const entries = section.entries
                ? (typeof section.entries === 'function'
                  ? section.entries(data, ctx)
                  : section.entries.map((entry) => {
                      const inferredKey =
                        entry.dataKey ??
                        (isDeclarativeValueExpr(entry.value) &&
                        typeof (entry.value as { $path?: unknown }).$path === 'string'
                          ? (entry.value as { $path: string }).$path
                          : undefined);
                      return {
                        key: inferredKey,
                        hint: entry.hint ? pickText(entry.hint, locale, t) : undefined,
                        label:
                          typeof entry.label === 'string' ||
                          (entry.label && typeof entry.label === 'object' && ('zh' in entry.label || 'en' in entry.label || 'zh-CN' in entry.label))
                            ? pickText(entry.label as DeclarativeI18nText, locale, t)
                            : entry.label,
                        value: isDeclarativeValueExpr(entry.value)
                          ? evaluateDeclarativeExpr(entry.value, data, locale, t)
                          : entry.dataKey
                            ? resolveDataPath(data, entry.dataKey)
                            : (entry.value as React.ReactNode),
                      };
                    }))
                : undefined;
              const entryList = entries
                ? (Array.isArray(entries)
                  ? entries
                  : Object.entries(entries).map(([label, value]) => ({ key: label, label, value })))
                : undefined;

              const currentPagedRows = pagedRows ?? rows ?? [];
              const currentPagedKeys = currentPagedRows.map((r, rIdx) =>
                getRowKey(r, (currentPage - 1) * TABLE_PAGE_SIZE + rIdx),
              );
              const allPageSelected =
                currentPagedKeys.length > 0 && currentPagedKeys.every((k) => selectedKeySet.has(k));
              const somePageSelected =
                !allPageSelected && currentPagedKeys.some((k) => selectedKeySet.has(k));
              const selectedRowObjects = (rows ?? []).filter((r, rIdx) =>
                selectedKeySet.has(getRowKey(r, rIdx)),
              );

              const sectionBody = (
                <>
                  {section.render && section.render(data, ctx)}
                  {section.layout === 'json' && <JsonView data={rows ?? entryList ?? data} />}
                  {entryList && section.layout !== 'json' && (
                    section.columnsCount && section.columnsCount > 1 ? (
                      <DescriptionList
                        columns={section.columnsCount}
                        bordered
                        items={entryList.map((entry, entryIdx) => {
                          const entryFieldKey = (entry as { key?: string }).key ?? (typeof entry.label === 'string' ? entry.label : undefined);
                          return {
                            label: entry.label,
                            hint: (entry as { hint?: React.ReactNode }).hint,
                            value: renderSmartValue(
                              entry.value,
                              entryFieldKey,
                              `${secKey}-entry-${entryIdx}`,
                              copiedKey,
                              handleCopy,
                              t,
                            ),
                          };
                        })}
                      />
                    ) : (
                      <div className="zk-entries-grid grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {entryList.map((entry, entryIdx) => {
                          const entryFieldKey = (entry as { key?: string }).key ?? (typeof entry.label === 'string' ? entry.label : undefined);
                          const copyId = `${secKey}-entry-${entryIdx}`;
                          const rawVal = entry.value;
                          const copyText =
                            typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean'
                              ? String(rawVal).trim()
                              : '';
                          const isAlreadyCopyable =
                            (typeof rawVal === 'string' && /^https?:\/\/\S+$/iu.test(rawVal.trim())) ||
                            Boolean(entryFieldKey && CODE_KEY_PATTERN.test(entryFieldKey));
                          const canQuickCopy = Boolean(copyText && copyText !== '-' && copyText !== '—' && !isAlreadyCopyable);
                          return (
                            <div key={entryIdx} className="zk-entry-card">
                              <div className="zk-entry-card__meta">
                                <span className="zk-entry-card__label">{entry.label}</span>
                                {(entry as { hint?: React.ReactNode }).hint && (
                                  <span className="zk-hint">{(entry as { hint?: React.ReactNode }).hint}</span>
                                )}
                              </div>
                              <div className="zk-entry-card__value">
                                {renderSmartValue(
                                  rawVal,
                                  entryFieldKey,
                                  copyId,
                                  copiedKey,
                                  handleCopy,
                                  t,
                                )}
                                {canQuickCopy && (
                                  <button
                                    type="button"
                                    className="zk-copy-btn"
                                    onClick={() => handleCopy(copyId, copyText)}
                                  >
                                    {copiedKey === copyId ? '✓' : t('复制')}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                  {rows && section.layout !== 'json' && (
                    rows.length === 0 ? (
                      <EmptyState title={section.emptyText ? pickText(section.emptyText, locale, t) : t('暂无数据')} />
                    ) : pagedRows && pagedRows.length === 0 ? (
                      <EmptyState
                        title={locale === 'en' ? 'No matching rows' : '无匹配记录'}
                        action={
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSectionQueries((prev) => ({ ...prev, [secKey]: '' }))}
                          >
                            {locale === 'en' ? 'Clear filter' : '清除过滤'}
                          </Button>
                        }
                      />
                    ) : section.layout === 'timeline' ? (
                      <div className="zk-card">
                        <Timeline
                          items={(pagedRows ?? rows).map((row, rowIdx) => ({
                            id: String(row.id ?? row.key ?? rowIdx),
                            title: String(row.title ?? row.name ?? row.label ?? row.id ?? `#${rowIdx + 1}`),
                            description: row.description !== undefined ? String(row.description) : (row.summary !== undefined ? String(row.summary) : undefined),
                            time: row.time !== undefined ? String(row.time) : (row.createdAt !== undefined ? String(row.createdAt) : undefined),
                            tone: (typeof row.tone === 'string' ? row.tone : classifySemanticStatus(String(row.status ?? ''))) as 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | undefined,
                            badge: row.status !== undefined ? renderSmartValue(row.status, 'status', `${secKey}-tl-${rowIdx}`, copiedKey, handleCopy, t) : undefined,
                          }))}
                        />
                      </div>
                    ) : section.columns && section.columns.length > 0 && section.layout !== 'cards' ? (
                      <div className="zk-stack" style={{ gap: 10 }}>
                        {isSelectable && selectedKeysForSec.length > 0 && (
                          <div role="region" aria-label={t('批量操作')} className="zk-batch-bar">
                            <div className="zk-batch-bar__info">
                              <Badge tone="primary">{t('已选 {0} 项', selectedKeysForSec.length)}</Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSectionSelections((prev) => ({ ...prev, [secKey]: [] }))}
                              >
                                {t('清空选择')}
                              </Button>
                            </div>
                            <div className="zk-batch-bar__actions">
                              {(section.batchActions ?? []).map((ba) => {
                                const baLabel = pickText(ba.label, locale, t);
                                const baBusy = busyAction === `batch:${secKey}:${ba.name}`;
                                if (ba.confirm) {
                                  return (
                                    <ConfirmButton
                                      key={ba.name}
                                      size="sm"
                                      variant={ba.variant ?? 'primary'}
                                      danger={ba.variant === 'danger'}
                                      busy={baBusy}
                                      confirmLabel={ba.confirmLabel ? pickText(ba.confirmLabel, locale, t) : baLabel}
                                      message={pickText(ba.confirm, locale, t)}
                                      onConfirm={() => runBatchAction(secKey, ba, selectedRowObjects, selectedKeysForSec)}
                                    >
                                      {baLabel}
                                    </ConfirmButton>
                                  );
                                }
                                return (
                                  <Button
                                    key={ba.name}
                                    size="sm"
                                    variant={ba.variant ?? 'primary'}
                                    icon={ba.icon}
                                    busy={baBusy}
                                    onClick={() => runBatchAction(secKey, ba, selectedRowObjects, selectedKeysForSec)}
                                  >
                                    {baLabel}
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="zk-table-wrap">
                          <table className={`zk-table${section.responsiveStack ? ' zk-table--responsive' : ''}`}>
                            <thead>
                              <tr>
                                {isSelectable && (
                                  <th
                                    style={{ width: 42, ...(anyFixedLeft ? { left: 0 } : {}) }}
                                    className={anyFixedLeft ? 'zk-cell-fixed-left' : undefined}
                                  >
                                    <Checkbox
                                      checked={allPageSelected}
                                      indeterminate={somePageSelected}
                                      ariaLabel={allPageSelected ? t('取消全选') : t('全选当前页')}
                                      onChange={(nextChecked) => {
                                        setSectionSelections((prev) => {
                                          const set = new Set(prev[secKey] ?? []);
                                          for (const k of currentPagedKeys) {
                                            if (nextChecked) set.add(k);
                                            else set.delete(k);
                                          }
                                          return { ...prev, [secKey]: Array.from(set) };
                                        });
                                      }}
                                    />
                                  </th>
                                )}
                                {hasExpandable && (
                                  <th
                                    style={{ width: 40, ...(anyFixedLeft ? { left: isSelectable ? 42 : 0 } : {}) }}
                                    className={anyFixedLeft ? 'zk-cell-fixed-left' : undefined}
                                  />
                                )}
                                {section.columns.map((col, colIdx) => {
                                  const isSorted = sortState?.key === col.key;
                                  const canSort = col.sortable !== false && rows.length >= 1;
                                  const sticky = stickyMetas[colIdx];
                                  return (
                                    <th
                                      key={col.key}
                                      className={sticky?.className}
                                      style={{
                                        ...(col.align ? { textAlign: col.align } : {}),
                                        ...(col.width ? { width: typeof col.width === 'number' ? `${col.width}px` : col.width } : {}),
                                        ...(sticky?.style ?? {}),
                                      }}
                                    >
                                      {canSort ? (
                                        <button
                                          type="button"
                                          className="zk-th-sort"
                                          onClick={() =>
                                            setSectionSorts((prev) => {
                                              const cur = prev[secKey];
                                              const next =
                                                !cur || cur.key !== col.key
                                                  ? { key: col.key, dir: 'asc' as const }
                                                  : cur.dir === 'asc'
                                                    ? { key: col.key, dir: 'desc' as const }
                                                    : undefined;
                                              return { ...prev, [secKey]: next };
                                            })
                                          }
                                        >
                                          {col.icon}
                                          <span>{pickText(col.label, locale, t)}</span>
                                          <span className="zk-th-sort__indicator" aria-hidden="true">
                                            {isSorted ? (sortState?.dir === 'asc' ? '↑' : '↓') : '↕'}
                                          </span>
                                        </button>
                                      ) : (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                          {col.icon}
                                          <span>{pickText(col.label, locale, t)}</span>
                                        </span>
                                      )}
                                    </th>
                                  );
                                })}
                                {hasRowActions && (
                                  <th
                                    className={anyFixedRight ? 'zk-cell-fixed-right' : 'zk-cell-fixed-right zk-cell-fixed-right-first'}
                                    style={{ width: 96, right: 0, textAlign: 'right' }}
                                  >
                                    {t('操作')}
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {(pagedRows ?? rows).map((row, rowIdx) => {
                                const globalIdx = (currentPage - 1) * TABLE_PAGE_SIZE + rowIdx;
                                const rk = getRowKey(row, globalIdx);
                                const isRowSelected = selectedKeySet.has(rk);
                                const isRowExpanded = expandedKeySet.has(rk);
                                const totalColSpan =
                                  (section.columns?.length ?? 0) +
                                  (isSelectable ? 1 : 0) +
                                  (hasExpandable ? 1 : 0) +
                                  (hasRowActions ? 1 : 0);
                                return (
                                  <React.Fragment key={rk}>
                                    <tr className={isRowSelected ? 'zk-row-selected' : undefined}>
                                      {isSelectable && (
                                        <td
                                          style={anyFixedLeft ? { left: 0 } : undefined}
                                          className={anyFixedLeft ? 'zk-cell-fixed-left' : undefined}
                                        >
                                          <Checkbox
                                            checked={isRowSelected}
                                            ariaLabel={t('选择行')}
                                            onChange={(nextChecked) => {
                                              setSectionSelections((prev) => {
                                                const set = new Set(prev[secKey] ?? []);
                                                if (nextChecked) set.add(rk);
                                                else set.delete(rk);
                                                return { ...prev, [secKey]: Array.from(set) };
                                              });
                                            }}
                                          />
                                        </td>
                                      )}
                                      {hasExpandable && (
                                        <td
                                          style={anyFixedLeft ? { left: isSelectable ? 42 : 0 } : undefined}
                                          className={anyFixedLeft ? 'zk-cell-fixed-left' : undefined}
                                        >
                                          <button
                                            type="button"
                                            aria-expanded={isRowExpanded}
                                            aria-label={isRowExpanded ? t('收起详情') : t('展开详情')}
                                            onClick={() => {
                                              setSectionExpanded((prev) => {
                                                const set = new Set(prev[secKey] ?? []);
                                                if (set.has(rk)) set.delete(rk);
                                                else set.add(rk);
                                                return { ...prev, [secKey]: Array.from(set) };
                                              });
                                            }}
                                            className="zk-table-expand-btn"
                                          >
                                            ▸
                                          </button>
                                        </td>
                                      )}
                                      {(section.columns ?? []).map((col, colIdx) => {
                                        const cellVal = resolveDataPath(row, col.key);
                                        const sticky = stickyMetas[colIdx];
                                        return (
                                          <td
                                            key={col.key}
                                            data-label={pickText(col.label, locale, t)}
                                            className={sticky?.className}
                                            style={{
                                              ...(col.align ? { textAlign: col.align } : {}),
                                              ...(sticky?.style ?? {}),
                                            }}
                                          >
                                            {col.render
                                              ? col.render(cellVal, row, ctx)
                                              : renderSmartValue(
                                                  cellVal,
                                                  col.key,
                                                  `${secKey}-r${globalIdx}-${col.key}`,
                                                  copiedKey,
                                                  handleCopy,
                                                  t,
                                                  col,
                                                )}
                                          </td>
                                        );
                                      })}
                                      {hasRowActions && (
                                        <td
                                          data-label={t('操作')}
                                          className={anyFixedRight ? 'zk-cell-fixed-right' : 'zk-cell-fixed-right zk-cell-fixed-right-first'}
                                          style={{ width: 96, right: 0, textAlign: 'right' }}
                                        >
                                          <div className="zk-row" style={{ justifyContent: 'flex-end' }}>
                                            {(section.rowActions ?? []).map((ra) => {
                                              const raLabel = pickText(ra.label, locale, t);
                                              const raDisabled = typeof ra.disabled === 'function' ? ra.disabled(row) : Boolean(ra.disabled);
                                              const raBusy = busyAction === `row:${secKey}:${ra.name}:${rk}`;
                                              if (ra.confirm) {
                                                return (
                                                  <ConfirmButton
                                                    key={ra.name}
                                                    size="sm"
                                                    variant={ra.variant ?? 'ghost'}
                                                    danger={ra.variant === 'danger'}
                                                    disabled={raDisabled}
                                                    busy={raBusy}
                                                    confirmLabel={ra.confirmLabel ? pickText(ra.confirmLabel, locale, t) : raLabel}
                                                    message={pickText(ra.confirm, locale, t)}
                                                    onConfirm={() => runRowAction(secKey, ra, row, rk)}
                                                  >
                                                    {raLabel}
                                                  </ConfirmButton>
                                                );
                                              }
                                              return (
                                                <Button
                                                  key={ra.name}
                                                  size="sm"
                                                  variant={ra.variant ?? 'ghost'}
                                                  icon={ra.icon}
                                                  disabled={raDisabled}
                                                  busy={raBusy}
                                                  onClick={() => runRowAction(secKey, ra, row, rk)}
                                                >
                                                  {raLabel}
                                                </Button>
                                              );
                                            })}
                                          </div>
                                        </td>
                                      )}
                                    </tr>
                                    {hasExpandable && isRowExpanded && section.renderExpandedRow && (
                                      <tr className="zk-table-expanded-row">
                                        <td colSpan={totalColSpan}>
                                          {section.renderExpandedRow(row, globalIdx, ctx)}
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                          {totalPages > 1 && (
                            <div className="zk-pagination">
                              <span>
                                {locale === 'en'
                                  ? `Page ${currentPage} of ${totalPages} (${totalFiltered} items)`
                                  : `第 ${currentPage} / ${totalPages} 页（共 ${totalFiltered} 条）`}
                              </span>
                              <div className="zk-row">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={currentPage <= 1}
                                  onClick={() =>
                                    setSectionPages((prev) => ({ ...prev, [secKey]: Math.max(1, currentPage - 1) }))
                                  }
                                >
                                  {locale === 'en' ? 'Previous' : '上一页'}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={currentPage >= totalPages}
                                  onClick={() =>
                                    setSectionPages((prev) => ({ ...prev, [secKey]: Math.min(totalPages, currentPage + 1) }))
                                  }
                                >
                                  {locale === 'en' ? 'Next' : '下一页'}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : section.renderItem ? (
                      <ul className="zk-list">
                        {(pagedRows ?? rows).map((row, rowIdx) => {
                          const globalIdx = (currentPage - 1) * TABLE_PAGE_SIZE + rowIdx;
                          return (
                            <li key={String(row.id ?? row.key ?? row.ownerKey ?? globalIdx)} className="zk-card">
                              {section.renderItem?.(row, globalIdx, ctx)}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <ul className="zk-list">
                        {(pagedRows ?? rows).map((row, rowIdx) => {
                          const globalIdx = (currentPage - 1) * TABLE_PAGE_SIZE + rowIdx;
                          return (
                            <li key={String(row.id ?? row.key ?? row.ownerKey ?? globalIdx)} className="zk-card">
                              <dl className="zk-dl">
                                {Object.entries(row).map(([k, v]) => (
                                  <React.Fragment key={k}>
                                    <dt>{k}</dt>
                                    <dd>
                                      {renderSmartValue(
                                        v,
                                        k,
                                        `${secKey}-card-${globalIdx}-${k}`,
                                        copiedKey,
                                        handleCopy,
                                        t,
                                      )}
                                    </dd>
                                  </React.Fragment>
                                ))}
                              </dl>
                            </li>
                          );
                        })}
                      </ul>
                    )
                  )}
                </>
              );

              if (section.collapsible) {
                return (
                  <Collapsible
                    key={secKey}
                    title={section.title ? pickText(section.title, locale, t) : secKey}
                    subtitle={section.description ? pickText(section.description, locale, t) : undefined}
                    defaultOpen={!section.defaultCollapsed}
                    badge={rows ? <Badge tone="neutral">{t('共 {0} 条', rows.length)}</Badge> : undefined}
                  >
                    {sectionBody}
                  </Collapsible>
                );
              }

              return (
                <Section
                  key={secKey}
                  id={section.id}
                  title={section.title ? pickText(section.title, locale, t) : undefined}
                  description={section.description ? pickText(section.description, locale, t) : undefined}
                  actions={
                    rows && (rows.length > 0 || query.length > 0) ? (
                      <div className="zk-table-toolbar">
                        {(rows.length > 4 || query.length > 0) && (
                          <input
                            type="search"
                            className="zk-search-input"
                            placeholder={locale === 'en' ? 'Search table…' : '搜索表格内容…'}
                            value={sectionQueries[secKey] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSectionQueries((prev) => ({ ...prev, [secKey]: val }));
                              setSectionPages((prev) => ({ ...prev, [secKey]: 1 }));
                            }}
                          />
                        )}
                        <Badge tone="neutral">
                          {query
                            ? (locale === 'en' ? `${totalFiltered} / ${rows.length} items` : `共 ${totalFiltered} / ${rows.length} 条`)
                            : t('共 {0} 条', rows.length)}
                        </Badge>
                      </div>
                    ) : undefined
                  }
                >
                  {sectionBody}
                </Section>
              );
            })}
          </>
        );
      })()}

      {data !== undefined && resource.state !== 'empty' && spec.render && spec.render(data, ctx)}
      {spec.footnote && <p className="zk-footnote">{pickText(spec.footnote, locale, t)}</p>}
    </PluginPage>
  );
}

export interface DataTableBatchAction<TRow = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  readonly variant?: ButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  readonly disabled?: boolean | ((selectedRows: readonly TRow[], selectedKeys: readonly string[]) => boolean);
  readonly onExecute: (selectedRows: readonly TRow[], selectedKeys: readonly string[]) => unknown;
}

export interface DataTableRowAction<TRow = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  readonly variant?: ButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  readonly disabled?: boolean | ((row: TRow, index: number) => boolean);
  readonly onExecute: (row: TRow, index: number) => unknown;
}

export interface DataTableProps<TRow = Record<string, unknown>> {
  readonly columns: readonly {
    readonly key: keyof TRow & string;
    readonly label: DeclarativeI18nText;
    readonly icon?: React.ReactNode;
    readonly type?: DeclarativeColumnType;
    readonly align?: 'left' | 'center' | 'right';
    /** 固定列位置（水平滚动时粘性锁定在左侧或右侧并附带边缘阴影）。 */
    readonly fixed?: 'left' | 'right';
    readonly sortable?: boolean;
    readonly copyable?: boolean;
    readonly width?: string | number;
    readonly toneMap?: Readonly<Record<string, BadgeTone>>;
    readonly render?: (value: unknown, row: TRow, index: number) => React.ReactNode;
  }[];
  readonly rows: readonly TRow[];
  readonly rowKey?: keyof TRow & string;
  readonly searchable?: boolean;
  readonly pageSize?: number;
  readonly emptyTitle?: DeclarativeI18nText;
  readonly actions?: React.ReactNode;
  /** 是否开启多选行（配置 `batchActions` 时自动开启）。 */
  readonly selectable?: boolean;
  /** 受控选中行 Key 列表。 */
  readonly selectedKeys?: readonly string[];
  /** 选中行变化回调。 */
  readonly onSelectionChange?: (selectedKeys: string[], selectedRows: TRow[]) => void;
  /** 顶部浮动批量操作栏配置。 */
  readonly batchActions?: readonly DataTableBatchAction<TRow>[];
  /** 固定在右侧的行级操作按钮配置。 */
  readonly rowActions?: readonly DataTableRowAction<TRow>[];
  /** 可展开详情行渲染函数。 */
  readonly renderExpandedRow?: (row: TRow, index: number) => React.ReactNode;
  /** 小屏下是否自动将表格行堆叠为响应式卡片（带 `data-label`）。 */
  readonly responsiveStack?: boolean;
}

/** 通用数据表格组件：自带搜索过滤、列点击排序、分页、粘性固定列（fixed）、多选与批量操作栏（batchActions）、可展开详情行、响应式堆叠与智能单元格格式化。 */
export function DataTable<TRow extends Record<string, unknown> = Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  searchable = true,
  pageSize = TABLE_PAGE_SIZE,
  emptyTitle,
  actions,
  selectable,
  selectedKeys: controlledSelectedKeys,
  onSelectionChange,
  batchActions,
  rowActions,
  renderExpandedRow,
  responsiveStack = false,
}: DataTableProps<TRow>) {
  const { locale, t } = useLocale();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ readonly key: string; readonly dir: 'asc' | 'desc' } | undefined>();
  const [copiedKey, setCopiedKey] = useState('');
  const [internalSelected, setInternalSelected] = useState<readonly string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>([]);

  const isSelectable = Boolean(selectable || (batchActions && batchActions.length > 0) || onSelectionChange);
  const hasExpandable = Boolean(renderExpandedRow);
  const hasRowActions = Boolean(rowActions && rowActions.length > 0);
  const activeSelectedKeys = controlledSelectedKeys ?? internalSelected;
  const selectedKeySet = useMemo(() => new Set(activeSelectedKeys), [activeSelectedKeys]);
  const expandedKeySet = useMemo(() => new Set(expandedKeys), [expandedKeys]);

  const getRowKey = useCallback(
    (row: TRow, fallbackIdx: number): string => {
      const raw =
        (rowKey ? resolveDataPath(row, rowKey) : undefined) ??
        row.id ??
        row.key ??
        row.ownerKey ??
        (columns[0]?.key ? resolveDataPath(row, columns[0].key) : undefined) ??
        fallbackIdx;
      return String(raw);
    },
    [rowKey, columns],
  );

  const updateSelection = useCallback(
    (nextKeys: string[]) => {
      if (controlledSelectedKeys === undefined) {
        setInternalSelected(nextKeys);
      }
      if (onSelectionChange) {
        const nextSet = new Set(nextKeys);
        const nextRows = rows.filter((r, idx) => nextSet.has(getRowKey(r, idx)));
        onSelectionChange(nextKeys, nextRows);
      }
    },
    [controlledSelectedKeys, onSelectionChange, rows, getRowKey],
  );

  const handleCopy = useCallback((key: string, text: string) => {
    try {
      void globalThis.navigator?.clipboard?.writeText?.(text);
    } catch {
      // ignore
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? '' : prev)), 1_500);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter((row) => {
      const colVals = columns.map((col) => resolveDataPath(row, col.key));
      const rawVals = Object.values(row ?? {}).filter(
        (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
      );
      return [...colVals, ...rawVals].some(
        (v) => v !== null && v !== undefined && typeof v !== 'object' && String(v).toLowerCase().includes(q),
      );
    });
  }, [rows, columns, q]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    return [...filtered].sort((a, b) => {
      const va = resolveDataPath(a, sort.key);
      const vb = resolveDataPath(b, sort.key);
      if (va === vb) return 0;
      if (va === undefined || va === null) return 1;
      if (vb === undefined || vb === null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const prefixLeftPx = (isSelectable ? 42 : 0) + (hasExpandable ? 40 : 0);
  const suffixRightPx = hasRowActions ? 96 : 0;
  const stickyMetas = useMemo(
    () => computeStickyColumnMeta(columns, prefixLeftPx, suffixRightPx),
    [columns, prefixLeftPx, suffixRightPx],
  );
  const anyFixedLeft = useMemo(() => columns.some((c) => c.fixed === 'left'), [columns]);
  const anyFixedRight = useMemo(() => columns.some((c) => c.fixed === 'right'), [columns]);

  const currentPagedKeys = useMemo(
    () => paged.map((r, rIdx) => getRowKey(r, (currentPage - 1) * pageSize + rIdx)),
    [paged, currentPage, pageSize, getRowKey],
  );
  const allPageSelected =
    currentPagedKeys.length > 0 && currentPagedKeys.every((k) => selectedKeySet.has(k));
  const somePageSelected =
    !allPageSelected && currentPagedKeys.some((k) => selectedKeySet.has(k));
  const selectedRows = useMemo(
    () => rows.filter((r, idx) => selectedKeySet.has(getRowKey(r, idx))),
    [rows, selectedKeySet, getRowKey],
  );

  return (
    <div className="zk-stack" style={{ gap: 10 }}>
      {(searchable && (rows.length >= 3 || q.length > 0)) || actions ? (
        <div className="zk-section__head">
          <div className="zk-table-toolbar">
            {searchable && (rows.length >= 3 || q.length > 0) && (
              <input
                type="search"
                className="zk-search-input"
                placeholder={t('搜索…')}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            )}
            <span className="zk-count">
              {q ? `${sorted.length} / ${rows.length}` : t('共 {0} 条', rows.length)}
            </span>
          </div>
          {actions && <div className="zk-row">{actions}</div>}
        </div>
      ) : null}

      {isSelectable && activeSelectedKeys.length > 0 && (
        <div role="region" aria-label={t('批量操作')} className="zk-batch-bar">
          <div className="zk-batch-bar__info">
            <Badge tone="primary">{t('已选 {0} 项', activeSelectedKeys.length)}</Badge>
            <Button variant="ghost" size="sm" onClick={() => updateSelection([])}>
              {t('清空选择')}
            </Button>
          </div>
          <div className="zk-batch-bar__actions">
            {(batchActions ?? []).map((ba, baIdx) => {
              const baLabel = pickText(ba.label, locale, t);
              const baDisabled =
                typeof ba.disabled === 'function'
                  ? ba.disabled(selectedRows, activeSelectedKeys)
                  : Boolean(ba.disabled);
              if (ba.confirm) {
                return (
                  <ConfirmButton
                    key={ba.key ?? baIdx}
                    size="sm"
                    variant={ba.variant ?? 'primary'}
                    danger={ba.variant === 'danger'}
                    disabled={baDisabled}
                    confirmLabel={ba.confirmLabel ? pickText(ba.confirmLabel, locale, t) : baLabel}
                    message={pickText(ba.confirm, locale, t)}
                    onConfirm={() => ba.onExecute(selectedRows, activeSelectedKeys)}
                  >
                    {baLabel}
                  </ConfirmButton>
                );
              }
              return (
                <Button
                  key={ba.key ?? baIdx}
                  size="sm"
                  variant={ba.variant ?? 'primary'}
                  icon={ba.icon}
                  disabled={baDisabled}
                  onClick={() => ba.onExecute(selectedRows, activeSelectedKeys)}
                >
                  {baLabel}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title={emptyTitle ? pickText(emptyTitle, locale, t) : t('暂无数据')} />
      ) : paged.length === 0 ? (
        <EmptyState
          title={locale === 'en' ? 'No matching rows' : '无匹配记录'}
          action={
            <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
              {t('清空')}
            </Button>
          }
        />
      ) : (
        <div className="zk-table-wrap">
          <table className={`zk-table${responsiveStack ? ' zk-table--responsive' : ''}`}>
            <thead>
              <tr>
                {isSelectable && (
                  <th
                    style={{ width: 42, ...(anyFixedLeft ? { left: 0 } : {}) }}
                    className={anyFixedLeft ? 'zk-cell-fixed-left' : undefined}
                  >
                    <Checkbox
                      checked={allPageSelected}
                      indeterminate={somePageSelected}
                      ariaLabel={allPageSelected ? t('取消全选') : t('全选当前页')}
                      onChange={(nextChecked) => {
                        const set = new Set(activeSelectedKeys);
                        for (const k of currentPagedKeys) {
                          if (nextChecked) set.add(k);
                          else set.delete(k);
                        }
                        updateSelection(Array.from(set));
                      }}
                    />
                  </th>
                )}
                {hasExpandable && (
                  <th
                    style={{ width: 40, ...(anyFixedLeft ? { left: isSelectable ? 42 : 0 } : {}) }}
                    className={anyFixedLeft ? 'zk-cell-fixed-left' : undefined}
                  />
                )}
                {columns.map((col, colIdx) => {
                  const isSorted = sort?.key === col.key;
                  const canSort = col.sortable !== false && rows.length >= 2;
                  const sticky = stickyMetas[colIdx];
                  return (
                    <th
                      key={col.key}
                      className={sticky?.className}
                      style={{
                        ...(col.align ? { textAlign: col.align } : {}),
                        ...(col.width ? { width: typeof col.width === 'number' ? `${col.width}px` : col.width } : {}),
                        ...(sticky?.style ?? {}),
                      }}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          className="zk-th-sort"
                          onClick={() =>
                            setSort((cur) =>
                              !cur || cur.key !== col.key
                                ? { key: col.key, dir: 'asc' }
                                : cur.dir === 'asc'
                                  ? { key: col.key, dir: 'desc' }
                                  : undefined,
                            )
                          }
                        >
                          {col.icon}
                          <span>{pickText(col.label, locale, t)}</span>
                          {isSorted && <span aria-hidden="true">{sort?.dir === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {col.icon}
                          <span>{pickText(col.label, locale, t)}</span>
                        </span>
                      )}
                    </th>
                  );
                })}
                {hasRowActions && (
                  <th
                    className={anyFixedRight ? 'zk-cell-fixed-right' : 'zk-cell-fixed-right zk-cell-fixed-right-first'}
                    style={{ width: 96, right: 0, textAlign: 'right' }}
                  >
                    {t('操作')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {paged.map((row, rowIdx) => {
                const globalIdx = (currentPage - 1) * pageSize + rowIdx;
                const rk = getRowKey(row, globalIdx);
                const isRowSelected = selectedKeySet.has(rk);
                const isRowExpanded = expandedKeySet.has(rk);
                const totalColSpan =
                  columns.length +
                  (isSelectable ? 1 : 0) +
                  (hasExpandable ? 1 : 0) +
                  (hasRowActions ? 1 : 0);
                return (
                  <React.Fragment key={rk}>
                    <tr className={isRowSelected ? 'zk-row-selected' : undefined}>
                      {isSelectable && (
                        <td
                          style={anyFixedLeft ? { left: 0 } : undefined}
                          className={anyFixedLeft ? 'zk-cell-fixed-left' : undefined}
                        >
                          <Checkbox
                            checked={isRowSelected}
                            ariaLabel={t('选择行')}
                            onChange={(nextChecked) => {
                              const set = new Set(activeSelectedKeys);
                              if (nextChecked) set.add(rk);
                              else set.delete(rk);
                              updateSelection(Array.from(set));
                            }}
                          />
                        </td>
                      )}
                      {hasExpandable && (
                        <td
                          style={anyFixedLeft ? { left: isSelectable ? 42 : 0 } : undefined}
                          className={anyFixedLeft ? 'zk-cell-fixed-left' : undefined}
                        >
                          <button
                            type="button"
                            aria-expanded={isRowExpanded}
                            aria-label={isRowExpanded ? t('收起详情') : t('展开详情')}
                            onClick={() => {
                              setExpandedKeys((prev) => {
                                const set = new Set(prev);
                                if (set.has(rk)) set.delete(rk);
                                else set.add(rk);
                                return Array.from(set);
                              });
                            }}
                            className="zk-table-expand-btn"
                          >
                            ▸
                          </button>
                        </td>
                      )}
                      {columns.map((col, colIdx) => {
                        const cellVal = resolveDataPath(row, col.key);
                        const sticky = stickyMetas[colIdx];
                        return (
                          <td
                            key={col.key}
                            data-label={pickText(col.label, locale, t)}
                            className={sticky?.className}
                            style={{
                              ...(col.align ? { textAlign: col.align } : {}),
                              ...(sticky?.style ?? {}),
                            }}
                          >
                            {col.render
                              ? col.render(cellVal, row, globalIdx)
                              : renderSmartValue(
                                  cellVal,
                                  col.key,
                                  `dt-r${globalIdx}-${col.key}`,
                                  copiedKey,
                                  handleCopy,
                                  t,
                                  col,
                                )}
                          </td>
                        );
                      })}
                      {hasRowActions && (
                        <td
                          data-label={t('操作')}
                          className={anyFixedRight ? 'zk-cell-fixed-right' : 'zk-cell-fixed-right zk-cell-fixed-right-first'}
                          style={{ width: 96, right: 0, textAlign: 'right' }}
                        >
                          <div className="zk-row" style={{ justifyContent: 'flex-end' }}>
                            {(rowActions ?? []).map((ra, raIdx) => {
                              const raLabel = pickText(ra.label, locale, t);
                              const raDisabled =
                                typeof ra.disabled === 'function' ? ra.disabled(row, globalIdx) : Boolean(ra.disabled);
                              if (ra.confirm) {
                                return (
                                  <ConfirmButton
                                    key={ra.key ?? raIdx}
                                    size="sm"
                                    variant={ra.variant ?? 'ghost'}
                                    danger={ra.variant === 'danger'}
                                    disabled={raDisabled}
                                    confirmLabel={ra.confirmLabel ? pickText(ra.confirmLabel, locale, t) : raLabel}
                                    message={pickText(ra.confirm, locale, t)}
                                    onConfirm={() => ra.onExecute(row, globalIdx)}
                                  >
                                    {raLabel}
                                  </ConfirmButton>
                                );
                              }
                              return (
                                <Button
                                  key={ra.key ?? raIdx}
                                  size="sm"
                                  variant={ra.variant ?? 'ghost'}
                                  icon={ra.icon}
                                  disabled={raDisabled}
                                  onClick={() => ra.onExecute(row, globalIdx)}
                                >
                                  {raLabel}
                                </Button>
                              );
                            })}
                          </div>
                        </td>
                      )}
                    </tr>
                    {hasExpandable && isRowExpanded && renderExpandedRow && (
                      <tr className="zk-table-expanded-row">
                        <td colSpan={totalColSpan}>
                          {renderExpandedRow(row, globalIdx)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="zk-pagination">
              <span>
                {locale === 'en'
                  ? `Page ${currentPage} of ${totalPages} (${sorted.length} items)`
                  : `第 ${currentPage} / ${totalPages} 页（共 ${sorted.length} 条）`}
              </span>
              <div className="zk-row">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('上一页')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('下一页')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 声明式插件 Console 页面工厂：非适配器插件只需 ~20 行配置即可构建带统计卡片、状态徽标、
 * 操作按钮（自动对接 `usePluginRpc` / `pluginRpc`）与数据列表/表格的完整 Console 页。
 */
export function createDeclarativePage<TData = Record<string, unknown>>(
  spec: DeclarativePageSpec<TData>,
): React.ComponentType<DeclarativePageComponentProps> {
  const bp = buildDeclarativeBlueprint(spec);
  const fn = function DeclarativePluginPage(props?: DeclarativePageComponentProps) {
    if (props === undefined && !(globalThis as Record<string, unknown>).__ZHIN_ALLOW_RAW_BLUEPRINT__) {
      return bp as unknown as React.ReactElement;
    }
    return DeclarativePageView({ spec, pageProps: props ?? {} });
  };
  return Object.assign(fn, bp);
}

if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__ZHIN_RENDER_BLUEPRINT__ = (
    bp: unknown,
    props?: DeclarativePageComponentProps,
  ) =>
    React.createElement(
      DeclarativePageView as React.ComponentType<{
        readonly spec: DeclarativePageSpec;
        readonly pageProps?: DeclarativePageComponentProps;
      }>,
      {
        spec: (((bp as { reviewSpec?: unknown })?.reviewSpec != null
          ? bp
          : ((bp as { spec?: DeclarativePageSpec })?.spec ?? bp)) as DeclarativePageSpec),
        pageProps: props,
      },
    );
}
