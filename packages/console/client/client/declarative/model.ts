/**
 * Declarative page model (ADR 0063 P2): the spec types, the value expressions and the blueprint
 * normalization shared by `DeclarativePageView` and `DataTable`. No rendering here.
 */
import type React from 'react';
import { PluginRpcError } from '../console-utils/remoteApi.js';
import type { PluginUiLocale, PluginUiText } from '../ui/locale.js';
import type { RpcResource } from '../ui/rpc.js';
import type { RendererTone } from '../renderer/kit.js';

/** Badge tones of the declarative contract. */
export type BadgeTone = RendererTone;
/** Button variants of the declarative contract; `danger` renders as an outline button with a confirmation (ADR 0063 决策 5). */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning';

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
  | { readonly $coalesce: readonly string[]; readonly fallback?: string | number | boolean }
  /** `data[path]` is `{ 'zh-CN': …, en: … }`; the viewer's locale picks one. */
  | { readonly $i18n: string; readonly fallback?: string | number | boolean };

export function pickLocalizedDataValue(value: unknown, locale: PluginUiLocale): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return locale === 'en'
    ? record.en ?? record['zh-CN'] ?? record.zh
    : record['zh-CN'] ?? record.zh ?? record.en;
}

export function isDeclarativeValueExpr(value: unknown): value is DeclarativeValueExpr {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.$path === 'string' ||
    typeof rec.$count === 'string' ||
    (rec.$sum !== null && typeof rec.$sum === 'object') ||
    (rec.$format !== undefined && Array.isArray(rec.$args ?? rec.args)) ||
    (rec.$map !== null && typeof rec.$map === 'object') ||
    (rec.$join !== null && typeof rec.$join === 'object') ||
    Array.isArray(rec.$coalesce) ||
    typeof rec.$i18n === 'string'
  );
}

export function resolveDataPath(data: unknown, path: string): unknown {
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

export function evaluateDeclarativeExpr(
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
  if (typeof rec.$i18n === 'string') {
    const val = pickLocalizedDataValue(resolveDataPath(data, rec.$i18n), locale);
    const out = val !== undefined && val !== null && val !== '' ? val : rec.fallback;
    return out === undefined || out === null || out === '' ? '-' : String(out);
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
  /**
   * `date` / `time` render native pickers (`YYYY-MM-DD` / `HH:mm`); `conversation` renders
   * {@link ConversationPicker} and submits the chosen `DeliveryTarget` as JSON.
   */
  readonly type?:
    | 'text' | 'password' | 'number' | 'textarea' | 'select' | 'switch' | 'radio' | 'checkbox-group' | 'segmented'
    | 'date' | 'time' | 'conversation';
  /** `conversation` fields: accepted conversation kinds (default all). */
  readonly conversationKinds?: readonly ('private' | 'group' | 'channel')[];
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
  /** Shows the RPC answer inline under the form (expressions read the result object), not as a page-top banner. */
  readonly result?: DeclarativeActionResultSpec;
}

export interface DeclarativeActionResultSpec {
  readonly title?: DeclarativeI18nText | DeclarativeValueExpr;
  readonly tone?: BadgeTone | DeclarativeValueExpr;
  readonly entries?: readonly { readonly label: DeclarativeI18nText; readonly value: string | DeclarativeValueExpr }[];
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
  | 'json'
  /** A conversation key or `DeliveryTarget`, shown by its display name ({@link ConversationLabel}). */
  | 'conversation';

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
  /** Key-value description list extractor (rendered as a console-ui `KeyValueList`). */
  readonly entries?:
    | readonly {
        readonly label: DeclarativeI18nText | React.ReactNode;
        readonly value?: React.ReactNode | DeclarativeValueExpr;
        readonly dataKey?: string;
        readonly hint?: DeclarativeI18nText;
        /** Greys the value out when truthy (e.g. a configured but disabled schedule). */
        readonly muted?: boolean | DeclarativeValueExpr;
        /** Badge beside the value; an empty label hides it. */
        readonly badge?: { readonly label: DeclarativeI18nText | DeclarativeValueExpr; readonly tone?: BadgeTone | DeclarativeValueExpr };
      }[]
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


export function formatTimeHMS(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function pickText(text: DeclarativeI18nText | undefined, locale: PluginUiLocale, t: PluginUiText['t']): string {
  if (!text) return '';
  if (typeof text === 'string') return t(text);
  if (locale === 'en' && text.en) return text.en;
  return text['zh-CN'] ?? text.zh;
}

export function formatError(error: unknown, t: PluginUiText['t']): string {
  if (error instanceof PluginRpcError && error.code === 'forbidden') return t('没有操作权限');
  return error instanceof Error && error.message ? error.message : t('操作失败');
}

export function resolveBlueprintText(text: DeclarativeI18nText | undefined, locale: 'en' | 'zh-CN' = 'en'): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (locale === 'en') return text.en ?? text['zh-CN'] ?? text.zh ?? '';
  return text['zh-CN'] ?? text.zh ?? text.en ?? '';
}

export function buildDeclarativeBlueprint<TData = Record<string, unknown>>(spec: DeclarativePageSpec<TData>) {
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

export function normalizeActionField(f: Record<string, unknown>): DeclarativeActionFieldSpec {
  const key = String(f.key ?? f.name ?? '');
  return {
    ...(f as unknown as DeclarativeActionFieldSpec),
    key,
    label: (f.label as DeclarativeI18nText) ?? key,
  };
}

export function normalizeActionSpec<TData = Record<string, unknown>>(
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

export function normalizeDirectSpec<TData = Record<string, unknown>>(
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

export function coerceDeclarativeSpec<TData = Record<string, unknown>>(
  input: DeclarativePageSpec<TData>,
): DeclarativePageSpec<TData> {
  const raw = input as unknown as Record<string, unknown>;
  if (!raw || (typeof raw !== 'object' && typeof raw !== 'function')) return input;
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

export const VALID_BADGE_TONES = new Set<BadgeTone>(['neutral', 'success', 'warning', 'danger', 'info']);

export function resolveBadgeTone<TData>(
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

/** `muted: true`, or an expression whose value is truthy (`$path` reads the raw value, not its text). */
export function isEntryMuted(
  spec: boolean | DeclarativeValueExpr | undefined,
  data: unknown,
  locale: PluginUiLocale,
  t: PluginUiText['t'],
): boolean {
  if (spec === undefined || spec === false) return false;
  if (spec === true) return true;
  const raw = typeof (spec as { $path?: unknown }).$path === 'string'
    ? resolveDataPath(data, (spec as { $path: string }).$path)
    : evaluateDeclarativeExpr(spec, data, locale, t);
  return raw === true || raw === 'true' || (typeof raw === 'number' && raw !== 0);
}

export const CODE_KEY_PATTERN =
  /(?:^id$|Id$|_id$|^pid$|^cron$|Cron$|Path$|Key$|^hostname$|^platform$|^nodeVersion$|^intervalMs$)/u;

export function classifySemanticStatus(raw: string): BadgeTone | undefined {
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

/** Whether any column or action field shows conversations (so the page loads the directory once). */
export function specUsesConversations(spec: DeclarativePageSpec<any>): boolean {
  const columns = (spec.sections ?? []).flatMap((section) => section.columns ?? []);
  const fields = (spec.actions ?? []).flatMap((action) => action.fields ?? []);
  return columns.some((column) => column.type === 'conversation') || fields.some((field) => field.type === 'conversation');
}

/** Whether a `result` spec already shows the RPC's `message` field (title or an entry reads it). */
export function resultSpecRendersMessage(spec: DeclarativeActionResultSpec): boolean {
  const reads = (value: unknown): boolean => {
    if (!isDeclarativeValueExpr(value)) return false;
    const expr = value as Record<string, unknown>;
    const nested = (key: string) => (expr[key] as { readonly path?: unknown } | undefined)?.path;
    const paths = [
      expr.$path, expr.$count, expr.$i18n, nested('$sum'), nested('$map'), nested('$join'),
      ...(Array.isArray(expr.$coalesce) ? expr.$coalesce : []),
      ...(Array.isArray(expr.args) ? expr.args : []),
      ...(Array.isArray(expr.$args) ? expr.$args : []),
    ];
    return paths.some((path) => path === 'message');
  };
  return reads(spec.title) || (spec.entries ?? []).some((entry) => reads(entry.value));
}

