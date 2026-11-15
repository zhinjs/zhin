/**
 * `DeclarativePageView` — the renderer of page blueprints (`definePageBlueprint()` /
 * `createDeclarativePage()`), on `@zhin.js/console-ui` (ADR 0063 P2).
 *
 * It renders only content blocks. Title, description, the actions without a form, status badges
 * and the refresh control go to the page shell (`usePageChrome`); without a shell (an older
 * Console) the page draws that header itself. The blueprint `mark` (letter tile) is ignored with a
 * one-time deprecation warning.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CodeText,
  Grid,
  Section,
  ContentStack,
  Disclosure,
  FormField,
  Input,
  KeyValueList,
  MediaPreview,
  StatCard,
  StatGrid,
  ProgressMeter,
  RecordCard,
  Sparkline,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  type ContentTone,
} from '@zhin.js/console-ui';
import { pluginRpc } from '../console-utils/remoteApi.js';
import { CommentReviewSession } from '../review-console/CommentReviewPage.js';
import { ConversationDirectoryContext, useConversationDirectory } from '../ui/conversation-directory.js';
import { ConversationPicker } from '../ui/conversation-picker.js';
import { useLocale, type PluginUiLocale, type PluginUiText } from '../ui/locale.js';
import { resolveSyncPluginId } from '../ui/plugin-id.js';
import { usePluginRpc } from '../ui/rpc.js';
import { BLUEPRINT_MARK_DEPRECATION, warnDeprecatedOnce } from '../renderer/deprecation.js';
import {
  ActionButton,
  CheckboxChoices,
  ChoiceSelect,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  NoticeBlock,
  RadioChoices,
  RendererPage,
  SegmentedChoices,
  SwitchRow,
  ToneBadge,
} from '../renderer/kit.js';
import { DataTable, rowKeyOf, type DataTableColumn } from './DataTable.js';
import {
  CODE_KEY_PATTERN,
  buildDeclarativeBlueprint,
  classifySemanticStatus,
  coerceDeclarativeSpec,
  evaluateDeclarativeExpr,
  formatError,
  isDeclarativeValueExpr,
  isEntryMuted,
  pickText,
  resolveBadgeTone,
  resolveDataPath,
  resultSpecRendersMessage,
  specUsesConversations,
  type BadgeTone,
  type DeclarativeActionFieldSpec,
  type DeclarativeActionResultSpec,
  type DeclarativeActionSpec,
  type DeclarativeBatchActionSpec,
  type DeclarativeI18nText,
  type DeclarativePageComponentProps,
  type DeclarativePageContext,
  type DeclarativePageSpec,
  type DeclarativeRowActionSpec,
  type DeclarativeSectionSpec,
} from './model.js';
import { CopyValueButton, JsonValue, renderSmartValue, splitTechnicalFields, type CopyState } from './values.js';

/** What the renderer supports; hosts feature-detect it (`DeclarativePageView.capabilities`). */
export const DECLARATIVE_PAGE_CAPABILITIES = Object.freeze({ pageChrome: true } as const);

interface InlineActionResult {
  readonly result: Record<string, unknown>;
  readonly tone: BadgeTone;
  readonly message?: string;
}

type Tone = 'info' | 'success' | 'warning' | 'danger';

const contentTone = (tone: BadgeTone | 'primary' | 'default' | undefined): ContentTone =>
  tone === 'danger' || tone === 'warning' || tone === 'success' || tone === 'primary' ? tone : 'neutral';

/** Whether a blueprint (or the spec inside it) still sets the deprecated `mark`. */
export function blueprintUsesMark(raw: unknown): boolean {
  if (!raw || (typeof raw !== 'object' && typeof raw !== 'function')) return false;
  const record = raw as Record<string, unknown>;
  if (record.mark !== undefined && record.mark !== null) return true;
  const inner = record.spec as Record<string, unknown> | undefined;
  return Boolean(inner && typeof inner === 'object' && inner.mark !== undefined && inner.mark !== null);
}

function useCopyState(): CopyState {
  const [copiedKey, setCopiedKey] = useState('');
  const onCopy = useCallback((key: string, text: string) => {
    try {
      void globalThis.navigator?.clipboard?.writeText?.(text);
    } catch {
      // clipboard unavailable (insecure context, tests)
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(previous => (previous === key ? '' : previous)), 1_800);
  }, []);
  return useMemo(() => ({ copiedKey, onCopy }), [copiedKey, onCopy]);
}

/** Inline answer of an action with a `result` spec, rendered under its form. */
function ActionInlineResult({ name, spec, result, fallbackTone = 'neutral', message, locale, t, onDismiss }: {
  readonly name: string;
  readonly spec: DeclarativeActionResultSpec;
  readonly result: Record<string, unknown>;
  readonly fallbackTone?: BadgeTone;
  readonly message?: string;
  readonly locale: PluginUiLocale;
  readonly t: PluginUiText['t'];
  readonly onDismiss: () => void;
}) {
  const tone = spec.tone === undefined ? fallbackTone : resolveBadgeTone(spec.tone, result, locale, t);
  const title = spec.title === undefined
    ? undefined
    : isDeclarativeValueExpr(spec.title)
      ? evaluateDeclarativeExpr(spec.title, result, locale, t)
      : pickText(spec.title, locale, t);
  const noticeTone: Tone = tone === 'danger' || tone === 'warning' || tone === 'success' ? tone : 'info';
  return (
    <div data-action-result={name}>
      <NoticeBlock tone={noticeTone} onDismiss={onDismiss} dismissLabel={t('关闭')}>
        <ContentStack gap="tight">
          {title !== undefined ? <ToneBadge tone={tone}>{title}</ToneBadge> : null}
          {message && !resultSpecRendersMessage(spec) ? <span data-action-result-message="">{message}</span> : null}
          {spec.entries && spec.entries.length > 0 ? (
            <KeyValueList
              columns={1}
              items={spec.entries.map((entry, index) => ({
                key: String(index),
                label: pickText(entry.label, locale, t),
                value: evaluateDeclarativeExpr(entry.value, result, locale, t),
              }))}
            />
          ) : null}
        </ContentStack>
      </NoticeBlock>
    </div>
  );
}

export function DeclarativePageView<TData = Record<string, unknown>>({
  spec: rawSpec,
  pageProps,
}: {
  readonly spec: DeclarativePageSpec<TData>;
  readonly pageProps?: DeclarativePageComponentProps;
}) {
  // Blueprints may arrive as the page function itself (`definePageBlueprint` returns a function
  // carrying the blueprint as own properties).
  const reviewSpec =
    rawSpec && (typeof rawSpec === 'object' || typeof rawSpec === 'function') && (rawSpec as unknown as { reviewSpec?: unknown }).reviewSpec != null
      ? (rawSpec as unknown as { reviewSpec: unknown }).reviewSpec
      : undefined;
  if (reviewSpec) {
    return <CommentReviewSession spec={reviewSpec as never} />;
  }
  if (blueprintUsesMark(rawSpec)) warnDeprecatedOnce('blueprint-mark', BLUEPRINT_MARK_DEPRECATION);

  const spec = useMemo(() => coerceDeclarativeSpec(rawSpec), [rawSpec]);
  const { locale, t } = useLocale(spec.dictionary);
  const rawPluginId = resolveSyncPluginId(pageProps?.pluginId ?? pageProps?.owner ?? spec.pluginId);
  const pluginId = rawPluginId === 'unknown' ? undefined : rawPluginId;
  const statusMethod = spec.statusMethod ?? 'status';
  const defaultPollMs = spec.pollMs === undefined ? 15_000 : (spec.pollMs > 0 ? spec.pollMs : 0);
  // Auto-refresh is driven by the RefreshControl (shell or inline header), not by the RPC hook,
  // so the interval the user picks is the only timer.
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(defaultPollMs);

  const usesConversations = useMemo(() => specUsesConversations(spec), [spec]);
  const conversations = useConversationDirectory({ enabled: usesConversations });

  const resource = usePluginRpc<TData>(pluginId, statusMethod, undefined, {
    isEmpty: spec.isEmpty ?? (() => false),
  });

  const [notice, setNotice] = useState<{ readonly tone: Tone; readonly message: string } | undefined>();
  const [busyAction, setBusyAction] = useState<string>('');
  const [actionInputs, setActionInputs] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>({});
  const [actionResults, setActionResults] = useState<Readonly<Record<string, Record<string, unknown>>>>({});
  const [inlineResults, setInlineResults] = useState<Readonly<Record<string, InlineActionResult>>>({});
  const [sectionSelections, setSectionSelections] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [activeTab, setActiveTab] = useState<string>('');
  const copy = useCopyState();

  useEffect(() => {
    if (!notice || notice.tone === 'danger') return;
    const timer = setTimeout(() => setNotice(undefined), 6_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const notify = useCallback((tone: Tone, message: string) => {
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
    () => ({ pluginId: pluginId ?? 'unknown', locale, t, resource, call, refresh: resource.refresh, notify }),
    [pluginId, locale, t, resource, call, notify],
  );

  const runAction = async (action: DeclarativeActionSpec<TData>) => {
    if (!pluginId) return;
    const values: Record<string, string> = { ...(actionInputs[action.name] ?? {}) };
    for (const field of action.fields ?? []) {
      if (values[field.key] === undefined && field.defaultValue !== undefined) values[field.key] = field.defaultValue;
      if (field.required && !(values[field.key] ?? '').trim()) {
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
      const answerMessage = res && typeof res === 'object' && typeof res.message === 'string' && res.message ? res.message : undefined;
      const msg = answerMessage
        ?? (action.successMessage ? pickText(action.successMessage, locale, t) : `${pickText(action.label, locale, t)} ${t('已完成')}`);
      const tone: 'success' | 'warning' | 'danger' =
        res && typeof res === 'object' && (res.passed === false || res.decision === 'block')
          ? 'danger'
          : res && typeof res === 'object' && (res.decision === 'review' || res.decision === 'warn')
            ? 'warning'
            : 'success';
      if (action.result) {
        const inlineMessage = answerMessage ?? (action.successMessage ? pickText(action.successMessage, locale, t) : undefined);
        setInlineResults((prev) => ({
          ...prev,
          [action.name]: { result: res && typeof res === 'object' ? res : {}, tone, ...(inlineMessage ? { message: inlineMessage } : {}) },
        }));
        await resource.refresh();
        return;
      }
      if (res && typeof res === 'object') {
        const previewKeys = ['dataUrl', 'qrDataUrl', 'imageUrl', 'shortUrl', 'url', 'text', 'output', 'result'];
        if (previewKeys.some((k) => res[k] !== undefined && res[k] !== null && res[k] !== '')) {
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
        const payload = batchAction.params
          ? batchAction.params(selectedRows, selectedKeys, resource.data)
          : { [batchAction.idsParamKey ?? 'ids']: selectedKeys };
        await call(batchAction.name, payload);
      }
      notify('success', batchAction.successMessage
        ? pickText(batchAction.successMessage, locale, t)
        : `${pickText(batchAction.label, locale, t)} (${selectedKeys.length}) ${t('已完成')}`);
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
        const payload = rowAction.params ? rowAction.params(row, rk, resource.data) : { [rowAction.idParamKey ?? 'id']: rk };
        await call(rowAction.name, payload);
      }
      notify('success', rowAction.successMessage
        ? pickText(rowAction.successMessage, locale, t)
        : `${pickText(rowAction.label, locale, t)} ${t('已完成')}`);
      await resource.refresh();
    } catch (err) {
      notify('danger', formatError(err, t));
    } finally {
      setBusyAction('');
    }
  };

  const dismissPreview = (name: string) => setActionResults((prev) => {
    const next = { ...prev };
    delete next[name];
    return next;
  });

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
      <div data-action-preview={actionName}>
        <Section
          title={t('执行结果预览')}
          actions={<ActionButton label={t('关闭')} variant="ghost" locale={locale} onRun={() => dismissPreview(actionName)} />}
        >
          {imgUrl ? (
            <ContentStack direction="row" gap="tight" align="center">
              <MediaPreview src={imgUrl} alt={actionName} />
              <CopyValueButton copyKey={`${copyKey}-img`} text={imgUrl} copy={copy} t={t} label={t('复制图片数据')} />
            </ContentStack>
          ) : null}
          {copyableText ? (
            <ContentStack direction="row" gap="tight" align="center" justify="between">
              <CodeText>{copyableText}</CodeText>
              <CopyValueButton copyKey={`${copyKey}-txt`} text={copyableText} copy={copy} t={t} />
            </ContentStack>
          ) : null}
          {structuredData !== undefined ? <JsonValue value={structuredData} t={t} /> : null}
        </Section>
      </div>
    );
  };

  const data = resource.data;
  const resolvedTitle = pickText(spec.title, locale, t) || pageProps?.title || 'Plugin';
  const description = spec.description ? pickText(spec.description, locale, t) : undefined;
  const badges = data !== undefined && spec.badges
    ? (typeof spec.badges === 'function' ? spec.badges(data, ctx) : spec.badges)
    : [];
  const stats = data !== undefined && spec.stats
    ? (typeof spec.stats === 'function' ? spec.stats(data, ctx) : spec.stats)
    : [];
  const headerActions = spec.actions?.filter((a) => !a.fields || a.fields.length === 0) ?? [];
  const formActions = spec.actions?.filter((a) => a.fields && a.fields.length > 0) ?? [];

  const renderActionButton = (action: DeclarativeActionSpec<TData>, fallbackVariant: 'default' | 'outline') => {
    const label = pickText(action.label, locale, t);
    return (
      <ActionButton
        key={action.name}
        label={label}
        icon={action.icon}
        variant={action.variant}
        fallbackVariant={fallbackVariant}
        locale={locale}
        confirm={action.confirm ? pickText(action.confirm, locale, t) : undefined}
        confirmLabel={action.confirmLabel ? pickText(action.confirmLabel, locale, t) : undefined}
        disabled={typeof action.disabled === 'function' ? action.disabled(data) : Boolean(action.disabled)}
        busy={busyAction === action.name}
        onRun={() => runAction(action)}
      />
    );
  };

  const chromeActions = badges.length > 0 || headerActions.length > 0 ? (
    <ContentStack direction="row" gap="tight" align="center">
      {badges.map((b, idx) => {
        const tone = resolveBadgeTone(b.tone, data, locale, t);
        const label = typeof b.label === 'function'
          ? (data !== undefined ? b.label(data, ctx) : '')
          : isDeclarativeValueExpr(b.label)
            ? evaluateDeclarativeExpr(b.label, data, locale, t)
            : pickText(b.label, locale, t);
        return <ToneBadge key={b.key ?? idx} tone={tone}>{label}</ToneBadge>;
      })}
      {headerActions.map((action) => renderActionButton(action, 'outline'))}
    </ContentStack>
  ) : undefined;

  const renderField = (action: DeclarativeActionSpec<TData>, field: DeclarativeActionFieldSpec, multiField: boolean, disabled: boolean) => {
    const value = actionInputs[action.name]?.[field.key] ?? field.defaultValue ?? '';
    const setValue = (next: string) =>
      setActionInputs((prev) => ({ ...prev, [action.name]: { ...(prev[action.name] ?? {}), [field.key]: next } }));
    const label = pickText(field.label, locale, t);
    const hint = field.hint ? pickText(field.hint, locale, t) : undefined;
    const full = !multiField || field.type === 'textarea' || field.type === 'radio' || field.type === 'checkbox-group' || field.type === 'conversation';
    const options = (field.options ?? []).map((opt) => ({
      value: opt.value,
      label: pickText(opt.label, locale, t),
      description: opt.description ? pickText(opt.description, locale, t) : undefined,
      icon: opt.icon,
      badge: opt.badge,
      disabled: opt.disabled || disabled,
    }));
    const placeholder = field.placeholder ?? t('请输入{0}…', label);
    const id = `zhin-field-${action.name}-${field.key}`;
    if (field.type === 'switch') {
      return (
        <FormField key={field.key} label={label} full={full}>
          <SwitchRow checked={value === 'true'} onCheckedChange={(checked) => setValue(String(checked))} label={label} description={hint} disabled={disabled} />
        </FormField>
      );
    }
    let control: React.ReactNode;
    if (field.type === 'conversation') {
      control = (
        <ConversationPicker value={value} onChange={setValue} disabled={disabled} {...(field.conversationKinds ? { kinds: field.conversationKinds } : {})} />
      );
    } else if (field.type === 'radio' && field.options) {
      control = <RadioChoices aria-label={label} value={value} onValueChange={setValue} direction={field.direction} options={options} />;
    } else if (field.type === 'checkbox-group' && field.options) {
      control = (
        <CheckboxChoices value={value ? value.split(',').filter(Boolean) : []} onValueChange={(next) => setValue(next.join(','))} direction={field.direction} options={options} />
      );
    } else if (field.type === 'segmented' && field.options) {
      control = <SegmentedChoices aria-label={label} value={value || (field.options[0]?.value ?? '')} onValueChange={setValue} options={options} />;
    } else if (field.type === 'select' && field.options) {
      control = <ChoiceSelect id={id} aria-label={label} value={value} placeholder={field.placeholder ?? t('请选择…')} onValueChange={setValue} options={options} disabled={disabled} />;
    } else if (field.type === 'textarea') {
      control = <Textarea id={id} rows={field.rows ?? 3} placeholder={placeholder} value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)} />;
    } else {
      control = (
        <Input
          id={id}
          type={field.secret || field.type === 'password'
            ? 'password'
            : field.type === 'number' || field.type === 'date' || field.type === 'time' ? field.type : 'text'}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !disabled) {
              e.preventDefault();
              void runAction(action);
            }
          }}
        />
      );
    }
    return (
      <FormField key={field.key} label={label} hint={hint} required={field.required} full={full} htmlFor={id}>
        {control}
      </FormField>
    );
  };

  const renderSection = (section: DeclarativeSectionSpec<TData, Record<string, unknown>>, idx: number, sectionData: TData) => {
    const secKey = section.id ?? `sec-${idx}`;
    const rows: readonly Record<string, unknown>[] | undefined = section.items
      ? (typeof section.items === 'function'
        ? section.items(sectionData)
        : (() => {
            const resolved = resolveDataPath(sectionData, section.items);
            return Array.isArray(resolved) ? (resolved as readonly Record<string, unknown>[]) : [];
          })())
      : undefined;

    const entries = section.entries
      ? (typeof section.entries === 'function'
        ? section.entries(sectionData, ctx)
        : section.entries.map((entry) => {
            const inferredKey = entry.dataKey ?? (isDeclarativeValueExpr(entry.value) && typeof (entry.value as { $path?: unknown }).$path === 'string'
              ? (entry.value as { $path: string }).$path
              : undefined);
            const badgeLabel = entry.badge
              ? (isDeclarativeValueExpr(entry.badge.label)
                ? evaluateDeclarativeExpr(entry.badge.label, sectionData, locale, t)
                : pickText(entry.badge.label as DeclarativeI18nText, locale, t))
              : undefined;
            return {
              key: inferredKey,
              muted: isEntryMuted(entry.muted, sectionData, locale, t),
              badge: badgeLabel && badgeLabel !== '-' ? { label: badgeLabel, tone: resolveBadgeTone(entry.badge?.tone, sectionData, locale, t) } : undefined,
              hint: entry.hint ? pickText(entry.hint, locale, t) : undefined,
              label: typeof entry.label === 'string' || (entry.label && typeof entry.label === 'object' && ('zh' in entry.label || 'en' in entry.label || 'zh-CN' in entry.label))
                ? pickText(entry.label as DeclarativeI18nText, locale, t)
                : entry.label,
              value: isDeclarativeValueExpr(entry.value)
                ? evaluateDeclarativeExpr(entry.value, sectionData, locale, t)
                : entry.dataKey ? resolveDataPath(sectionData, entry.dataKey) : (entry.value as React.ReactNode),
            };
          }))
      : undefined;
    type EntryRow = { key?: string; label: React.ReactNode; value: unknown; hint?: React.ReactNode; muted?: boolean; badge?: { label: React.ReactNode; tone: BadgeTone } };
    const entryList: readonly EntryRow[] | undefined = entries
      ? (Array.isArray(entries)
        ? (entries as readonly EntryRow[])
        : Object.entries(entries as Readonly<Record<string, React.ReactNode>>).map(([label, value]) => ({ key: label, label, value })))
      : undefined;

    const renderEntries = (list: readonly EntryRow[]) => (
      <KeyValueList
        columns={section.columnsCount ?? 2}
        items={list.map((entry, entryIdx) => {
          const fieldKey = entry.key ?? (typeof entry.label === 'string' ? entry.label : undefined);
          const copyId = `${secKey}-entry-${entryIdx}`;
          const raw = entry.value;
          const copyText = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw).trim() : '';
          const alreadyCopyable = (typeof raw === 'string' && /^https?:\/\/\S+$/iu.test(raw.trim())) || Boolean(fieldKey && CODE_KEY_PATTERN.test(fieldKey));
          const quickCopy = Boolean(copyText && copyText !== '-' && copyText !== '—' && !alreadyCopyable && typeof raw !== 'boolean');
          return {
            key: copyId,
            label: entry.label,
            hint: entry.hint,
            muted: entry.muted,
            value: (
              <>
                {renderSmartValue(raw, fieldKey, copyId, copy, t)}
                {entry.badge ? <ToneBadge tone={entry.badge.tone}>{entry.badge.label}</ToneBadge> : null}
                {quickCopy ? <CopyValueButton copyKey={copyId} text={copyText} copy={copy} t={t} /> : null}
              </>
            ),
          };
        })}
      />
    );

    const renderRows = (list: readonly Record<string, unknown>[]) => {
      if (list.length === 0) return <EmptyBlock title={section.emptyText ? pickText(section.emptyText, locale, t) : t('暂无数据')} />;
      if (section.layout === 'timeline') {
        return (
          <Timeline
            items={list.map((row, rowIdx) => ({
              id: String(row.id ?? row.key ?? rowIdx),
              title: String(row.title ?? row.name ?? row.label ?? row.id ?? `#${rowIdx + 1}`),
              description: row.description !== undefined ? String(row.description) : (row.summary !== undefined ? String(row.summary) : undefined),
              time: row.time !== undefined ? String(row.time) : (row.createdAt !== undefined ? String(row.createdAt) : undefined),
              tone: contentTone((typeof row.tone === 'string' ? row.tone : classifySemanticStatus(String(row.status ?? ''))) as BadgeTone | undefined),
              badge: row.status !== undefined ? renderSmartValue(row.status, 'status', `${secKey}-tl-${rowIdx}`, copy, t) : undefined,
            }))}
          />
        );
      }
      if (section.columns && section.columns.length > 0 && section.layout !== 'cards') {
        const firstColumn = section.columns[0]?.key;
        const keyOf = (row: Record<string, unknown>, index: number) => rowKeyOf(row, index, section.rowKey, firstColumn);
        const columns: DataTableColumn<Record<string, unknown>>[] = section.columns.map((col) => ({
          ...col,
          render: col.render ? (value: unknown, row: Record<string, unknown>) => col.render!(value, row, ctx) : undefined,
        }));
        return (
          <DataTable
            columns={columns}
            rows={list}
            rowKey={section.rowKey}
            dictionary={spec.dictionary}
            emptyTitle={section.emptyText}
            {...(section.selectable || (section.batchActions && section.batchActions.length > 0) ? {
              selectable: true,
              selectedKeys: sectionSelections[secKey] ?? [],
              onSelectionChange: (keys: string[]) => setSectionSelections((prev) => ({ ...prev, [secKey]: keys })),
            } : {})}
            batchActions={section.batchActions?.map((ba) => ({
              key: ba.name,
              label: ba.label,
              icon: ba.icon,
              variant: ba.variant,
              confirm: ba.confirm,
              confirmLabel: ba.confirmLabel,
              busy: busyAction === `batch:${secKey}:${ba.name}`,
              onExecute: (selectedRows, selectedKeys) => runBatchAction(secKey, ba, selectedRows, selectedKeys),
            }))}
            rowActions={section.rowActions?.map((ra) => ({
              key: ra.name,
              label: ra.label,
              icon: ra.icon,
              variant: ra.variant,
              confirm: ra.confirm,
              confirmLabel: ra.confirmLabel,
              disabled: typeof ra.disabled === 'function' ? ((row) => (ra.disabled as (row: Record<string, unknown>) => boolean)(row)) : ra.disabled,
              busy: (row, index) => busyAction === `row:${secKey}:${ra.name}:${keyOf(row, index)}`,
              onExecute: (row, index) => runRowAction(secKey, ra, row, keyOf(row, index)),
            }))}
            renderExpandedRow={section.renderExpandedRow ? (row, index) => section.renderExpandedRow!(row, index, ctx) : undefined}
          />
        );
      }
      if (section.renderItem) {
        return (
          <ContentStack gap="tight">
            {list.map((row, rowIdx) => (
              <Card key={String(row.id ?? row.key ?? row.ownerKey ?? rowIdx)}>
                <CardContent>{section.renderItem?.(row, rowIdx, ctx)}</CardContent>
              </Card>
            ))}
          </ContentStack>
        );
      }
      // Automatic cards: IDs and nested objects stay behind 「技术详情」 (D18 第 6 条).
      return (
        <Grid>
          {list.map((row, rowIdx) => {
            const { shown, technical } = splitTechnicalFields(row);
            return (
              <RecordCard
                key={String(row.id ?? row.key ?? row.ownerKey ?? rowIdx)}
                fields={shown.map(([k, v]) => ({ key: k, label: k, value: renderSmartValue(v, k, `${secKey}-card-${rowIdx}-${k}`, copy, t) }))}
              >
                {technical.length > 0 ? (
                  <Disclosure summary={t('技术详情')}>
                    <KeyValueList columns={1} items={technical.map(([k, v]) => ({ key: k, label: k, value: renderSmartValue(v, k, `${secKey}-tech-${rowIdx}-${k}`, copy, t) }))} />
                  </Disclosure>
                ) : null}
              </RecordCard>
            );
          })}
        </Grid>
      );
    };

    const body = (
      <>
        {section.render ? section.render(sectionData, ctx) : null}
        {section.layout === 'json' ? <JsonValue value={rows ?? entryList ?? sectionData} t={t} /> : null}
        {entryList && section.layout !== 'json' ? renderEntries(entryList) : null}
        {rows && section.layout !== 'json' ? renderRows(rows) : null}
      </>
    );
    const title = section.title ? pickText(section.title, locale, t) : undefined;
    const sectionDescription = section.description ? pickText(section.description, locale, t) : undefined;
    if (section.collapsible) {
      return (
        <Disclosure
          key={secKey}
          summary={title ?? secKey}
          description={sectionDescription}
          defaultOpen={!section.defaultCollapsed}
          badge={rows ? <ToneBadge tone="neutral">{t('共 {0} 条', rows.length)}</ToneBadge> : undefined}
        >
          {body}
        </Disclosure>
      );
    }
    return (
      <Section key={secKey} id={section.id} title={title} description={sectionDescription}>
        {body}
      </Section>
    );
  };

  const renderStats = (statData: TData) => (
    <StatGrid label={t('统计')} data-stats="">
      {stats.map((stat, idx) => {
        const val = typeof stat.value === 'function' ? stat.value(statData, ctx) : evaluateDeclarativeExpr(stat.value, statData, locale, t);
        const hint = typeof stat.hint === 'function'
          ? stat.hint(statData)
          : isDeclarativeValueExpr(stat.hint) ? evaluateDeclarativeExpr(stat.hint, statData, locale, t) : (stat.hint ? pickText(stat.hint, locale, t) : undefined);
        const badgeLabel = stat.badge
          ? (typeof stat.badge.label === 'function'
            ? stat.badge.label(statData)
            : isDeclarativeValueExpr(stat.badge.label) ? evaluateDeclarativeExpr(stat.badge.label, statData, locale, t) : pickText(stat.badge.label, locale, t))
          : undefined;
        const rawProgress = typeof stat.progress === 'number'
          ? stat.progress
          : typeof stat.progress === 'string'
            ? Number(resolveDataPath(statData, stat.progress))
            : isDeclarativeValueExpr(stat.progress) ? Number(evaluateDeclarativeExpr(stat.progress, statData, locale, t)) : undefined;
        const sparkline = stat.sparkline ? resolveDataPath(statData, stat.sparkline) : undefined;
        const trendText = stat.trend
          ? (isDeclarativeValueExpr(stat.trend.value) ? evaluateDeclarativeExpr(stat.trend.value, statData, locale, t) : pickText(stat.trend.value, locale, t))
          : undefined;
        const trendTone: BadgeTone = stat.trend?.direction === 'down' ? 'warning' : 'neutral';
        const trendArrow = stat.trend?.direction === 'up' ? '↑ ' : stat.trend?.direction === 'down' ? '↓ ' : '';
        const tone = contentTone(stat.tone);
        return (
          <StatCard
            key={stat.key ?? idx}
            label={pickText(stat.label, locale, t)}
            icon={stat.image ?? stat.icon}
            value={val}
            unit={stat.unit ? pickText(stat.unit, locale, t) : undefined}
            tone={tone === 'danger' || tone === 'warning' ? tone : undefined}
            badge={stat.badge ? <ToneBadge tone={resolveBadgeTone(stat.badge.tone, statData, locale, t)}>{badgeLabel}</ToneBadge> : undefined}
            aside={trendText || (Array.isArray(sparkline) && sparkline.length >= 2) ? (
              <>
                {trendText ? <ToneBadge tone={trendTone}>{trendArrow}{trendText}</ToneBadge> : null}
                {Array.isArray(sparkline) && sparkline.length >= 2 ? <Sparkline values={sparkline.map(Number).filter(Number.isFinite)} tone={tone} /> : null}
              </>
            ) : undefined}
            footer={rawProgress !== undefined && Number.isFinite(rawProgress) ? <ProgressMeter value={rawProgress} tone={tone} /> : undefined}
            sub={hint}
          />
        );
      })}
    </StatGrid>
  );

  const renderSections = (sectionData: TData) => {
    const allSections = spec.sections ?? [];
    const tabLabels = Array.from(new Set(allSections.map((s) => (s.tab ? pickText(s.tab, locale, t) : '')).filter(Boolean)));
    const currentTab = activeTab && tabLabels.includes(activeTab) ? activeTab : (tabLabels[0] ?? '');
    const visible = tabLabels.length > 1 ? allSections.filter((s) => !s.tab || pickText(s.tab, locale, t) === currentTab) : allSections;
    return (
      <>
        {tabLabels.length > 1 ? (
          <Tabs value={currentTab} onValueChange={setActiveTab}>
            <TabsList>
              {tabLabels.map((label) => <TabsTrigger key={label} value={label}>{label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        ) : null}
        {visible.map((section, idx) => renderSection(section, allSections.indexOf(section) >= 0 ? allSections.indexOf(section) : idx, sectionData))}
      </>
    );
  };

  const ready = data !== undefined && resource.state !== 'empty';
  const page = (
    <RendererPage
      title={resolvedTitle}
      description={description}
      actions={chromeActions}
      chromeDeps={[data, busyAction, locale, spec, pluginId]}
      refresh={{
        onRefresh: resource.refresh,
        updatedAt: resource.lastSuccessAt ?? null,
        intervalMs: pollIntervalMs,
        onIntervalChange: setPollIntervalMs,
        refreshing: resource.refreshing,
      }}
      data-zhin-plugin-id={pluginId}
    >
      {notice ? <NoticeBlock tone={notice.tone} onDismiss={() => setNotice(undefined)} dismissLabel={t('关闭')}>{notice.message}</NoticeBlock> : null}
      {headerActions.map((a) => (actionResults[a.name] ? <React.Fragment key={`header-res-${a.name}`}>{renderActionResultPreview(a.name, actionResults[a.name])}</React.Fragment> : null))}

      {resource.state === 'loading' ? <LoadingBlock label={t('加载中…')} /> : null}
      {resource.state === 'error' ? (
        <ErrorBlock message={`${t('加载失败')}：${formatError(resource.error, t)}`} details={resource.error?.message} onRetry={() => { void resource.refresh(); }} />
      ) : null}
      {resource.state === 'stale' ? (
        <NoticeBlock tone="warning">
          {resource.lastSuccessAt !== undefined ? t('数据可能已过期，上次成功 {0}', new Date(resource.lastSuccessAt).toLocaleTimeString()) : t('数据可能已过期')}
          {resource.error?.message ? ` ${t('最近一次刷新失败：{0}', resource.error.message)}` : ''}
        </NoticeBlock>
      ) : null}
      {resource.state === 'empty' ? (
        <EmptyBlock
          title={spec.emptyTitle ? pickText(spec.emptyTitle, locale, t) : t('暂无数据')}
          description={spec.emptyDescription ? pickText(spec.emptyDescription, locale, t) : undefined}
        />
      ) : null}

      {ready && stats.length > 0 ? renderStats(data) : null}

      {ready && formActions.length > 0 ? (
        <Section id="zhin-actions-section" title={t('操作')}>
          <Grid min="24rem">
            {formActions.map((action) => {
              const isBusy = busyAction === action.name;
              const isDisabled = typeof action.disabled === 'function' ? action.disabled(data) : Boolean(action.disabled);
              const fields = action.fields ?? [];
              return (
                <Card key={action.name} id={`zhin-action-${action.name}`}>
                  <CardHeader>
                    <CardTitle>{pickText(action.label, locale, t)}</CardTitle>
                    {action.description ? <span className="console-form-field-hint">{pickText(action.description, locale, t)}</span> : null}
                  </CardHeader>
                  <CardContent>
                    <ContentStack>
                      <Grid min="14rem">
                        {fields.map((field) => renderField(action, field, fields.length >= 2, isDisabled || isBusy))}
                      </Grid>
                      <ContentStack direction="row" gap="tight">{renderActionButton(action, 'default')}</ContentStack>
                      {renderActionResultPreview(action.name, actionResults[action.name])}
                      {action.result && action.name in inlineResults ? (
                        <ActionInlineResult
                          name={action.name}
                          spec={action.result}
                          result={inlineResults[action.name]?.result ?? {}}
                          fallbackTone={inlineResults[action.name]?.tone}
                          message={inlineResults[action.name]?.message}
                          locale={locale}
                          t={t}
                          onDismiss={() => setInlineResults((prev) => {
                            const next = { ...prev };
                            delete next[action.name];
                            return next;
                          })}
                        />
                      ) : null}
                    </ContentStack>
                  </CardContent>
                </Card>
              );
            })}
          </Grid>
        </Section>
      ) : null}

      {ready ? renderSections(data) : null}
      {ready && spec.render ? spec.render(data, ctx) : null}
      {spec.footnote ? <p className="console-form-field-hint">{pickText(spec.footnote, locale, t)}</p> : null}
    </RendererPage>
  );
  return usesConversations
    ? <ConversationDirectoryContext.Provider value={conversations}>{page}</ConversationDirectoryContext.Provider>
    : page;
}

DeclarativePageView.capabilities = DECLARATIVE_PAGE_CAPABILITIES;

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
