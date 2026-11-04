import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleEndpointSummary } from '@zhin.js/console-protocol';
import { adapterConsoleStyles } from './styles.js';
import { apiFetch, consoleRpc, getApiBase, getToken, pluginRpc, PluginRpcError } from '../console-utils/remoteApi.js';
import {
  adapterConsoleLocale,
  adapterConsoleText as t,
  pickI18n,
  type AdapterConsoleLocale,
} from './messages.js';
import type {
  AdapterConsoleActionResult,
  AdapterConsoleActionView,
  AdapterConsoleFieldView,
  AdapterConsoleConnectionTest,
  AdapterConsoleLoginTask,
  AdapterConsolePageEntry,
  AdapterConsoleStatus,
  AdapterConsoleRuntimeView,
  AdapterConsoleRuntimeEndpoint,
  AdapterConsoleMutationResult,
  AdapterConsoleExecution,
} from './types.js';

type Notice = {
  readonly kind: 'ok' | 'error';
  readonly message: string;
  readonly url?: string;
  readonly image?: string;
};

const EMPTY_STATUS: AdapterConsoleStatus | undefined = undefined;
const PAGE_POLL_MS = 6_000;

function errorMessage(error: unknown, locale: AdapterConsoleLocale): string {
  if (error instanceof Error && error.message) return error.message;
  return t(locale, '操作失败');
}

function endpointId(endpoint: ConsoleEndpointSummary): string {
  return endpoint.name || endpoint.endpoint?.id || '';
}

function endpointAdapter(endpoint: ConsoleEndpointSummary): string {
  return endpoint.endpoint?.adapter ?? endpoint.adapter;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** No cross-Host owner cache: ownership is read from the current authenticated Host. */
export async function resolveAdapterConsolePluginId(adapterKey: string): Promise<string | undefined> {
  const pathname = typeof location === 'undefined' ? '' : location.pathname.replace(/\/+$/u, '') || '/';
  const response = await apiFetch('/console/api/pages');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { pages?: readonly AdapterConsolePageEntry[] };
  const key = escapeRegExp(adapterKey);
  const patterns = [
    new RegExp(`adapters[\\/]${key}[\\/]pages[\\/]`, 'u'),
    new RegExp(`adapter-${key}[\\/]pages[\\/]`, 'u'),
  ];
  const candidates = (body.pages ?? []).filter(page => page.localName === 'index'
    && typeof page.owner === 'string' && typeof page.source === 'string'
    && patterns.some(pattern => typeof page.source === "string" && pattern.test(page.source)));
  const exact = candidates.filter(page => page.route === pathname);
  return exact.length === 1 ? exact[0]?.owner : exact.length === 0 && candidates.length === 1 ? candidates[0]?.owner : undefined;
}

/** Private closure; credentials never become React keys, DTOs or persisted state. */
export function captureAdapterConsoleContext(): () => boolean {
  const base = typeof localStorage === 'undefined' ? '' : getApiBase();
  const token = getToken();
  const path = typeof location === 'undefined' ? '' : location.pathname;
  return () => base === (typeof localStorage === 'undefined' ? '' : getApiBase())
    && token === getToken() && path === (typeof location === 'undefined' ? '' : location.pathname);
}

export function runtimeLoginMatches(task: AdapterConsoleLoginTask, runtime: AdapterConsoleRuntimeView): boolean {
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

function Icon({ name }: { name: 'connection' | 'refresh' | 'add' | 'shield' }) {
  const paths = {
    connection: <><rect x="3" y="5" width="18" height="14" rx="4" /><path d="M7 10h4m-4 4h7m3-4h.01" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11.5-1L20 9M4 15l2.5 3A7 7 0 0 0 18 17" /></>,
    add: <path d="M12 5v14M5 12h14" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg className="ac-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'bad'; children: React.ReactNode }) {
  return <span className={`ac-badge ac-badge-${tone}`}>{children}</span>;
}

function Button({ children, onClick, disabled, variant = 'default', title, icon, expanded, controls }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  title?: string;
  icon?: 'connection' | 'refresh' | 'add';
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      className={`ac-button ac-button-${variant}`}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
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
    return <select aria-label={field.key} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
      <option value="" disabled={!allowDefault || field.required}>{t(locale, '未设置，使用默认值')}</option>
      <option value="true">{t(locale, '已开启')}</option>
      <option value="false">{t(locale, '已关闭')}</option>
    </select>;
  }
  return <input aria-label={field.key} disabled={disabled} type={field.secret || field.env ? 'password' : field.type === 'number' ? 'number' : 'text'}
    autoComplete={field.secret || field.env ? 'off' : undefined} value={value} placeholder={placeholder} onChange={event => onValueChange(event.target.value)} />;
}

function connectionTone(endpoint: ConsoleEndpointSummary | undefined): 'ok' | 'warn' | 'bad' | 'muted' {
  if (!endpoint) return 'muted';
  if (endpoint.pendingLogin) return 'warn';
  if (endpoint.connected && endpoint.status === 'online') return 'ok';
  if (endpoint.transportState === 'connecting' || endpoint.transportState === 'reconnecting') return 'warn';
  return 'bad';
}

function connectionLabel(endpoint: ConsoleEndpointSummary | undefined, locale: AdapterConsoleLocale): string {
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

function NoticeBar({ notice }: { notice: Notice }) {
  return (
    <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`ac-notice ${notice.kind === 'error' ? 'ac-notice-error' : ''}`}>
      {notice.message}
      {notice.url && <> · <a href={notice.url} target="_blank" rel="noreferrer" className="underline">{notice.url}</a></>}
      {notice.image && <div className="mt-2"><img src={notice.image} alt="" className="max-h-56 rounded bg-white p-1" /></div>}
    </div>
  );
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

function AdapterConsoleSession({ adapterKey, isCurrent }: AdapterConsolePageProps & { readonly isCurrent: () => boolean }) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = useCallback(() => alive.current && isCurrent(), [isCurrent]);
  const statusRead = useRef(0);
  const hostRead = useRef(0);
  const locale = useMemo(adapterConsoleLocale, []);
  const [pluginId, setPluginId] = useState<string | undefined>();
  const [resolving, setResolving] = useState(true);
  const [status, setStatus] = useState<AdapterConsoleStatus | undefined>(EMPTY_STATUS);
  // Event handlers may outlive their render; admit login only against the latest accepted response.
  const latestRuntime = useRef<AdapterConsoleRuntimeView | undefined>(undefined);
  const [endpoints, setEndpoints] = useState<readonly ConsoleEndpointSummary[]>([]);
  const [loginTasks, setLoginTasks] = useState<readonly AdapterConsoleLoginTask[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [hostError, setHostError] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();
  const [busy, setBusy] = useState<string>('');
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState('');
  const [addValues, setAddValues] = useState<Record<string, string>>({});
  const [actionValues, setActionValues] = useState<Record<string, Record<string, string>>>({});
  const [actionResults, setActionResults] = useState<Record<string, AdapterConsoleActionResult>>({});
  const [loginValues, setLoginValues] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [runtimeBlocked, setRuntimeBlocked] = useState(false);
  const [migration, setMigration] = useState<{ run: () => Promise<void>; ids: readonly string[] }>();
  const [editor, setEditor] = useState<{ instanceId: string; id: string; originalId: string; values: Record<string, string>; originalValues: Readonly<Record<string, string>>; generation: number; revision: number | null }>();
  const [addBase, setAddBase] = useState<{ generation: number; revision: number | null }>();

  useEffect(() => {
    let cancelled = false;
    if (!current()) return;
    setResolving(true);
    void resolveAdapterConsolePluginId(adapterKey).then((resolved) => {
      if (cancelled || !current()) return;
      setPluginId(resolved);
      setResolving(false);
    }).catch(loadError => {
      if (cancelled || !current()) return;
      setError(errorMessage(loadError, locale)); setResolving(false);
    });
    return () => { cancelled = true; };
  }, [adapterKey, current, locale]);

  const loadStatus = useCallback(async () => {
    if (!pluginId || !current()) return false;
    const read = ++statusRead.current;
    try {
      const next = await pluginRpc<AdapterConsoleStatus>(pluginId, 'status');
      if (!current() || read !== statusRead.current) return false;
      latestRuntime.current = next.runtime;
      setStatus(next); setError(undefined); return true;
    } catch (loadError) {
      if (current() && read === statusRead.current) setError(errorMessage(loadError, locale));
      return false;
    }
  }, [pluginId, locale, current]);

  const loadHost = useCallback(async () => {
    if (!current()) return;
    const read = ++hostRead.current;
    const loaded = await Promise.all([
      (async () => {
        try {
          const result = await consoleRpc<{ endpoints?: readonly ConsoleEndpointSummary[] }>('endpoint.list');
          if (current() && read === hostRead.current) setEndpoints(result.endpoints ?? []);
          return true;
        } catch (loadError) {
          if (current() && read === hostRead.current) setHostError(errorMessage(loadError, locale));
          return false;
        }
      })(),
      (async () => {
        try {
          const result = await consoleRpc<{ tasks?: readonly AdapterConsoleLoginTask[] }>('login.list');
          if (current() && read === hostRead.current) setLoginTasks((result.tasks ?? []).filter(task => task.adapter === adapterKey));
          return true;
        } catch (loadError) {
          if (current() && read === hostRead.current) setHostError(errorMessage(loadError, locale));
          return false;
        }
      })(),
    ]);
    if (current() && read === hostRead.current && loaded.every(Boolean)) setHostError(undefined);
  }, [adapterKey, current, locale]);

  const refresh = useCallback(async () => { await Promise.all([loadStatus(), loadHost()]); }, [loadStatus, loadHost]);
  const reread = async () => {
    if (await loadStatus()) { setRuntimeBlocked(false); setMigration(undefined); setNotice(undefined); }
    await loadHost();
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (cancelled) return;
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        await refresh();
      }
      if (!cancelled) timer = setTimeout(loop, PAGE_POLL_MS);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (loginTasks.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [loginTasks.length]);

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

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    if (!current()) return;
    setBusy(key);
    try {
      await action();
    } catch (runError) {
      if (current()) setNotice({ kind: 'error', message: errorMessage(runError, locale) });
    } finally {
      if (current()) setBusy('');
    }
  }, [locale, current]);

  const testConnection = (id: string) => run(`test:${id}`, async () => {
    const result = await consoleRpc<AdapterConsoleConnectionTest>('endpoint.test', {
      adapter: adapterKey,
      endpointKey: id,
    });
    if (!current()) return;
    setNotice({
      kind: result.connected ? 'ok' : 'error',
      message: t(locale, '连接测试：{0}（{1} ms）', result.message ?? (result.connected ? t(locale, '在线') : t(locale, '离线')), result.latencyMs ?? 0),
    });
    await loadHost();
  });

  const addEndpoint = () => run('add', async () => {
    if (!pluginId || !status?.runtime) return;
    const id = addId.trim();
    if (!id) {
      setNotice({ kind: 'error', message: t(locale, '请填写 {0}', 'id') });
      return;
    }
    if (status?.idPattern) {
      let pattern: RegExp | undefined;
      try {
        pattern = new RegExp(status.idPattern, 'u');
      } catch {
        pattern = undefined;
      }
      if (pattern && !pattern.test(id)) {
        setNotice({ kind: 'error', message: pickI18n(locale, status.idHint, status.idHintI18n) ?? t(locale, 'id 格式不正确') });
        return;
      }
    }
    await runtimeMutation('add', { id, values: addValues }, addBase ?? status.runtime, () => { setAddOpen(false); setAddId(''); setAddValues({}); });
  });

  const submitLogin = (task: AdapterConsoleLoginTask, value: string) => run(`login:${task.id}`, async () => {
    if (!latestRuntime.current || !runtimeLoginMatches(task, latestRuntime.current)) return;
    await consoleRpc('login.submit', { taskId: task.id, value, ...(task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}) });
    if (!current()) return;
    setLoginValues((current) => ({ ...current, [task.id]: '' }));
    setNotice({ kind: 'ok', message: t(locale, '已提交。') });
    await refresh();
  });

  const cancelLogin = (task: AdapterConsoleLoginTask) => run(`login-cancel:${task.id}`, async () => {
    if (!latestRuntime.current || !runtimeLoginMatches(task, latestRuntime.current)) return;
    await consoleRpc('login.cancel', { taskId: task.id, reason: 'console_cancelled', ...(task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}) });
    if (!current()) return;
    await refresh();
  });

  const runAction = (action: AdapterConsoleActionView) => run(`action:${action.name}`, async () => {
    if (!pluginId) return;
    if (action.confirm && typeof window !== 'undefined' && !window.confirm(action.confirm)) return;
    const values = actionValues[action.name] ?? {};
    for (const field of action.fields) {
      if (field.required && !(values[field.key] ?? '').trim()) {
        setNotice({ kind: 'error', message: t(locale, '请输入 {0}', pickI18n(locale, field.label, field.labelI18n) ?? field.key) });
        return;
      }
    }
    const input: Record<string, string> = { ...values };
    if (action.options.length > 0) {
      if (!input.value) {
        setNotice({ kind: 'error', message: t(locale, '请选择…') });
        return;
      }
    }
    const base = status?.runtime;
    const perform = async (confirmed = false) => {
      if (!current()) return;
      const result = await pluginRpc<AdapterConsoleActionResult>(pluginId, action.name, {
        ...input,
        ...(base ? { expectedGeneration: base.generation, expectedRevision: base.revision } : {}),
        ...(confirmed ? { confirmMigration: true } : {}),
      });
      if (!current()) return;
      setActionResults((current) => ({ ...current, [action.name]: result ?? {} }));
      if (result?.message) {
        setNotice({
          kind: result.tone === 'error' ? 'error' : 'ok',
          message: result.message,
          ...(result.url ? { url: result.url } : {}),
          ...(result.image ? { image: result.image } : {}),
        });
      }
      await refresh();
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

  const runtime = status?.runtime;
  const visibleLogins = runtime ? loginTasks.filter(task => runtimeLoginMatches(task, runtime)) : [];

  const runtimeMutation = async (action: string, payload: Record<string, unknown>, base: { generation: number; revision: number | null }, done?: () => void) => {
    if (!pluginId || !runtime || !runtime.canManage || runtimeBlocked || !current()) return;
    const perform = async (confirmed = false) => {
      if (!current()) return;
      setBusy(`runtime:${action}`);
      try {
        const result = await pluginRpc<AdapterConsoleMutationResult>(pluginId, `endpoint-${action}`, {
          ...payload, expectedGeneration: base.generation, expectedRevision: base.revision,
          ...(confirmed ? { confirmMigration: true } : {}),
        });
        if (!current()) return;
        ++statusRead.current;
        latestRuntime.current = result.runtime;
        setStatus(previous => previous ? { ...previous, runtime: result.runtime } : previous);
        done?.();
        setMigration(undefined);
        setNotice({ kind: result.execution.status === 'failed' ? 'error' : 'ok', message: t(locale,
          result.execution.status === 'failed' ? '配置已保存，执行失败。请查看账号状态。'
            : action === 'add' || action === 'replace' ? '已保存，请手动启动账号。'
              : result.execution.status === 'pending' ? '已保存，操作进行中。' : '已保存。') });
        await refresh();
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
      } finally { if (current()) setBusy(''); }
    };
    if (runtime.needsMigration) {
      if (!runtime.canMigrate) { setNotice({ kind: 'error', message: t(locale, '首次迁移需要管理员确认。') }); return; }
      setMigration({ ids: status.configured.map(entry => entry.id), run: () => perform(true) });
    } else await perform();
  };

  const openEdit = (endpoint: AdapterConsoleRuntimeEndpoint) => {
    if (!runtime) return;
    const entry = status.configured.find(value => value.instanceId === endpoint.instanceId);
    if (!entry) return;
    const values = Object.fromEntries(status.fields.filter(field => !field.secret && !field.env && field.key !== 'id')
      .map(field => [field.key, entry.values[field.key] ?? '']));
    setEditor({ instanceId: endpoint.instanceId, id: endpoint.endpointId, originalId: endpoint.endpointId,
      values, originalValues: entry.values, generation: runtime.generation, revision: runtime.revision });
  };
  const editorReplacing = !!editor && !!runtime && (editor.id.trim() !== editor.originalId
    || runtime.identityFields.some(key => key !== 'id' && Object.hasOwn(editor.values, key) && editor.values[key] !== (editor.originalValues[key] ?? '')));
  const saveEdit = async () => {
    if (!editor || !runtime || !status) return;
    const replacing = editorReplacing;
    if (replacing && !runtime.canReplace) return;
    const allowed = replacing ? status.fields : status.fields.filter(field => runtime.mutableFields.includes(field.key));
    const values: Record<string, string> = {};
    for (const field of allowed) {
      if (field.key === 'id') continue;
      const value = editor.values[field.key] ?? '';
      if (replacing && field.required && !value.trim()) { setNotice({ kind: 'error', message: t(locale, '请填写 {0}', field.key) }); return; }
      if (!replacing && (field.secret || field.env) && !value.trim()) continue;
      if (replacing || value !== (editor.originalValues[field.key] ?? '')) values[field.key] = value;
    }
    if (replacing && !window.confirm(t(locale, '替换账号「{0}」？旧账号将关闭，历史保留；新账号不继承会话和设置，保存后需手动启动。', editor.originalId))) return;
    await runtimeMutation(replacing ? 'replace' : 'update', { instanceId: editor.instanceId, ...(replacing ? { id: editor.id.trim() } : {}), values }, editor, () => setEditor(undefined));
  };

  const title = status?.displayName ?? adapterKey;
  const docsUrl = status?.docsUrl;
  const addDisabled = !runtime?.canManage || busy !== '' || runtimeBlocked || !!migration || !!(runtime.needsMigration && !runtime.canMigrate);
  const toggleAdd = () => {
    if (!runtime) return;
    setAddOpen(open => !open);
    setAddBase({ generation: runtime.generation, revision: runtime.revision });
    if (addOpen) { setAddId(''); setAddValues({}); }
  };
  const hasSidebar = !!status && (status.actions.length > 0 || Object.keys(status.extra ?? {}).length > 0);

  return (
    <div className="zhin-console-surface zhin-adapter-page">
      <style>{adapterConsoleStyles}</style>
      <header className="ac-header">
        <div className="ac-identity">
          <span className="ac-platform-mark" aria-hidden="true">{title.slice(0, 2)}</span>
          <div>
            <h1>{title}</h1>
            <p>{t(locale, runtime ? '管理 {0} 的账号与登录。' : '查看 {0} 的连接与账号配置。', title)}</p>
          </div>
        </div>
        <div className="ac-header-actions">
          {docsUrl && <a href={docsUrl} target="_blank" rel="noreferrer" className="ac-button">{t(locale, '文档')}</a>}
          <Button icon="refresh" onClick={() => void run('refresh', reread)} disabled={busy !== ''}>{t(locale, '刷新')}</Button>
          {runtime && status?.canAdd && <Button icon="add" variant="primary" disabled={addDisabled} expanded={addOpen} controls="adapter-add-account" onClick={toggleAdd}>{addOpen ? t(locale, '取消') : t(locale, '添加')}</Button>}
        </div>
      </header>

      {status && <nav className="ac-navigation" aria-label={t(locale, '页面导航')}>
        <a href="#adapter-accounts">{t(locale, '账号')}<span>{runtime?.endpoints.length ?? status.configured.length}</span></a>
        {visibleLogins.length > 0 && <a href="#adapter-logins">{t(locale, '登录待办')}<span>{visibleLogins.length}</span></a>}
        {status.actions.length > 0 && <a href="#adapter-tools">{t(locale, '平台操作')}</a>}
      </nav>}
      {notice && <NoticeBar notice={notice} />}
      {resolving && <p role="status" className="ac-section-description">{t(locale, '正在解析插件…')}</p>}
      {!resolving && !pluginId && <p role="alert" className="ac-notice ac-notice-error">{t(locale, '找不到页面所属插件。')}</p>}
      {hostError && <p role="alert" className="ac-notice ac-notice-error">{t(locale, '加载失败：{0}', hostError)}</p>}
      {error && <p role="alert" className="ac-notice ac-notice-error">{t(locale, '加载失败：{0}', error)}</p>}
      {!status && pluginId && !error && <div className="ac-loading" role="status" aria-busy="true"><p>{t(locale, '加载中…')}</p><span aria-hidden="true" /><span aria-hidden="true" /></div>}

      {!runtime && status && <section className="ac-section">
        <div className="ac-section-head"><h2>{t(locale, '运行中的连接')}</h2></div>
        {runningIds.length === 0
          ? <p className="text-sm text-muted-foreground">{t(locale, '还没有运行中的连接。')}</p>
          : (
            <ul className="ac-account-list">
              {runningIds.map((id) => {
                const endpoint = endpointById.get(id);
                const mode = runningModes.get(id);
                return (
                  <li key={id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                    <Badge tone={connectionTone(endpoint)}>{connectionLabel(endpoint, locale)}</Badge>
                    <span className="font-medium">{id}</span>
                    {mode && <span className="text-xs text-muted-foreground">{t(locale, '模式：{0}', mode)}</span>}
                    {endpoint?.pendingLogin && <Badge tone="warn">{t(locale, '等待登录')}</Badge>}
                    <span className="grow" />
                    <Button onClick={() => testConnection(id)} disabled={busy !== ''}>{t(locale, '测试连接')}</Button>
                  </li>
                );
              })}
            </ul>
          )}
      </section>}

      {visibleLogins.length > 0 && (
        <section id="adapter-logins" className="ac-section ac-login-section">
          <div className="ac-section-head"><div><h2>{t(locale, '登录待办')}</h2><p className="ac-section-description">{t(locale, '完成验证后，账号即可继续连接。')}</p></div></div>
          <ul className="ac-login-list">
            {visibleLogins.map((task) => {
              const image = typeof task.payload.image === 'string' ? task.payload.image : undefined;
              const url = typeof task.payload.url === 'string' ? task.payload.url : undefined;
              const message = typeof task.payload.message === 'string' ? task.payload.message : undefined;
              const needsValue = task.type === 'slider' || task.type === 'device' || task.type === 'sms' || task.type === 'other';
              const remaining = task.expiresAt ? Math.max(0, Math.ceil((task.expiresAt - now) / 1_000)) : undefined;
              return (
                <li key={task.id} className="ac-login">
                  <div className="ac-login-head">
                    <Badge tone="warn">{loginTypeLabel(task.type, locale)}</Badge>
                    <strong>{task.endpointKey}</strong>
                    {remaining !== undefined && <time>{t(locale, '剩余 {0} 秒', remaining)}</time>}
                  </div>
                  <div className="ac-login-body">
                    {image && isImageSource(image) && <img src={image} alt={t(locale, '登录二维码')} />}
                    <div className="ac-login-content">
                      {message && <p>{message}</p>}
                      {image && !isImageSource(image) && isLink(image) && <a href={image} target="_blank" rel="noreferrer">{image}</a>}
                      {url && <a href={url} target="_blank" rel="noreferrer">{url}</a>}
                      {remaining === 0 && <p role="status" className="ac-form-hint">{t(locale, '验证已过期，请刷新或重新启动账号。')}</p>}
                      {needsValue ? <label>
                        <span className="ac-form-hint">{t(locale, '请输入 {0}', loginTypeLabel(task.type, locale))}</span>
                        <div className="ac-login-input">
                          <input value={loginValues[task.id] ?? ''} disabled={busy !== '' || remaining === 0}
                            onChange={event => setLoginValues(current => ({ ...current, [task.id]: event.target.value }))}
                            placeholder={t(locale, '请输入 {0}', loginTypeLabel(task.type, locale))} />
                          <Button variant="primary" disabled={busy !== '' || remaining === 0 || !(loginValues[task.id] ?? '').trim()} onClick={() => submitLogin(task, loginValues[task.id] ?? '')}>{t(locale, '提交')}</Button>
                        </div>
                      </label> : <div className="ac-actions">
                        <Button variant="primary" disabled={busy !== '' || remaining === 0} onClick={() => submitLogin(task, 'ok')}>{task.type === 'qrcode' ? t(locale, '已扫码，继续') : t(locale, '完成')}</Button>
                      </div>}
                      <div className="ac-actions"><Button disabled={busy !== ''} onClick={() => cancelLogin(task)}>{t(locale, '取消')}</Button></div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className={`ac-workspace ${hasSidebar ? '' : 'ac-workspace-single'}`}>
      <main className="ac-main">

      {runtime && <section id="adapter-accounts" className="ac-section">
        <div className="ac-section-head"><div><h2>{t(locale, '账号')}</h2><p className="ac-section-description">{t(locale, '查看连接状态，按需启动或停止账号。')}</p></div></div>
        {runtime.needsMigration && <div className="ac-warning">
          <p>{t(locale, '首次修改前需迁移以下账号，保留身份和历史。')}</p>
          <ul>{status?.configured.map(entry => <li key={entry.instanceId ?? entry.id}>{entry.id}</li>)}</ul>
          {!runtime.canMigrate && <p>{t(locale, '首次迁移需要管理员确认。')}</p>}
        </div>}
        {runtimeBlocked && <p role="alert" className="text-sm text-red-600">{t(locale, '请刷新账号清单后再操作。')}</p>}
        {migration && <div role="alertdialog" aria-label={t(locale, '确认迁移')} className="ac-form ac-warning">
          <p>{t(locale, '确认迁移以下账号并执行本次操作？身份和历史将保留。')}</p>
          <ul>{migration.ids.map(id => <li key={id}>{id}</li>)}</ul>
          <div className="flex gap-2"><Button variant="primary" disabled={busy !== ''} onClick={() => void migration.run()}>{t(locale, '确认迁移')}</Button>
            <Button disabled={busy !== ''} onClick={() => setMigration(undefined)}>{t(locale, '取消')}</Button></div>
        </div>}
        {!runtime.canManage && <p className="text-sm text-muted-foreground">{t(locale, '配置存储不可用：当前环境只能查看，不能增删 endpoint。')}</p>}
        {!runtime.endpoints.length && <div className="ac-empty"><Icon name="connection" /><strong>{t(locale, '还没有账号')}</strong><p>{t(locale, status?.canAdd && runtime.canManage ? '添加平台账号后，即可在这里管理连接与登录。' : '配置的账号会显示在这里。')}</p></div>}
        <ul className="ac-account-list">{runtime.endpoints.map(endpoint => {
          const connection = endpoints.find(value => value.endpoint?.id === endpoint.canonicalId);
          const configured = status?.configured.find(entry => entry.instanceId === endpoint.instanceId);
          const editable = !endpoint.retiring && !endpoint.removed;
          const disabled = !runtime.canManage || busy !== '' || runtimeBlocked || !!migration || (runtime.needsMigration && !runtime.canMigrate);
          return <li key={`${endpoint.instanceId}:${endpoint.epoch}`} className="ac-account">
            <div className="ac-account-head">
              <span className="ac-account-avatar"><Icon name="connection" /></span>
              <div className="ac-account-title"><strong>{endpoint.endpointId}</strong>
                <Badge tone={endpoint.retiring ? 'warn' : !endpoint.desiredEnabled ? 'muted' : connectionTone(connection)}>{endpoint.retiring ? t(locale, '正在关闭') : !endpoint.desiredEnabled ? t(locale, '已停止') : connectionLabel(connection, locale)}</Badge>
                {endpoint.execution && <Badge tone={endpoint.execution.status === 'failed' ? 'bad' : endpoint.execution.status === 'pending' ? 'warn' : 'muted'}>{executionLabel(endpoint.execution, locale)}</Badge>}
              </div>
            </div>
            {configured && Object.keys(configured.values).length > 0 && <details><summary>{t(locale, '连接配置')}</summary><dl className="ac-details">
              {Object.entries(configured.values).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}
            </dl></details>}
            {editable && <div className="ac-actions">
              <Button variant={endpoint.desiredEnabled ? 'default' : 'primary'} disabled={disabled} onClick={() => void runtimeMutation(endpoint.desiredEnabled ? 'stop' : 'start', { instanceId: endpoint.instanceId }, runtime)}>{t(locale, endpoint.desiredEnabled ? '停止' : '启动')}</Button>
              {endpoint.started && <Button icon="connection" disabled={busy !== ''} onClick={() => void testConnection(endpoint.canonicalId)}>{t(locale, '测试连接')}</Button>}
              {(runtime.canUpdate || runtime.canReplace) && <Button disabled={disabled} onClick={() => openEdit(endpoint)}>{t(locale, '编辑')}</Button>}
              {status?.canRemove && <Button variant="danger" disabled={disabled} onClick={() => { if (window.confirm(t(locale, '删除账号「{0}」？账号将关闭，历史保留。', endpoint.endpointId))) void runtimeMutation('remove', { instanceId: endpoint.instanceId }, runtime); }}>{t(locale, '删除')}</Button>}
            </div>}
          </li>;
        })}</ul>
        {runtime.lastMutation && <p role="status" className="ac-last-operation">{t(locale, '最近操作：{0}', operationLabel(runtime.lastMutation.action, locale))} · {executionLabel(runtime.lastMutation, locale)}</p>}
        {editor && <div className="ac-form" role="region" aria-label={t(locale, '编辑账号')}>
          <h3 className="font-medium">{t(locale, '编辑账号')}</h3>
          {(editor.generation !== runtime.generation || editor.revision !== runtime.revision) && <p role="alert" className="text-sm text-red-600">{t(locale, '账号清单已变化，请取消编辑后重新打开。')}</p>}
          <label className="block space-y-1"><span className="text-sm">id</span><input aria-label="id" autoFocus disabled={busy !== '' || !!migration || !runtime.canReplace || !runtime.identityFields.includes('id')} value={editor.id} onChange={event => setEditor({ ...editor, id: event.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
          {status?.fields.filter(field => field.key !== 'id' && (runtime.mutableFields.includes(field.key) || runtime.identityFields.includes(field.key) || editorReplacing)).map(field => <label key={field.key} className="block space-y-1">
            <span className="text-sm">{field.key}</span>{renderConfigInput({ field, locale, allowDefault: !Object.hasOwn(editor.originalValues, field.key), disabled: busy !== '' || !!migration, value: editor.values[field.key] ?? '', placeholder: pickI18n(locale, field.description, field.descriptionI18n) ?? field.placeholder, onValueChange: value => setEditor({ ...editor, values: { ...editor.values, [field.key]: value } }) })}
          </label>)}
          <div className="flex gap-2"><Button variant="primary" disabled={busy !== '' || runtimeBlocked || !!migration || editor.generation !== runtime.generation || editor.revision !== runtime.revision} onClick={() => void saveEdit()}>{t(locale, '保存')}</Button><Button disabled={busy !== ''} onClick={() => setEditor(undefined)}>{t(locale, '取消')}</Button></div>
        </div>}
      </section>}

      {!runtime && status && <section id="adapter-accounts" className="ac-section">
        <div className="ac-section-head"><h2>{t(locale, '配置中的 endpoint')}</h2></div>
        {!status?.configured.length
          ? <p className="text-sm text-muted-foreground">{t(locale, '配置里还没有 endpoint。')}</p>
          : (
            <ul className="ac-account-list">
              {status.configured.map((entry) => {
                const running = runningIds.includes(entry.id);
                return (
                  <li key={entry.id} className="ac-account">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{entry.id}</span>
                      <Badge tone={running ? 'ok' : 'muted'}>{running ? t(locale, '运行中') : t(locale, '未运行')}</Badge>
                      <span className="grow" />

                    </div>
                    {Object.keys(entry.values).length > 0 && (
                      <dl className="ac-details">
                        {Object.entries(entry.values).map(([key, value]) => (
                          <React.Fragment key={key}>
                            <dt className="text-muted-foreground">{key}</dt>
                            <dd className="break-all">{value}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        <p className="text-xs text-muted-foreground">{t(locale, '当前环境只能查看账号配置。')}</p>
      </section>}

      {runtime && status?.canAdd && addOpen && (
        <section id="adapter-add-account" className="ac-section" aria-label={t(locale, '添加账号')}>
          <div className="ac-form">
              <h3>{t(locale, '添加账号')}</h3>
              <p className="ac-form-hint">{t(locale, '保存后请手动启动账号。')}</p>
              <label className="block space-y-1">
                <span className="text-sm">id</span>
                <input
                  autoFocus
                  aria-label="id"
                  disabled={busy !== '' || !!migration}
                  value={addId}
                  onChange={(event) => setAddId(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                {status.idHint && <span className="text-xs text-muted-foreground">{pickI18n(locale, status.idHint, status.idHintI18n)}</span>}
              </label>
              {status.fields.filter(field => field.key !== 'id').map((field) => (
                <label key={field.key} className="block space-y-1">
                  <span className="text-sm">
                    {field.key}
                    {field.required && <span className="ml-1 text-red-600">*</span>}
                  </span>
                  {renderConfigInput({ field, locale, disabled: busy !== '' || !!migration, value: addValues[field.key] ?? '',
                    placeholder: pickI18n(locale, field.description, field.descriptionI18n) ?? field.placeholder,
                    onValueChange: value => setAddValues(current => ({ ...current, [field.key]: value })) })}
                  {field.description && <span className="text-xs text-muted-foreground">{pickI18n(locale, field.description, field.descriptionI18n)}</span>}
                </label>
              ))}
              <div className="ac-actions"><Button variant="primary" disabled={addDisabled} onClick={addEndpoint}>{t(locale, '添加')}</Button><Button disabled={busy !== ''} onClick={toggleAdd}>{t(locale, '取消')}</Button></div>
          </div>
        </section>
      )}

      </main>
      {hasSidebar && <aside className="ac-sidebar" aria-label={t(locale, '平台信息')}>
        {status && status.actions.length > 0 && <section id="adapter-tools" className="ac-section">
          <div className="ac-section-head"><h2>{t(locale, '平台操作')}</h2></div>
          <ul className="ac-tool-list">{status.actions.map(action => {
            const values = actionValues[action.name] ?? {};
            const result = actionResults[action.name];
            return <li key={action.name} className="ac-tool">
              <div><h3>{pickI18n(locale, action.label, action.labelI18n)}</h3>
                {action.description && <p>{pickI18n(locale, action.description, action.descriptionI18n)}</p>}
              </div>
              {action.fields.map(field => <label key={field.key}>
                <span>{pickI18n(locale, field.label, field.labelI18n)}{field.required && <span className="ac-required">*</span>}</span>
                <input type={field.secret ? 'password' : 'text'} autoComplete={field.secret ? 'off' : undefined} value={values[field.key] ?? ''} placeholder={field.placeholder}
                  onChange={event => setActionValues(current => ({ ...current, [action.name]: { ...current[action.name], [field.key]: event.target.value } }))} />
              </label>)}
              {action.options.length > 0 && <label><span>{pickI18n(locale, action.label, action.labelI18n)}</span>
                <select value={values.value ?? ''} onChange={event => setActionValues(current => ({ ...current, [action.name]: { ...current[action.name], value: event.target.value } }))}>
                  <option value="">{t(locale, '选择…')}</option>
                  {action.options.map(option => <option key={option.value} value={option.value}>{pickI18n(locale, option.label, option.labelI18n)}</option>)}
                </select>
              </label>}
              <Button variant="primary" disabled={busy !== '' || !!(action.accountMutation && (!runtime?.canManage || runtimeBlocked || migration || (runtime.needsMigration && !runtime.canMigrate)))} onClick={() => runAction(action)}>{pickI18n(locale, action.label, action.labelI18n)}</Button>
              {result && <div role={result.tone === 'error' ? 'alert' : 'status'} className={`ac-tool-result ${result.tone === 'error' ? 'ac-notice-error' : ''}`}>
                {result.message}
                {result.url && <p><a href={result.url} target="_blank" rel="noreferrer">{result.url}</a></p>}
                {result.image && <img src={result.image} alt="" />}
                {result.details && <dl className="ac-details">{Object.entries(result.details).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl>}
              </div>}
            </li>;
          })}</ul>
        </section>}
        {status?.extra && Object.keys(status.extra).length > 0 && <section className="ac-platform-status">
          <h2>{t(locale, '平台状态')}</h2>
          <dl className="ac-details">{Object.entries(status.extra).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{typeof value === 'string' && isLink(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : typeof value === 'boolean' ? t(locale, value ? '已开启' : '已关闭') : String(value)}</dd></React.Fragment>)}</dl>
        </section>}
      </aside>}
      </div>
      <p className="ac-footnote"><Icon name="shield" />{t(locale, '此页面由适配器提供；敏感凭据不会展示。')}</p>
    </div>
  );
}

/** Convention page factory: `pages/index/index.ts` default-exports this. */
export function createAdapterConsolePage(adapterKey: string): React.ComponentType {
  return function AdapterConsoleRoute() {
    return <AdapterConsolePage adapterKey={adapterKey} />;
  };
}
