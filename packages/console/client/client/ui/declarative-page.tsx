import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { pluginRpc, PluginRpcError } from '../console-utils/remoteApi.js';
import { CommentReviewSession } from '../review-console/CommentReviewPage.js';
import {
  Badge,
  Button,
  ConfirmButton,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Notice,
  PageHeader,
  PluginPage,
  Section,
  StaleNotice,
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
  if (path in record) return record[path];
  const segments = path.split('.').filter(Boolean);
  let cursor: unknown = data;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor) && seg === 'length') return cursor.length;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
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
    return val === undefined || val === null ? '-' : String(val);
  }
  if (!isDeclarativeValueExpr(exprOrKey)) {
    return String(exprOrKey);
  }
  const rec = exprOrKey as Record<string, unknown>;
  if (typeof rec.$path === 'string') {
    const val = resolveDataPath(data, rec.$path);
    const out = val !== undefined && val !== null ? val : rec.fallback;
    return out === undefined || out === null ? '-' : String(out);
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
    const key = String(rawVal ?? '');
    const matched = mapSpec.cases?.[key];
    if (matched !== undefined) return pickText(matched, locale, t);
    if (mapSpec.default !== undefined) return pickText(mapSpec.default, locale, t);
    return rawVal === undefined || rawVal === null ? '-' : String(rawVal);
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
  readonly hint?: DeclarativeI18nText | DeclarativeValueExpr | ((data: TData) => React.ReactNode);
  readonly badge?: {
    readonly label: DeclarativeI18nText | DeclarativeValueExpr | ((data: TData) => React.ReactNode);
    readonly tone?: BadgeTone | DeclarativeValueExpr | ((data: TData) => BadgeTone);
  };
}

export interface DeclarativeActionFieldSpec {
  readonly key: string;
  readonly label: DeclarativeI18nText;
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
  readonly variant?: ButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  readonly fields?: readonly DeclarativeActionFieldSpec[];
  readonly params?: Readonly<Record<string, unknown>> | ((data: TData | undefined, values: Readonly<Record<string, string>>) => Readonly<Record<string, unknown>>);
  readonly disabled?: boolean | ((data: TData | undefined) => boolean);
  readonly successMessage?: DeclarativeI18nText;
}

export interface DeclarativeColumnSpec<TRow = Record<string, unknown>, TData = Record<string, unknown>> {
  readonly key: keyof TRow & string;
  readonly label: DeclarativeI18nText;
  readonly render?: (value: unknown, row: TRow, ctx: DeclarativePageContext<TData>) => React.ReactNode;
}

export interface DeclarativeSectionSpec<TData = Record<string, unknown>, TRow = Record<string, unknown>> {
  readonly id?: string;
  readonly title?: DeclarativeI18nText;
  readonly description?: DeclarativeI18nText;
  readonly emptyText?: DeclarativeI18nText;
  /** Extract rows for a declarative table or list. */
  readonly items?: (keyof TData & string) | ((data: TData) => readonly TRow[]);
  /** Columns for a declarative table/card list when `items` is provided. */
  readonly columns?: readonly DeclarativeColumnSpec<TRow, TData>[];
  /** Custom row renderer when `items` is provided. */
  readonly renderItem?: (item: TRow, index: number, ctx: DeclarativePageContext<TData>) => React.ReactNode;
  /** Key-value description list extractor (`<dl className="zk-dl">`). */
  readonly entries?:
    | readonly { readonly label: DeclarativeI18nText | React.ReactNode; readonly value?: React.ReactNode | DeclarativeValueExpr; readonly dataKey?: string }[]
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
  padding: 16px 18px; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg);
  background: var(--zk-surface); display: grid; gap: 6px; min-width: 0;
  transition: border-color .16s ease, transform .16s ease;
}
.zk-stat-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, var(--zk-primary), transparent); opacity: .75;
}
.zk-stat-card:hover { border-color: var(--zk-input-line); transform: translateY(-1px); }
.zk-stat-card__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zk-stat-card__label { font-size: var(--zk-text-small); color: var(--zk-muted); font-weight: 500; }
.zk-stat-card__value { font-size: 24px; font-weight: 700; line-height: 1.25; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.zk-table-wrap { overflow-x: auto; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); }
.zk-table { width: 100%; border-collapse: collapse; font-size: var(--zk-text-small); text-align: left; }
.zk-table th, .zk-table td { padding: 11px 14px; border-bottom: 1px solid var(--zk-line); vertical-align: middle; }
.zk-table th { color: var(--zk-muted); font-weight: 600; background: var(--zk-inset); white-space: nowrap; font-size: 12px; letter-spacing: 0.02em; }
.zk-table tbody tr { transition: background-color .12s ease; }
.zk-table tbody tr:hover td { background: var(--zk-inset); }
.zk-table tr:last-child td { border-bottom: none; }
.zk-table-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.zk-search-input {
  width: 210px !important; min-height: var(--zk-control-sm) !important;
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
.zk-action-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
`;

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

function coerceDeclarativeSpec<TData = Record<string, unknown>>(
  input: DeclarativePageSpec<TData>,
): DeclarativePageSpec<TData> {
  const raw = input as unknown as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return input;
  if (raw.spec && typeof raw.spec === 'object') {
    return raw.spec as DeclarativePageSpec<TData>;
  }
  if (raw.kind !== 'zhin.console.page-blueprint') {
    return input;
  }
  const rawSections = Array.isArray(raw.sections) ? (raw.sections as Record<string, unknown>[]) : [];
  const stats: DeclarativeStatSpec<TData>[] = [];
  const actions: DeclarativeActionSpec<TData>[] = [];
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
        if (!act || typeof act !== 'object') continue;
        const name = String(act.action ?? act.name ?? '');
        if (!name) continue;
        actions.push({
          name,
          label: (act.label as DeclarativeI18nText) ?? name,
          ...(act.description !== undefined ? { description: act.description as DeclarativeI18nText } : {}),
          ...(act.variant !== undefined ? { variant: act.variant as ButtonVariant } : {}),
          ...(act.confirm !== undefined ? { confirm: act.confirm as DeclarativeI18nText } : {}),
          ...(act.confirmLabel !== undefined ? { confirmLabel: act.confirmLabel as DeclarativeI18nText } : {}),
          ...(Array.isArray(act.fields) ? { fields: act.fields as readonly DeclarativeActionFieldSpec[] } : {}),
          ...(act.params !== undefined ? { params: act.params as DeclarativeActionSpec<TData>['params'] } : {}),
          ...(act.disabled !== undefined ? { disabled: act.disabled as DeclarativeActionSpec<TData>['disabled'] } : {}),
          ...(act.successMessage !== undefined ? { successMessage: act.successMessage as DeclarativeI18nText } : {}),
        });
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
        items: dataKey
          ? ((data: TData) => {
              const fromData = resolveDataPath(data, dataKey);
              return Array.isArray(fromData) ? (fromData as readonly Record<string, unknown>[]) : staticRows;
            })
          : (() => staticRows),
        columns: cols.map((c) => ({
          key: String(c.key ?? ''),
          label: (c.label as DeclarativeI18nText) ?? String(c.key ?? ''),
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
              label: String(e.label ?? e.key ?? ''),
              value: String(val ?? '-'),
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
    lower === 'healthy' ||
    lower === 'ready' ||
    lower === 'online' ||
    lower === 'ok' ||
    raw === '已就绪' ||
    raw === '已启用' ||
    raw === '正常' ||
    raw === '健康' ||
    raw === '是'
  ) {
    return 'success';
  }
  if (
    lower === 'degraded' ||
    lower === 'not ready' ||
    lower === 'pending' ||
    lower === 'stale' ||
    raw === '未就绪' ||
    raw === '降级' ||
    raw === '待审'
  ) {
    return 'warning';
  }
  if (
    lower === 'error' ||
    lower === 'failed' ||
    lower === 'crashed' ||
    raw === '异常' ||
    raw === '失败'
  ) {
    return 'danger';
  }
  if (
    lower === 'false' ||
    lower === 'no' ||
    lower === 'disabled' ||
    lower === 'offline' ||
    raw === '已禁用' ||
    raw === '离线' ||
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
): React.ReactNode {
  if (raw === null || raw === undefined || raw === '') return '-';
  if (typeof raw === 'boolean') {
    return <Badge tone={raw ? 'success' : 'neutral'}>{raw ? 'Yes' : 'No'}</Badge>;
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) return '-';
    return (
      <span>
        {raw.map((item, idx) => (
          <span key={idx} className="zk-chip">{String(item ?? '')}</span>
        ))}
      </span>
    );
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '-') return '-';
    if (/^https?:\/\/\S+$/iu.test(trimmed)) {
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
    const statusTone = classifySemanticStatus(trimmed);
    if (statusTone !== undefined) {
      return <Badge tone={statusTone}>{trimmed}</Badge>;
    }
    if (fieldKey && CODE_KEY_PATTERN.test(fieldKey)) {
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
    if (fieldKey && CODE_KEY_PATTERN.test(fieldKey)) {
      return <code className="zk-code-pill">{String(raw)}</code>;
    }
    return String(raw);
  }
  return raw as React.ReactNode;
}

const TABLE_PAGE_SIZE = 15;

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
  const configuredPollMs = spec.pollMs === undefined ? 10_000 : (spec.pollMs > 0 ? spec.pollMs : undefined);
  const [autoPollEnabled, setAutoPollEnabled] = useState(true);
  const pollMs = autoPollEnabled ? configuredPollMs : undefined;

  const resource = usePluginRpc<TData>(pluginId, statusMethod, undefined, {
    pollMs,
    isEmpty: spec.isEmpty ?? (() => false),
  });

  const [notice, setNotice] = useState<{ readonly tone: 'info' | 'success' | 'warning' | 'danger'; readonly message: string } | undefined>();
  const [busyAction, setBusyAction] = useState<string>('');
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
  const [actionInputs, setActionInputs] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>({});
  const [sectionQueries, setSectionQueries] = useState<Readonly<Record<string, string>>>({});
  const [sectionPages, setSectionPages] = useState<Readonly<Record<string, number>>>({});
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
    const values = actionInputs[action.name] ?? {};
    for (const field of action.fields ?? []) {
      const val = (values[field.key] ?? field.defaultValue ?? '').trim();
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
      const res = await call<{ message?: string } | undefined>(action.name, payload);
      const msg = (res && typeof res === 'object' && typeof res.message === 'string' && res.message)
        ? res.message
        : (action.successMessage ? pickText(action.successMessage, locale, t) : `${pickText(action.label, locale, t)} ${t('已完成')}`);
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
                  disabled={isDisabled}
                  busy={isBusy}
                  onClick={() => runAction(action)}
                >
                  {label}
                </Button>
              );
            })}
            {configuredPollMs !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAutoPollEnabled((prev) => !prev)}
                title={autoPollEnabled ? t('点击暂停自动轮询') : t('点击恢复自动轮询')}
              >
                {autoPollEnabled
                  ? (locale === 'en' ? 'Auto-sync On' : '自动同步中')
                  : (locale === 'en' ? 'Auto-sync Off' : '已暂停同步')}
              </Button>
            )}
            <Button busy={manualRefreshBusy} onClick={handleManualRefresh}>{t('刷新')}</Button>
          </div>
        }
      />

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(undefined)}>
          {notice.message}
        </Notice>
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

      {data !== undefined && stats.length > 0 && (
        <div className="zk-stats-grid">
          {stats.map((stat, idx) => {
            const val = typeof stat.value === 'function'
              ? stat.value(data, ctx)
              : evaluateDeclarativeExpr(stat.value, data, locale, t);
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
            return (
              <div key={stat.key ?? idx} className="zk-stat-card">
                <div className="zk-stat-card__head">
                  <span className="zk-stat-card__label">{pickText(stat.label, locale, t)}</span>
                  {stat.badge && <Badge tone={badgeTone}>{badgeLabel}</Badge>}
                </div>
                <div className="zk-stat-card__value">{val}</div>
                {hint && <span className="zk-hint">{hint}</span>}
              </div>
            );
          })}
        </div>
      )}

      {formActions.length > 0 && (
        <Section title={t('操作')}>
          <div className="zk-action-grid">
            {formActions.map((action) => {
              const label = pickText(action.label, locale, t);
              const isBusy = busyAction === action.name;
              const isDisabled = typeof action.disabled === 'function' ? action.disabled(data) : Boolean(action.disabled);
              const currentValues = actionInputs[action.name] ?? {};
              return (
                <div key={action.name} className="zk-card">
                  <strong>{label}</strong>
                  {action.description && <p className="zk-hint">{pickText(action.description, locale, t)}</p>}
                  {(action.fields ?? []).map((field) => (
                    <Field key={field.key} label={pickText(field.label, locale, t)} required={field.required}>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        placeholder={field.placeholder}
                        value={currentValues[field.key] ?? field.defaultValue ?? ''}
                        onChange={(e) => setActionInputs((prev) => ({
                          ...prev,
                          [action.name]: { ...(prev[action.name] ?? {}), [field.key]: e.target.value },
                        }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isBusy && !isDisabled) {
                            e.preventDefault();
                            void runAction(action);
                          }
                        }}
                      />
                    </Field>
                  ))}
                  <div className="zk-row">
                    <Button variant={action.variant ?? 'primary'} busy={isBusy} disabled={isDisabled} onClick={() => runAction(action)}>
                      {label}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {data !== undefined && (spec.sections ?? []).map((section, idx) => {
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
          ? rows.filter((row) =>
              Object.values(row ?? {}).some((v) => String(v ?? '').toLowerCase().includes(query)),
            )
          : rows;
        const totalFiltered = filteredRows?.length ?? 0;
        const totalPages = Math.max(1, Math.ceil(totalFiltered / TABLE_PAGE_SIZE));
        const currentPage = Math.min(sectionPages[secKey] ?? 1, totalPages);
        const pagedRows = filteredRows
          ? filteredRows.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE)
          : undefined;

        const entries = section.entries
          ? (typeof section.entries === 'function'
            ? section.entries(data, ctx)
            : section.entries.map((entry) => ({
                key: entry.dataKey,
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
              })))
          : undefined;
        const entryList = entries
          ? (Array.isArray(entries)
            ? entries
            : Object.entries(entries).map(([label, value]) => ({ key: label, label, value })))
          : undefined;

        return (
          <Section
            key={secKey}
            id={section.id}
            title={section.title ? pickText(section.title, locale, t) : undefined}
            description={section.description ? pickText(section.description, locale, t) : undefined}
            actions={
              rows && rows.length > 0 ? (
                <div className="zk-table-toolbar">
                  {(rows.length >= 3 || query.length > 0) && (
                    <input
                      type="search"
                      className="zk-search-input"
                      placeholder={locale === 'en' ? 'Filter rows…' : '搜索过滤…'}
                      value={sectionQueries[secKey] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSectionQueries((prev) => ({ ...prev, [secKey]: val }));
                        setSectionPages((prev) => ({ ...prev, [secKey]: 1 }));
                      }}
                    />
                  )}
                  <span className="zk-count">
                    {query
                      ? `${totalFiltered} / ${rows.length}`
                      : String(rows.length)}
                  </span>
                </div>
              ) : undefined
            }
          >
            {section.render && section.render(data, ctx)}
            {entryList && (
              <div className="zk-card">
                <dl className="zk-dl">
                  {entryList.map((entry, entryIdx) => {
                    const entryFieldKey = (entry as { key?: string }).key ?? (typeof entry.label === 'string' ? entry.label : undefined);
                    return (
                      <React.Fragment key={entryIdx}>
                        <dt>{entry.label}</dt>
                        <dd>
                          {renderSmartValue(
                            entry.value,
                            entryFieldKey,
                            `${secKey}-entry-${entryIdx}`,
                            copiedKey,
                            handleCopy,
                            t,
                          )}
                        </dd>
                      </React.Fragment>
                    );
                  })}
                </dl>
              </div>
            )}
            {rows && (
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
              ) : section.columns && section.columns.length > 0 ? (
                <div className="zk-table-wrap">
                  <table className="zk-table">
                    <thead>
                      <tr>
                        {section.columns.map((col) => (
                          <th key={col.key}>{pickText(col.label, locale, t)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(pagedRows ?? rows).map((row, rowIdx) => (
                        <tr key={String(row.id ?? row.key ?? rowIdx)}>
                          {(section.columns ?? []).map((col) => {
                            const cellVal = resolveDataPath(row, col.key);
                            return (
                              <td key={col.key}>
                                {col.render
                                  ? col.render(cellVal, row, ctx)
                                  : renderSmartValue(
                                      cellVal,
                                      col.key,
                                      `${secKey}-r${rowIdx}-${col.key}`,
                                      copiedKey,
                                      handleCopy,
                                      t,
                                    )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
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
              ) : section.renderItem ? (
                <ul className="zk-list">
                  {(pagedRows ?? rows).map((row, rowIdx) => (
                    <li key={String(row.id ?? row.key ?? rowIdx)} className="zk-card">
                      {section.renderItem?.(row, rowIdx, ctx)}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="zk-list">
                  {(pagedRows ?? rows).map((row, rowIdx) => (
                    <li key={String(row.id ?? row.key ?? rowIdx)} className="zk-card">
                      <dl className="zk-dl">
                        {Object.entries(row).map(([k, v]) => (
                          <React.Fragment key={k}>
                            <dt>{k}</dt>
                            <dd>
                              {renderSmartValue(
                                v,
                                k,
                                `${secKey}-card-${rowIdx}-${k}`,
                                copiedKey,
                                handleCopy,
                                t,
                              )}
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              )
            )}
          </Section>
        );
      })}

      {data !== undefined && spec.render && spec.render(data, ctx)}
      {spec.footnote && <p className="zk-footnote">{pickText(spec.footnote, locale, t)}</p>}
    </PluginPage>
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
