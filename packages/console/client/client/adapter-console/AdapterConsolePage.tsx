import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleEndpointSummary } from '@zhin.js/console-protocol';
import { adapterConsoleStyles } from './styles.js';
import { consoleRpc, getApiBase, getToken, pluginRpc, PluginRpcError } from '../console-utils/remoteApi.js';
import {
  adapterConsoleLocale,
  adapterConsoleText as t,
  pickI18n,
  type AdapterConsoleLocale,
} from './messages.js';
import { Badge, Button, ConfirmButton, EmptyState, ErrorState, Field, LoadingState, Notice, PageHeader, PluginPage, Section, StaleNotice, type BadgeTone } from '../ui/components.js';
import { resolvePluginId } from '../ui/plugin-id.js';
import { usePluginRpc, useRpcResource } from '../ui/rpc.js';
import type {
  AdapterConsoleActionResult,
  AdapterConsoleActionView,
  AdapterConsoleFieldView,
  AdapterConsoleConnectionTest,
  AdapterConsoleLoginTask,
  AdapterConsoleStatus,
  AdapterConsoleRuntimeView,
  AdapterConsoleRuntimeEndpoint,
  AdapterConsoleMutationResult,
  AdapterConsoleExecution,
} from './types.js';

type PageNotice = {
  readonly kind: 'ok' | 'error';
  readonly message: string;
  readonly url?: string;
  readonly image?: string;
};

const PAGE_POLL_MS = 6_000;
/** 登录验证剩余多少秒时，向读屏软件播报一次“即将过期”。 */
const EXPIRY_WARNING_SECONDS = 10;

/** 把失败说成用户能据此行动的话；原始信息只放在技术详情里。 */
function describeError(error: unknown, locale: AdapterConsoleLocale, context: string): string {
  if (error instanceof PluginRpcError) {
    if (error.code === 'forbidden') return t(locale, '{0}：没有权限。请联系管理员，或换用有权限的令牌。', context);
    if (error.code === 'unavailable' || error.code === 'timeout') return t(locale, '{0}：Host 暂时无法响应，请稍后重试。', context);
    if (error.code === 'not_found') return t(locale, '{0}：插件未加载或未提供该操作，请确认插件已启用后刷新。', context);
    return t(locale, '{0}：{1}', context, error.message);
  }
  if (error instanceof TypeError) return t(locale, '{0}：无法连接 Host，请检查网络或 Host 是否在运行。', context);
  if (error instanceof Error && error.message) return t(locale, '{0}：{1}', context, error.message);
  return t(locale, '{0}：原因未知，请刷新后重试。', context);
}

function technicalDetails(error: Error | undefined): string | undefined {
  if (!error) return undefined;
  return error instanceof PluginRpcError ? `${error.code} (HTTP ${error.status}): ${error.message}` : error.message;
}

function endpointId(endpoint: ConsoleEndpointSummary): string {
  return endpoint.name || endpoint.endpoint?.id || '';
}

function endpointAdapter(endpoint: ConsoleEndpointSummary): string {
  return endpoint.endpoint?.adapter ?? endpoint.adapter;
}

/** Private closure; credentials never become React keys, DTOs or persisted state. */
function captureAdapterConsoleContext(): () => boolean {
  const base = typeof localStorage === 'undefined' ? '' : getApiBase();
  const token = getToken();
  const path = typeof location === 'undefined' ? '' : location.pathname;
  return () => base === (typeof localStorage === 'undefined' ? '' : getApiBase())
    && token === getToken() && path === (typeof location === 'undefined' ? '' : location.pathname);
}

function runtimeLoginMatches(task: AdapterConsoleLoginTask, runtime: AdapterConsoleRuntimeView): boolean {
  const identity = task.endpointIdentity;
  return !!identity && typeof identity.incarnationId === 'string' && !!identity.incarnationId && runtime.endpoints.some(endpoint => endpoint.desiredEnabled && !endpoint.retiring && !endpoint.removed
    && endpoint.canonicalId === identity.canonicalId && endpoint.instanceId === identity.instanceId && endpoint.epoch === identity.epoch && endpoint.incarnationId === identity.incarnationId);
}

function operationLabel(action: AdapterConsoleExecution['action'], locale: AdapterConsoleLocale): string {
  const labels = { add: '保存', update: '保存', start: '启动', stop: '停止', remove: '删除', replace: '替换' };
  return t(locale, labels[action] ?? '操作');
}

function executionLabel(execution: AdapterConsoleExecution, locale: AdapterConsoleLocale): string {
  if (execution.status === 'failed') return execution.code === 'endpoint_cleanup_failed'
    ? t(locale, '关闭未完成') : t(locale, '{0}失败', operationLabel(execution.action, locale));
  return t(locale, execution.status === 'pending' ? '操作进行中' : '已完成');
}

function renderConfigInput({ field, locale, value, disabled, placeholder, onValueChange, allowDefault = true }: {
  field: AdapterConsoleFieldView;
  locale: AdapterConsoleLocale;
  value: string;
  disabled: boolean;
  placeholder?: string;
  onValueChange: (value: string) => void;
  allowDefault?: boolean;
}) {
  if (field.type === 'boolean' && !field.secret && !field.env) {
    return <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
      <option value="" disabled={!allowDefault || field.required}>{t(locale, '未设置，使用默认值')}</option>
      <option value="true">{t(locale, '已开启')}</option>
      <option value="false">{t(locale, '已关闭')}</option>
    </select>;
  }
  return <input disabled={disabled} type={field.secret || field.env ? 'password' : field.type === 'number' ? 'number' : 'text'}
    autoComplete={field.secret || field.env ? 'off' : undefined} value={value} placeholder={placeholder} onChange={event => onValueChange(event.target.value)} />;
}

/** `known` 为 false 表示连接列表还没读到：不能把“不知道”显示成“离线”。 */
function connectionTone(endpoint: ConsoleEndpointSummary | undefined, known: boolean): BadgeTone {
  if (!known) return 'neutral';
  if (!endpoint) return 'neutral';
  if (endpoint.pendingLogin) return 'warning';
  if (endpoint.connected && endpoint.status === 'online') return 'success';
  if (endpoint.transportState === 'connecting' || endpoint.transportState === 'reconnecting') return 'warning';
  return 'danger';
}

function connectionLabel(endpoint: ConsoleEndpointSummary | undefined, locale: AdapterConsoleLocale, known: boolean): string {
  if (!known) return t(locale, '状态未知');
  if (!endpoint) return t(locale, '离线');
  if (endpoint.pendingLogin) return t(locale, '等待登录');
  if (endpoint.connected && endpoint.status === 'online') return t(locale, '在线');
  if (endpoint.transportState === 'connecting') return t(locale, '连接中');
  if (endpoint.transportState === 'reconnecting') return t(locale, '重连中');
  if (endpoint.transportState === 'stopped') return t(locale, '已停止');
  if (endpoint.transportState === 'open') return t(locale, '已连接');
  if (endpoint.transportState === 'closed') return t(locale, '已断开');
  if (endpoint.transportState === 'idle') return t(locale, '未连接');
  if (endpoint.transportState && endpoint.transportState !== 'unknown') return endpoint.transportState;
  return t(locale, '离线');
}

function loginTypeLabel(type: string, locale: AdapterConsoleLocale): string {
  switch (type) {
    case 'qrcode': return t(locale, '二维码');
    case 'slider': return t(locale, '滑块验证');
    case 'sms': return t(locale, '短信验证');
    case 'device': return t(locale, '设备确认');
    case 'auth': return t(locale, '登录确认');
    default: return t(locale, '其他验证');
  }
}

function isImageSource(value: string): boolean {
  return /^data:image\//u.test(value) || /^https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s]*)?$/iu.test(value);
}

function isLink(value: string): boolean {
  return /^https?:\/\//u.test(value);
}

export interface AdapterConsolePageProps {
  /** Adapter type key (e.g. `telegram`, `wechat-mp`). */
  readonly adapterKey: string;
}

/**
 * Shared React page body for adapter Console pages.
 *
 * It reads the adapter's `plugin.<pluginId>.status`, the Host's `endpoint.list` /
 * `endpoint.test`, and LoginAssist's `login.list` / `login.submit` / `login.cancel`.
 * Adapter-specific controls come from `status.actions` (for example QQ QR binding).
 */
export function AdapterConsolePage({ adapterKey }: AdapterConsolePageProps) {
  const [connection, setConnection] = useState(0);
  const context = useRef(captureAdapterConsoleContext());
  useEffect(() => {
    const check = () => {
      if (context.current()) return;
      context.current = captureAdapterConsoleContext();
      setConnection(value => value + 1);
    };
    window.addEventListener('storage', check);
    window.addEventListener('zhin:auth-required', check);
    window.addEventListener('focus', check);
    const timer = setInterval(check, PAGE_POLL_MS);
    return () => {
      window.removeEventListener('storage', check);
      window.removeEventListener('zhin:auth-required', check);
      window.removeEventListener('focus', check);
      clearInterval(timer);
    };
  }, []);
  return <AdapterConsoleSession key={`${adapterKey}:${connection}`} adapterKey={adapterKey} isCurrent={context.current} />;
}

type EditorState = { instanceId: string; id: string; originalId: string; values: Record<string, string>; originalValues: Readonly<Record<string, string>>; generation: number; revision: number | null };

function AdapterConsoleSession({ adapterKey, isCurrent }: AdapterConsolePageProps & { readonly isCurrent: () => boolean }) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = useCallback(() => alive.current && isCurrent(), [isCurrent]);
  const locale = useMemo(adapterConsoleLocale, []);

  // Event handlers may outlive their render; admit login only against the latest accepted response.
  const latestRuntime = useRef<AdapterConsoleRuntimeView | undefined>(undefined);
  const returnFocus = useRef<HTMLElement | null>(null);

  // 三份互不相干的读取：各自的加载 / 失败 / 过期状态，不混在一个 error 里。
  const owner = useRpcResource<string | undefined>(`owner:${adapterKey}`, () => resolvePluginId({ adapter: adapterKey }), { isCurrent: current, isEmpty: value => value === undefined });
  const pluginId = owner.data;
  const statusRead = usePluginRpc<AdapterConsoleStatus>(pluginId, 'status', undefined, { pollMs: PAGE_POLL_MS, isCurrent: current });
  const endpointRead = useRpcResource<{ endpoints?: readonly ConsoleEndpointSummary[] }>('endpoint.list', () => consoleRpc('endpoint.list'), { pollMs: PAGE_POLL_MS, isCurrent: current });
  const loginRead = useRpcResource<{ tasks?: readonly AdapterConsoleLoginTask[] }>('login.list', () => consoleRpc('login.list'), { pollMs: PAGE_POLL_MS, isCurrent: current });
  const status = statusRead.data;
  const runtime = status?.runtime;
  latestRuntime.current = runtime;
  const connectionsKnown = endpointRead.lastSuccessAt !== undefined;
  const endpoints = useMemo(() => endpointRead.data?.endpoints ?? [], [endpointRead.data]);
  const loginTasks = useMemo(() => (loginRead.data?.tasks ?? []).filter(task => task.adapter === adapterKey), [loginRead.data, adapterKey]);

  const [notice, setNotice] = useState<PageNotice | undefined>();
  const [busy, setBusy] = useState<Readonly<Record<string, true>>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState('');
  const [addValues, setAddValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [actionValues, setActionValues] = useState<Record<string, Record<string, string>>>({});
  const [actionResults, setActionResults] = useState<Record<string, AdapterConsoleActionResult>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [loginValues, setLoginValues] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [runtimeBlocked, setRuntimeBlocked] = useState(false);
  const [migration, setMigration] = useState<{ run: () => Promise<void>; ids: readonly string[] }>();
  const [editor, setEditor] = useState<EditorState>();
  const [addBase, setAddBase] = useState<{ generation: number; revision: number | null }>();

  const isBusy = (key: string) => busy[key] === true;
  /** 只有会改账号清单（CAS）的操作互斥；刷新、测试连接、登录提交各自独立。 */
  const mutating = Object.keys(busy).some(key => key.startsWith('mutate:'));
  const refreshAll = async (): Promise<boolean> => {
    const results = await Promise.all([statusRead.refresh(), endpointRead.refresh(), loginRead.refresh()]);
    return results[0];
  };
  const reread = async () => {
    if (await refreshAll()) { setRuntimeBlocked(false); setMigration(undefined); setNotice(undefined); }
  };

  const rememberTrigger = () => { returnFocus.current = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null; };
  const restoreTrigger = () => {
    const element = returnFocus.current;
    returnFocus.current = null;
    if (element) setTimeout(() => { if (element.isConnected) element.focus(); }, 0);
  };

  useEffect(() => {
    if (loginTasks.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [loginTasks.length]);

  // 成功提示 8 秒后消失；错误提示必须由用户处理或问题解决，不自动消失。
  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const timer = setTimeout(() => setNotice(undefined), 8_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const adapterEndpoints = useMemo(
    () => endpoints.filter((endpoint) => endpointAdapter(endpoint) === adapterKey),
    [endpoints, adapterKey],
  );
  const endpointById = useMemo(() => {
    const map = new Map<string, ConsoleEndpointSummary>();
    for (const endpoint of adapterEndpoints) {
      map.set(endpointId(endpoint), endpoint);
      if (endpoint.endpoint?.id) map.set(endpoint.endpoint.id, endpoint);
    }
    return map;
  }, [adapterEndpoints]);
  const runningIds = useMemo(() => {
    if (status && status.running.length > 0) return status.running.map((item) => item.id);
    return adapterEndpoints.map(endpointId).filter((id): id is string => Boolean(id));
  }, [status, adapterEndpoints]);
  const runningModes = useMemo(
    () => new Map((status?.running ?? []).map((item) => [item.id, item.mode])),
    [status],
  );

  const run = async (key: string, context: string, action: () => Promise<void>) => {
    if (!current()) return;
    setBusy(value => ({ ...value, [key]: true }));
    try {
      await action();
    } catch (runError) {
      if (current()) setNotice({ kind: 'error', message: describeError(runError, locale, context) });
    } finally {
      if (current()) setBusy(value => { const { [key]: _done, ...rest } = value; return rest; });
    }
  };

  const testConnection = (id: string) => run(`test:${id}`, t(locale, '测试连接'), async () => {
    const result = await consoleRpc<AdapterConsoleConnectionTest>('endpoint.test', {
      adapter: adapterKey,
      endpointKey: id,
    });
    if (!current()) return;
    const detail = result.message ?? (result.connected ? t(locale, '在线') : t(locale, '离线'));
    setNotice(result.connected
      ? { kind: 'ok', message: result.latencyMs === undefined ? t(locale, '连接测试通过：{0}', detail) : t(locale, '连接测试通过：{0}（{1} ms）', detail, result.latencyMs) }
      : { kind: 'error', message: t(locale, '连接测试未通过：{0}。请确认账号已启动、网络可用，必要时查看登录待办。', detail) });
    await endpointRead.refresh();
  });

  const runtimeMutation = async (action: string, payload: Record<string, unknown>, base: { generation: number; revision: number | null }, done?: () => void) => {
    if (!pluginId || !runtime || !runtime.canManage || runtimeBlocked || !current()) return;
    const key = `mutate:${action}:${String(payload.instanceId ?? '')}`;
    const perform = async (confirmed = false) => {
      if (!current()) return;
      setBusy(value => ({ ...value, [key]: true }));
      try {
        const result = await pluginRpc<AdapterConsoleMutationResult>(pluginId, `endpoint-${action}`, {
          ...payload, expectedGeneration: base.generation, expectedRevision: base.revision,
          ...(confirmed ? { confirmMigration: true } : {}),
        });
        if (!current()) return;
        latestRuntime.current = result.runtime;
        statusRead.mutate(previous => previous ? { ...previous, runtime: result.runtime } : previous);
        done?.();
        setMigration(undefined);
        setNotice({ kind: result.execution.status === 'failed' ? 'error' : 'ok', message: t(locale,
          result.execution.status === 'failed' ? '配置已保存，执行失败。请查看账号状态。'
            : action === 'add' || action === 'replace' ? '已保存，请手动启动账号。'
              : result.execution.status === 'pending' ? '已保存，操作进行中。' : '已保存。') });
        await refreshAll();
      } catch (mutationError) {
        if (!current()) return;
        const knownInvalid = mutationError instanceof PluginRpcError && mutationError.code === 'invalid_input';
        if (!knownInvalid) setRuntimeBlocked(true);
        setMigration(undefined);
        setNotice({ kind: 'error', message: t(locale, knownInvalid ? '输入无效，请检查账号字段。'
          : mutationError instanceof PluginRpcError && mutationError.code === 'conflict' ? '账号清单已变化，请刷新后重新操作。'
            : mutationError instanceof PluginRpcError && mutationError.code === 'forbidden' ? '没有此操作的权限。'
              : !(mutationError instanceof PluginRpcError) || mutationError.code === 'commit_unknown' ? '提交结果尚未确认，请刷新核实，不要重复提交。'
              : '操作未能完成，请刷新账号清单。') });
      } finally { if (current()) setBusy(value => { const { [key]: _done, ...rest } = value; return rest; }); }
    };
    if (runtime.needsMigration) {
      if (!runtime.canMigrate) { setNotice({ kind: 'error', message: t(locale, '首次迁移需要管理员确认。') }); return; }
      setMigration({ ids: (status?.configured ?? []).map(entry => entry.id), run: () => perform(true) });
    } else await perform();
  };

  const toggleAdd = () => {
    if (!runtime) return;
    if (addOpen) { setAddId(''); setAddValues({}); setFormError(undefined); restoreTrigger(); } else rememberTrigger();
    setAddOpen(open => !open);
    setAddBase({ generation: runtime.generation, revision: runtime.revision });
  };

  const addEndpoint = async () => {
    if (!pluginId || !status?.runtime) return;
    const id = addId.trim();
    if (!id) { setFormError(t(locale, '请填写 {0}', t(locale, '账号 ID'))); return; }
    if (status.idPattern) {
      let pattern: RegExp | undefined;
      try { pattern = new RegExp(status.idPattern, 'u'); } catch { pattern = undefined; }
      if (pattern && !pattern.test(id)) {
        setFormError(pickI18n(locale, status.idHint, status.idHintI18n) ?? t(locale, '账号 ID 格式不正确'));
        return;
      }
    }
    setFormError(undefined);
    await runtimeMutation('add', { id, values: addValues }, addBase ?? status.runtime, () => { setAddOpen(false); setAddId(''); setAddValues({}); restoreTrigger(); });
  };

  const submitLogin = (task: AdapterConsoleLoginTask, value: string) => run(`login:${task.id}`, t(locale, '提交登录验证'), async () => {
    if (!latestRuntime.current || !runtimeLoginMatches(task, latestRuntime.current)) return;
    await consoleRpc('login.submit', { taskId: task.id, value, ...(task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}) });
    if (!current()) return;
    setLoginValues((values) => ({ ...values, [task.id]: '' }));
    setNotice({ kind: 'ok', message: t(locale, '已提交。') });
    await refreshAll();
  });

  const cancelLogin = (task: AdapterConsoleLoginTask) => run(`login-cancel:${task.id}`, t(locale, '取消登录验证'), async () => {
    if (!latestRuntime.current || !runtimeLoginMatches(task, latestRuntime.current)) return;
    await consoleRpc('login.cancel', { taskId: task.id, reason: 'console_cancelled', ...(task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}) });
    if (!current()) return;
    await refreshAll();
  });

  const validateAction = (action: AdapterConsoleActionView): boolean => {
    const values = actionValues[action.name] ?? {};
    let problem: string | undefined;
    for (const field of action.fields) {
      if (field.required && !(values[field.key] ?? '').trim()) {
        problem = t(locale, '请输入 {0}', pickI18n(locale, field.label, field.labelI18n) ?? field.key);
        break;
      }
    }
    if (!problem && action.options.length > 0 && !values.value) problem = t(locale, '请选择…');
    setActionErrors(errors => { const { [action.name]: _old, ...rest } = errors; return problem ? { ...rest, [action.name]: problem } : rest; });
    return !problem;
  };

  const runAction = (action: AdapterConsoleActionView) => run(action.accountMutation ? `mutate:action:${action.name}` : `action:${action.name}`, pickI18n(locale, action.label, action.labelI18n) ?? action.name, async () => {
    if (!pluginId) return;
    if (!validateAction(action)) return;
    const input: Record<string, string> = { ...(actionValues[action.name] ?? {}) };
    const base = status?.runtime;
    const perform = async (confirmed = false) => {
      if (!current()) return;
      const result = await pluginRpc<AdapterConsoleActionResult>(pluginId, action.name, {
        ...input,
        ...(base ? { expectedGeneration: base.generation, expectedRevision: base.revision } : {}),
        ...(confirmed ? { confirmMigration: true } : {}),
      });
      if (!current()) return;
      setActionResults((results) => ({ ...results, [action.name]: result ?? {} }));
      if (result?.message) {
        setNotice({
          kind: result.tone === 'error' ? 'error' : 'ok',
          message: result.message,
          ...(result.url ? { url: result.url } : {}),
          ...(result.image ? { image: result.image } : {}),
        });
      }
      await refreshAll();
      setMigration(undefined);
    };
    if (action.accountMutation) {
      if (!status || !base?.canManage || runtimeBlocked) return;
      if (base.needsMigration) {
        if (!base.canMigrate) { setNotice({ kind: 'error', message: t(locale, '首次迁移需要管理员确认。') }); return; }
        setMigration({ ids: status.configured.map(entry => entry.id), run: () => perform(true) });
        return;
      }
    }
    await perform();
  });

  const visibleLogins = runtime ? loginTasks.filter(task => runtimeLoginMatches(task, runtime)) : [];

  const openEdit = (endpoint: AdapterConsoleRuntimeEndpoint) => {
    if (!runtime || !status) return;
    const entry = status.configured.find(value => value.instanceId === endpoint.instanceId);
    if (!entry) return;
    const values = Object.fromEntries(status.fields.filter(field => !field.secret && !field.env && field.key !== 'id')
      .map(field => [field.key, entry.values[field.key] ?? '']));
    rememberTrigger();
    setFormError(undefined);
    setEditor({ instanceId: endpoint.instanceId, id: endpoint.endpointId, originalId: endpoint.endpointId,
      values, originalValues: entry.values, generation: runtime.generation, revision: runtime.revision });
  };
  const closeEdit = () => { setEditor(undefined); setFormError(undefined); restoreTrigger(); };
  const editorReplacing = !!editor && !!runtime && (editor.id.trim() !== editor.originalId
    || runtime.identityFields.some(key => key !== 'id' && Object.hasOwn(editor.values, key) && editor.values[key] !== (editor.originalValues[key] ?? '')));
  /** 收集要提交的字段；缺必填项时在表单内提示并返回 undefined。 */
  const collectEdit = (): Record<string, string> | undefined => {
    if (!editor || !runtime || !status) return undefined;
    if (editorReplacing && !runtime.canReplace) return undefined;
    const allowed = editorReplacing ? status.fields : status.fields.filter(field => runtime.mutableFields.includes(field.key));
    const values: Record<string, string> = {};
    for (const field of allowed) {
      if (field.key === 'id') continue;
      const value = editor.values[field.key] ?? '';
      if (editorReplacing && field.required && !value.trim()) { setFormError(t(locale, '请填写 {0}', field.key)); return undefined; }
      if (!editorReplacing && (field.secret || field.env) && !value.trim()) continue;
      if (editorReplacing || value !== (editor.originalValues[field.key] ?? '')) values[field.key] = value;
    }
    setFormError(undefined);
    return values;
  };
  const saveEdit = async () => {
    if (!editor || !runtime) return;
    const values = collectEdit();
    if (!values) return;
    await runtimeMutation(editorReplacing ? 'replace' : 'update', { instanceId: editor.instanceId, ...(editorReplacing ? { id: editor.id.trim() } : {}), values }, editor, closeEdit);
  };

  const title = status?.displayName ?? t(locale, '适配器 Console');
  const docsUrl = status?.docsUrl;
  const mutationLocked = !runtime?.canManage || runtimeBlocked || !!migration || !!(runtime?.needsMigration && !runtime.canMigrate);
  const addDisabled = mutationLocked || mutating;
  const hasSidebar = !!status && (status.actions.length > 0 || Object.keys(status.extra ?? {}).length > 0);
  const statusError = statusRead.error;

  return (
    <PluginPage>
      <style>{adapterConsoleStyles}</style>
      <PageHeader
        title={title}
        mark={status ? title.slice(0, 2) : undefined}
        description={status ? t(locale, runtime ? '管理 {0} 的账号与登录。' : '查看 {0} 的连接与账号配置。', title) : undefined}
        actions={<>
          {docsUrl && <a href={docsUrl} target="_blank" rel="noreferrer" className="zk-btn zk-btn--secondary">{t(locale, '文档')}</a>}
          <Button busy={isBusy('refresh')} onClick={() => run('refresh', t(locale, '刷新'), reread)}>{isBusy('refresh') ? t(locale, '刷新中…') : t(locale, '刷新')}</Button>
          {runtime && status?.canAdd && <Button variant="primary" disabled={addDisabled} aria-expanded={addOpen} aria-controls="adapter-add-account" onClick={toggleAdd}>{addOpen ? t(locale, '取消') : t(locale, '添加')}</Button>}
        </>}
      />

      {status && <nav className="zk-nav" aria-label={t(locale, '页面导航')}>
        <a href="#adapter-accounts">{t(locale, '账号')}<span className="zk-count">{runtime?.endpoints.length ?? status.configured.length}</span></a>
        {visibleLogins.length > 0 && <a href="#adapter-logins">{t(locale, '登录待办')}<span className="zk-count">{visibleLogins.length}</span></a>}
        {status.actions.length > 0 && <a href="#adapter-tools">{t(locale, '平台操作')}</a>}
      </nav>}

      {notice && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} onDismiss={() => setNotice(undefined)}>
        {notice.message}
        {notice.url && <> · <a href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a></>}
        {/* 二维码必须黑码白底才能被扫描，所以图片容器固定白底。 */}
        {notice.image && <div><img className="zk-qr" src={notice.image} alt={t(locale, '操作返回的图片')} /></div>}
      </Notice>}

      {owner.state === 'loading' && <LoadingState label={t(locale, '正在解析插件…')} rows={1} />}
      {owner.state === 'error' && <ErrorState title={t(locale, '无法确定本页所属插件')} message={describeError(owner.error, locale, t(locale, '解析插件'))}
        details={technicalDetails(owner.error)} onRetry={() => owner.refresh()} retrying={owner.refreshing} />}
      {owner.state === 'empty' && <ErrorState title={t(locale, '找不到页面所属插件')} message={t(locale, '请确认该适配器插件已启用，并刷新页面。')} onRetry={() => owner.refresh()} retrying={owner.refreshing} />}

      {pluginId && statusRead.state === 'loading' && <LoadingState />}
      {statusRead.state === 'error' && <ErrorState title={t(locale, '无法读取账号状态')} message={describeError(statusError, locale, t(locale, '读取账号状态'))}
        details={technicalDetails(statusError)} onRetry={() => statusRead.refresh()} retrying={statusRead.refreshing} />}
      {statusRead.state === 'stale' && <StaleNotice lastSuccessAt={statusRead.lastSuccessAt} error={describeError(statusError, locale, t(locale, '读取账号状态'))} />}
      {endpointRead.state === 'error' && <Notice tone="warning" title={t(locale, '无法读取连接状态')}
        actions={<Button size="sm" busy={endpointRead.refreshing} onClick={() => endpointRead.refresh()}>{t(locale, '重试')}</Button>}>
        {t(locale, '账号的在线状态暂时显示为未知。')}
      </Notice>}
      {endpointRead.state === 'stale' && <StaleNotice lastSuccessAt={endpointRead.lastSuccessAt} error={describeError(endpointRead.error, locale, t(locale, '读取连接状态'))} />}
      {loginRead.state === 'error' && <Notice tone="warning" title={t(locale, '无法读取登录待办')}
        actions={<Button size="sm" busy={loginRead.refreshing} onClick={() => loginRead.refresh()}>{t(locale, '重试')}</Button>}>
        {describeError(loginRead.error, locale, t(locale, '读取登录待办'))}
      </Notice>}

      {!runtime && status && <Section title={t(locale, '运行中的连接')}>
        {runningIds.length === 0
          ? <p className="zk-hint">{t(locale, '还没有运行中的连接。')}</p>
          : (
            <ul className="zk-list">
              {runningIds.map((id) => {
                const endpoint = endpointById.get(id);
                const mode = runningModes.get(id);
                return (
                  <li key={id} className="zk-card">
                    <div className="zk-account__head">
                      <Badge tone={connectionTone(endpoint, connectionsKnown)}>{connectionLabel(endpoint, locale, connectionsKnown)}</Badge>
                      <strong>{id}</strong>
                      {mode && <span className="zk-hint">{t(locale, '模式：{0}', mode)}</span>}
                      {endpoint?.pendingLogin && <Badge tone="warning">{t(locale, '等待登录')}</Badge>}
                      <span className="zk-grow" />
                      <Button busy={isBusy(`test:${id}`)} onClick={() => testConnection(id)}>{t(locale, '测试连接')}</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </Section>}

      {visibleLogins.length > 0 && (
        <Section id="adapter-logins" title={t(locale, '登录待办')} description={t(locale, '完成验证后，账号即可继续连接。')}>
          <ul className="zk-list">
            {visibleLogins.map((task) => {
              const image = typeof task.payload.image === 'string' ? task.payload.image : undefined;
              const url = typeof task.payload.url === 'string' ? task.payload.url : undefined;
              const message = typeof task.payload.message === 'string' ? task.payload.message : undefined;
              const needsValue = task.type === 'slider' || task.type === 'device' || task.type === 'sms' || task.type === 'other';
              const remaining = task.expiresAt ? Math.max(0, Math.ceil((task.expiresAt - now) / 1_000)) : undefined;
              const expired = remaining === 0;
              const submitBusy = isBusy(`login:${task.id}`);
              return (
                <li key={task.id} className="zk-card">
                  <div className="zk-account__head">
                    <Badge tone="warning">{loginTypeLabel(task.type, locale)}</Badge>
                    <strong>{task.endpointKey}</strong>
                    <span className="zk-grow" />
                    {remaining !== undefined && !expired && <time className="zk-hint" dateTime={`PT${remaining}S`}>{t(locale, '剩余 {0} 秒', remaining)}</time>}
                  </div>
                  {/* 倒计时本身不朗读（每秒变化）；只在临近过期与已过期时播报一次固定文案。 */}
                  <p role="status" className={expired ? 'zk-hint' : 'zk-sr-only'}>
                    {expired ? t(locale, '验证已过期，请刷新或重新启动账号。')
                      : remaining !== undefined && remaining <= EXPIRY_WARNING_SECONDS ? t(locale, '验证即将过期') : ''}
                  </p>
                  <div className="zk-media">
                    {image && isImageSource(image) && <img className="zk-qr" src={image} alt={t(locale, '{0}（账号 {1}）', loginTypeLabel(task.type, locale), task.endpointKey)} />}
                    <div className="zk-media__body">
                      {message && <p>{message}</p>}
                      {image && !isImageSource(image) && isLink(image) && <a href={image} target="_blank" rel="noreferrer">{image}</a>}
                      {url && <a href={url} target="_blank" rel="noreferrer">{url}</a>}
                      {needsValue ? <Field label={t(locale, '请输入 {0}', loginTypeLabel(task.type, locale))}>
                        <input value={loginValues[task.id] ?? ''} disabled={submitBusy || expired}
                          onChange={event => setLoginValues(values => ({ ...values, [task.id]: event.target.value }))} />
                      </Field> : null}
                      <div className="zk-row">
                        {needsValue
                          ? <Button variant="primary" busy={submitBusy} disabled={expired || !(loginValues[task.id] ?? '').trim()} onClick={() => submitLogin(task, loginValues[task.id] ?? '')}>{t(locale, '提交')}</Button>
                          : <Button variant="primary" busy={submitBusy} disabled={expired} onClick={() => submitLogin(task, 'ok')}>{task.type === 'qrcode' ? t(locale, '已扫码，继续') : t(locale, '完成')}</Button>}
                        <Button variant="ghost" busy={isBusy(`login-cancel:${task.id}`)} onClick={() => cancelLogin(task)}>{t(locale, '取消')}</Button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <div className={`zk-split ${hasSidebar ? '' : 'zk-split--single'}`}>
      <main className="zk-stack">

      {runtime && <Section id="adapter-accounts" title={t(locale, '账号')} description={t(locale, '查看连接状态，按需启动或停止账号。')}>
        {runtime.needsMigration && <Notice tone="warning" title={t(locale, '首次修改前需迁移以下账号，保留身份和历史。')}>
          <ul>{status?.configured.map(entry => <li key={entry.instanceId ?? entry.id}>{entry.id}</li>)}</ul>
          {!runtime.canMigrate && <p>{t(locale, '首次迁移需要管理员确认。')}</p>}
        </Notice>}
        {runtimeBlocked && <Notice tone="danger">{t(locale, '请刷新账号清单后再操作。')}</Notice>}
        {migration && <div role="alertdialog" aria-label={t(locale, '确认迁移')} className="zk-card">
          <p>{t(locale, '确认迁移以下账号并执行本次操作？身份和历史将保留。')}</p>
          <ul>{migration.ids.map(id => <li key={id}>{id}</li>)}</ul>
          <div className="zk-row"><Button variant="primary" busy={mutating} onClick={() => void migration.run()}>{t(locale, '确认迁移')}</Button>
            <Button disabled={mutating} onClick={() => setMigration(undefined)}>{t(locale, '取消')}</Button></div>
        </div>}
        {!runtime.canManage && <p className="zk-hint">{t(locale, '账号配置存储不可用：当前环境只能查看，不能新增或删除账号。')}</p>}
        {!runtime.endpoints.length && <EmptyState title={t(locale, '还没有账号')} description={t(locale, status?.canAdd && runtime.canManage ? '添加平台账号后，即可在这里管理连接与登录。' : '配置的账号会显示在这里。')} />}
        <ul className="zk-list">{runtime.endpoints.map(endpoint => {
          const connection = endpoints.find(value => value.endpoint?.id === endpoint.canonicalId);
          const configured = status?.configured.find(entry => entry.instanceId === endpoint.instanceId);
          const editable = !endpoint.retiring && !endpoint.removed;
          const disabled = mutationLocked || mutating;
          const stateTone: BadgeTone = endpoint.retiring ? 'warning' : !endpoint.desiredEnabled ? 'neutral' : connectionTone(connection, connectionsKnown);
          const toggleKey = `mutate:${endpoint.desiredEnabled ? 'stop' : 'start'}:${endpoint.instanceId}`;
          return <li key={`${endpoint.instanceId}:${endpoint.epoch}`} className="zk-card">
            <div className="zk-account__head">
              <strong>{endpoint.endpointId}</strong>
              <Badge tone={stateTone}>{endpoint.retiring ? t(locale, '正在关闭') : !endpoint.desiredEnabled ? t(locale, '已停止') : connectionLabel(connection, locale, connectionsKnown)}</Badge>
              {endpoint.execution && <Badge tone={endpoint.execution.status === 'failed' ? 'danger' : endpoint.execution.status === 'pending' ? 'warning' : 'neutral'}>{executionLabel(endpoint.execution, locale)}</Badge>}
            </div>
            {configured && Object.keys(configured.values).length > 0 && <details><summary>{t(locale, '连接配置')}</summary><dl className="zk-dl">
              {Object.entries(configured.values).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}
            </dl></details>}
            {editable && <div className="zk-row">
              <Button variant={endpoint.desiredEnabled ? 'secondary' : 'primary'} busy={isBusy(toggleKey)} disabled={disabled} onClick={() => runtimeMutation(endpoint.desiredEnabled ? 'stop' : 'start', { instanceId: endpoint.instanceId }, runtime)}>{t(locale, endpoint.desiredEnabled ? '停止' : '启动')}</Button>
              {endpoint.started && <Button busy={isBusy(`test:${endpoint.canonicalId}`)} onClick={() => testConnection(endpoint.canonicalId)}>{t(locale, '测试连接')}</Button>}
              {(runtime.canUpdate || runtime.canReplace) && <Button disabled={disabled} onClick={() => openEdit(endpoint)}>{t(locale, '编辑')}</Button>}
              {status?.canRemove && <ConfirmButton disabled={disabled} busy={isBusy(`mutate:remove:${endpoint.instanceId}`)} confirmLabel={t(locale, '删除账号')}
                message={t(locale, '删除账号「{0}」？账号将关闭，历史保留。', endpoint.endpointId)}
                onConfirm={() => runtimeMutation('remove', { instanceId: endpoint.instanceId }, runtime)}>{t(locale, '删除')}</ConfirmButton>}
            </div>}
          </li>;
        })}</ul>
        {runtime.lastMutation && <p role="status" className="zk-hint">{t(locale, '最近操作：{0}', operationLabel(runtime.lastMutation.action, locale))} · {executionLabel(runtime.lastMutation, locale)}</p>}
        {editor && <div className="zk-card" role="region" aria-label={t(locale, '编辑账号')}>
          <h3>{t(locale, '编辑账号')}</h3>
          {(editor.generation !== runtime.generation || editor.revision !== runtime.revision) && <Notice tone="danger">{t(locale, '账号清单已变化，请取消编辑后重新打开。')}</Notice>}
          <Field label={t(locale, '账号 ID')}><input disabled={mutating || !!migration || !runtime.canReplace || !runtime.identityFields.includes('id')} value={editor.id} onChange={event => setEditor({ ...editor, id: event.target.value })} /></Field>
          {status?.fields.filter(field => field.key !== 'id' && (runtime.mutableFields.includes(field.key) || runtime.identityFields.includes(field.key) || editorReplacing)).map(field => <Field key={field.key} label={field.key} hint={pickI18n(locale, field.description, field.descriptionI18n)}>
            {renderConfigInput({ field, locale, allowDefault: !Object.hasOwn(editor.originalValues, field.key), disabled: mutating || !!migration, value: editor.values[field.key] ?? '', placeholder: field.placeholder, onValueChange: value => setEditor({ ...editor, values: { ...editor.values, [field.key]: value } }) })}
          </Field>)}
          {formError && <Notice tone="danger">{formError}</Notice>}
          <div className="zk-row">
            {editorReplacing
              ? <ConfirmButton variant="primary" danger={false} confirmLabel={t(locale, '替换账号')} disabled={runtimeBlocked || !!migration || mutating || editor.generation !== runtime.generation || editor.revision !== runtime.revision}
                message={t(locale, '替换账号「{0}」？旧账号将关闭，历史保留；新账号不继承会话和设置，保存后需手动启动。', editor.originalId)}
                beforeOpen={() => collectEdit() !== undefined} onConfirm={saveEdit}>{t(locale, '保存')}</ConfirmButton>
              : <Button variant="primary" busy={isBusy('mutate:update:' + editor.instanceId)} disabled={runtimeBlocked || !!migration || (mutating && !isBusy('mutate:update:' + editor.instanceId)) || editor.generation !== runtime.generation || editor.revision !== runtime.revision} onClick={saveEdit}>{t(locale, '保存')}</Button>}
            <Button variant="ghost" onClick={closeEdit}>{t(locale, '取消')}</Button>
          </div>
        </div>}
      </Section>}

      {!runtime && status && <Section id="adapter-accounts" title={t(locale, '已配置的账号')}>
        {!status.configured.length
          ? <p className="zk-hint">{runningIds.length > 0 ? t(locale, '此适配器没有提供账号清单；运行中的连接见上方。') : t(locale, '配置里还没有账号。')}</p>
          : (
            <ul className="zk-list">
              {status.configured.map((entry) => {
                const running = runningIds.includes(entry.id);
                return (
                  <li key={entry.id} className="zk-card">
                    <div className="zk-account__head">
                      <strong>{entry.id}</strong>
                      <Badge tone={running ? 'success' : 'neutral'}>{running ? t(locale, '运行中') : t(locale, '未运行')}</Badge>
                    </div>
                    {Object.keys(entry.values).length > 0 && (
                      <dl className="zk-dl">
                        {Object.entries(entry.values).map(([key, value]) => (
                          <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>
                        ))}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        <p className="zk-hint">{t(locale, '当前环境只能查看账号配置。')}</p>
      </Section>}

      {runtime && status?.canAdd && addOpen && (
        <Section id="adapter-add-account" aria-label={t(locale, '添加账号')}>
          <div className="zk-card">
              <h3>{t(locale, '添加账号')}</h3>
              <p className="zk-hint">{t(locale, '保存后请手动启动账号。')}</p>
              <Field label={t(locale, '账号 ID')} required hint={status.idHint ? pickI18n(locale, status.idHint, status.idHintI18n) : undefined}>
                <input disabled={mutating || !!migration} value={addId} onChange={(event) => setAddId(event.target.value)} />
              </Field>
              {status.fields.filter(field => field.key !== 'id').map((field) => (
                <Field key={field.key} label={field.key} required={field.required} hint={pickI18n(locale, field.description, field.descriptionI18n)}>
                  {renderConfigInput({ field, locale, disabled: mutating || !!migration, value: addValues[field.key] ?? '',
                    placeholder: field.placeholder,
                    onValueChange: value => setAddValues(values => ({ ...values, [field.key]: value })) })}
                </Field>
              ))}
              {formError && <Notice tone="danger">{formError}</Notice>}
              <div className="zk-row"><Button variant="primary" busy={isBusy('mutate:add:')} disabled={addDisabled && !isBusy('mutate:add:')} onClick={addEndpoint}>{t(locale, '添加')}</Button><Button variant="ghost" onClick={toggleAdd}>{t(locale, '取消')}</Button></div>
          </div>
        </Section>
      )}

      </main>
      {hasSidebar && <aside className="zk-stack" aria-label={t(locale, '平台信息')}>
        {status && status.actions.length > 0 && <Section id="adapter-tools" title={t(locale, '平台操作')}>
          <ul className="zk-list">{status.actions.map(action => {
            const values = actionValues[action.name] ?? {};
            const result = actionResults[action.name];
            const label = pickI18n(locale, action.label, action.labelI18n) ?? action.name;
            const actionBusy = isBusy(action.accountMutation ? `mutate:action:${action.name}` : `action:${action.name}`);
            const actionDisabled = !!(action.accountMutation && (!runtime?.canManage || runtimeBlocked || migration || (runtime.needsMigration && !runtime.canMigrate) || (mutating && !actionBusy)));
            return <li key={action.name} className="zk-card">
              <div><h3>{label}</h3>
                {action.description && <p className="zk-hint">{pickI18n(locale, action.description, action.descriptionI18n)}</p>}
              </div>
              {action.fields.map(field => <Field key={field.key} label={pickI18n(locale, field.label, field.labelI18n) ?? field.key} required={field.required}>
                <input type={field.secret ? 'password' : 'text'} autoComplete={field.secret ? 'off' : undefined} value={values[field.key] ?? ''} placeholder={field.placeholder}
                  onChange={event => setActionValues(current => ({ ...current, [action.name]: { ...current[action.name], [field.key]: event.target.value } }))} />
              </Field>)}
              {action.options.length > 0 && <Field label={label} required>
                <select value={values.value ?? ''} onChange={event => setActionValues(current => ({ ...current, [action.name]: { ...current[action.name], value: event.target.value } }))}>
                  <option value="">{t(locale, '选择…')}</option>
                  {action.options.map(option => <option key={option.value} value={option.value}>{pickI18n(locale, option.label, option.labelI18n)}</option>)}
                </select>
              </Field>}
              {actionErrors[action.name] && <p role="alert" className="zk-field__error">{actionErrors[action.name]}</p>}
              {action.confirm
                ? <ConfirmButton variant="primary" danger={false} disabled={actionDisabled} busy={actionBusy} confirmLabel={label} message={action.confirm}
                  beforeOpen={() => validateAction(action)} onConfirm={() => runAction(action)}>{label}</ConfirmButton>
                : <Button variant="primary" busy={actionBusy} disabled={actionDisabled} onClick={() => runAction(action)}>{label}</Button>}
              {result && <div role={result.tone === 'error' ? 'alert' : 'status'}>
                {result.message}
                {result.url && <p><a href={result.url} target="_blank" rel="noreferrer">{result.url}</a></p>}
                {result.image && <img className="zk-qr" src={result.image} alt={t(locale, '操作返回的图片')} />}
                {result.details && <dl className="zk-dl">{Object.entries(result.details).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl>}
              </div>}
            </li>;
          })}</ul>
        </Section>}
        {status?.extra && Object.keys(status.extra).length > 0 && <Section title={t(locale, '平台状态')}>
          <dl className="zk-dl">{Object.entries(status.extra).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{typeof value === 'string' && isLink(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : typeof value === 'boolean' ? t(locale, value ? '已开启' : '已关闭') : String(value)}</dd></React.Fragment>)}</dl>
        </Section>}
      </aside>}
      </div>
      <p className="zk-footnote">{t(locale, '此页面由适配器提供；敏感凭据不会展示。')}</p>
    </PluginPage>
  );
}

/** Convention page factory: `pages/index/index.ts` default-exports this. */
export function createAdapterConsolePage(adapterKey: string): React.ComponentType {
  return function AdapterConsoleRoute() {
    return <AdapterConsolePage adapterKey={adapterKey} />;
  };
}
