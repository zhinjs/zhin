import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { pluginRpc, PluginRpcError } from '../console-utils/remoteApi.js';
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

export interface DeclarativeBadgeSpec<TData = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText | ((data: TData, ctx: DeclarativePageContext<TData>) => React.ReactNode);
  readonly tone?: BadgeTone | ((data: TData) => BadgeTone);
}

export interface DeclarativeStatSpec<TData = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText;
  readonly value: keyof TData & string | ((data: TData, ctx: DeclarativePageContext<TData>) => React.ReactNode);
  readonly hint?: DeclarativeI18nText | ((data: TData) => React.ReactNode);
  readonly badge?: {
    readonly label: DeclarativeI18nText | ((data: TData) => React.ReactNode);
    readonly tone?: BadgeTone | ((data: TData) => BadgeTone);
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
  readonly entries?: (data: TData, ctx: DeclarativePageContext<TData>) => Readonly<Record<string, React.ReactNode>> | readonly { readonly label: React.ReactNode; readonly value: React.ReactNode }[];
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
.zk-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.zk-stat-card { padding: 16px; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); display: grid; gap: 6px; min-width: 0; }
.zk-stat-card__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zk-stat-card__label { font-size: var(--zk-text-small); color: var(--zk-muted); font-weight: 500; }
.zk-stat-card__value { font-size: 22px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.zk-table-wrap { overflow-x: auto; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); }
.zk-table { width: 100%; border-collapse: collapse; font-size: var(--zk-text-small); text-align: left; }
.zk-table th, .zk-table td { padding: 10px 14px; border-bottom: 1px solid var(--zk-line); vertical-align: top; }
.zk-table th { color: var(--zk-muted); font-weight: 600; background: var(--zk-inset); white-space: nowrap; }
.zk-table tr:last-child td { border-bottom: none; }
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
      sections.push({ type: 'entries', id, title });
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
      })),
    });
  }
  const description = resolveBlueprintText(spec.description, 'en');
  return {
    kind: 'zhin.console.page-blueprint' as const,
    version: 1 as const,
    title: resolveBlueprintText(spec.title, 'en'),
    ...(description ? { description } : {}),
    dataSource: { action: spec.statusMethod ?? 'status' },
    sections,
    spec,
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
        const staticVal = item.value;
        stats.push({
          key: typeof item.key === 'string' ? item.key : dataKey,
          label: (item.label as DeclarativeI18nText) ?? (typeof item.key === 'string' ? item.key : ''),
          value: dataKey
            ? ((data: TData) => String((data as Record<string, unknown>)?.[dataKey] ?? staticVal ?? '-'))
            : ((data: TData) => {
                if (typeof item.key === 'string' && data && typeof data === 'object' && item.key in (data as Record<string, unknown>)) {
                  return String((data as Record<string, unknown>)[item.key] ?? '-');
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
              const fromData = (data as Record<string, unknown>)?.[dataKey];
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
        entries: (data: TData) =>
          rawEntries.map((e) => {
            const dk = typeof e.dataKey === 'string' ? e.dataKey : (typeof e.key === 'string' ? e.key : undefined);
            const val = dk && data && typeof data === 'object' && dk in (data as Record<string, unknown>)
              ? (data as Record<string, unknown>)[dk]
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

export function DeclarativePageView<TData = Record<string, unknown>>({
  spec: rawSpec,
  pageProps,
}: {
  readonly spec: DeclarativePageSpec<TData>;
  readonly pageProps?: DeclarativePageComponentProps;
}) {
  const spec = useMemo(() => coerceDeclarativeSpec(rawSpec), [rawSpec]);
  const { locale, t } = useLocale(spec.dictionary);
  const rawPluginId = resolveSyncPluginId(pageProps?.pluginId ?? pageProps?.owner ?? spec.pluginId);
  const pluginId = rawPluginId === 'unknown' ? undefined : rawPluginId;
  const statusMethod = spec.statusMethod ?? 'status';
  const pollMs = spec.pollMs === undefined ? 10_000 : (spec.pollMs > 0 ? spec.pollMs : undefined);

  const resource = usePluginRpc<TData>(pluginId, statusMethod, undefined, {
    pollMs,
    isEmpty: spec.isEmpty ?? (() => false),
  });

  const [notice, setNotice] = useState<{ readonly tone: 'info' | 'success' | 'warning' | 'danger'; readonly message: string } | undefined>();
  const [busyAction, setBusyAction] = useState<string>('');
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
  const [actionInputs, setActionInputs] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>({});

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
        mark={spec.mark}
        title={pickText(spec.title, locale, t) || pageProps?.title || 'Plugin'}
        description={spec.description ? pickText(spec.description, locale, t) : undefined}
        actions={
          <div className="zk-row">
            {badges.map((b, idx) => {
              const tone: BadgeTone = typeof b.tone === 'function'
                ? (data !== undefined ? b.tone(data) : 'neutral')
                : (b.tone ?? 'neutral');
              const label = typeof b.label === 'function'
                ? (data !== undefined ? b.label(data, ctx) : '')
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
              : String((data as Record<string, unknown>)[stat.value] ?? '-');
            const hint = typeof stat.hint === 'function'
              ? stat.hint(data)
              : (stat.hint ? pickText(stat.hint, locale, t) : undefined);
            const badgeTone = stat.badge
              ? (typeof stat.badge.tone === 'function' ? stat.badge.tone(data) : (stat.badge.tone ?? 'neutral'))
              : undefined;
            const badgeLabel = stat.badge
              ? (typeof stat.badge.label === 'function' ? stat.badge.label(data) : pickText(stat.badge.label, locale, t))
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
          <div className="zk-list">
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
        const rows: readonly Record<string, unknown>[] | undefined = section.items
          ? (typeof section.items === 'function'
            ? section.items(data)
            : (Array.isArray((data as Record<string, unknown>)[section.items])
              ? ((data as Record<string, unknown>)[section.items] as readonly Record<string, unknown>[])
              : []))
          : undefined;
        const entries = section.entries ? section.entries(data, ctx) : undefined;
        const entryList = entries
          ? (Array.isArray(entries)
            ? entries
            : Object.entries(entries).map(([label, value]) => ({ label, value })))
          : undefined;

        return (
          <Section
            key={section.id ?? idx}
            id={section.id}
            title={section.title ? pickText(section.title, locale, t) : undefined}
            description={section.description ? pickText(section.description, locale, t) : undefined}
          >
            {section.render && section.render(data, ctx)}
            {entryList && (
              <div className="zk-card">
                <dl className="zk-dl">
                  {entryList.map((entry, entryIdx) => (
                    <React.Fragment key={entryIdx}>
                      <dt>{entry.label}</dt>
                      <dd>{entry.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            )}
            {rows && (
              rows.length === 0 ? (
                <EmptyState title={section.emptyText ? pickText(section.emptyText, locale, t) : t('暂无数据')} />
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
                      {rows.map((row, rowIdx) => (
                        <tr key={String(row.id ?? row.key ?? rowIdx)}>
                          {(section.columns ?? []).map((col) => {
                            const cellVal = row[col.key];
                            return (
                              <td key={col.key}>
                                {col.render ? col.render(cellVal, row, ctx) : String(cellVal ?? '-')}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : section.renderItem ? (
                <ul className="zk-list">
                  {rows.map((row, rowIdx) => (
                    <li key={String(row.id ?? row.key ?? rowIdx)} className="zk-card">
                      {section.renderItem?.(row, rowIdx, ctx)}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="zk-list">
                  {rows.map((row, rowIdx) => (
                    <li key={String(row.id ?? row.key ?? rowIdx)} className="zk-card">
                      <dl className="zk-dl">
                        {Object.entries(row).map(([k, v]) => (
                          <React.Fragment key={k}>
                            <dt>{k}</dt>
                            <dd>{String(v ?? '-')}</dd>
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
        spec: (((bp as { spec?: DeclarativePageSpec })?.spec ?? bp) as DeclarativePageSpec),
        pageProps: props,
      },
    );
}
