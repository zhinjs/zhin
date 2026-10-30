import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConsoleEndpointSummary } from '@zhin.js/console-protocol';
import { apiFetch, consoleRpc, pluginRpc } from '../console-utils/remoteApi.js';
import {
  adapterConsoleLocale,
  adapterConsoleText as t,
  pickI18n,
  type AdapterConsoleLocale,
} from './messages.js';
import type {
  AdapterConsoleActionResult,
  AdapterConsoleActionView,
  AdapterConsoleConnectionTest,
  AdapterConsoleLoginTask,
  AdapterConsolePageEntry,
  AdapterConsoleStatus,
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

const pluginIdCache = new Map<string, Promise<string | undefined>>();

/** Resolve the PluginId that owns this adapter's `pages/index` page. */
export function resolveAdapterConsolePluginId(adapterKey: string): Promise<string | undefined> {
  const pathname = typeof location === 'undefined' ? '' : location.pathname.replace(/\/+$/u, '') || '/';
  const cacheKey = `${adapterKey}\0${pathname}`;
  const cached = pluginIdCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const response = await apiFetch('/console/api/pages');
      if (!response.ok) return undefined;
      const body = await response.json() as { pages?: readonly AdapterConsolePageEntry[] };
      const pattern = new RegExp(`adapters[\\\\/]${escapeRegExp(adapterKey)}[\\\\/]pages[\\\\/]`, 'u');
      const candidates = (body.pages ?? []).filter((page) =>
        page.localName === 'index'
        && typeof page.owner === 'string'
        && typeof page.source === 'string'
        && pattern.test(page.source));
      return (candidates.find((page) => page.route === pathname) ?? candidates[0])?.owner;
    } catch {
      return undefined;
    }
  })();
  pluginIdCache.set(cacheKey, pending);
  return pending;
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'bad'; children: React.ReactNode }) {
  const color = tone === 'ok' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
    : tone === 'warn' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      : tone === 'bad' ? 'bg-red-500/15 text-red-700 dark:text-red-300'
        : 'bg-muted text-muted-foreground';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{children}</span>;
}

function Button({ children, onClick, disabled, variant = 'default', title }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  title?: string;
}) {
  const style = variant === 'primary' ? 'bg-primary text-primary-foreground hover:opacity-90'
    : variant === 'danger' ? 'border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400'
      : 'border hover:bg-accent';
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
    >
      {children}
    </button>
  );
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
    <div className={`rounded-md px-3 py-2 text-sm ${notice.kind === 'ok'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>
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
  const locale = useMemo(adapterConsoleLocale, []);
  const [pluginId, setPluginId] = useState<string | undefined>();
  const [resolving, setResolving] = useState(true);
  const [status, setStatus] = useState<AdapterConsoleStatus | undefined>(EMPTY_STATUS);
  const [endpoints, setEndpoints] = useState<readonly ConsoleEndpointSummary[]>([]);
  const [loginTasks, setLoginTasks] = useState<readonly AdapterConsoleLoginTask[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();
  const [busy, setBusy] = useState<string>('');
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState('');
  const [addValues, setAddValues] = useState<Record<string, string>>({});
  const [actionValues, setActionValues] = useState<Record<string, Record<string, string>>>({});
  const [actionResults, setActionResults] = useState<Record<string, AdapterConsoleActionResult>>({});
  const [loginValues, setLoginValues] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    void resolveAdapterConsolePluginId(adapterKey).then((resolved) => {
      if (cancelled) return;
      setPluginId(resolved);
      setResolving(false);
    });
    return () => { cancelled = true; };
  }, [adapterKey]);

  const loadStatus = useCallback(async () => {
    if (!pluginId) return;
    try {
      const next = await pluginRpc<AdapterConsoleStatus>(pluginId, 'status');
      setStatus(next);
      setError(undefined);
    } catch (loadError) {
      setError(errorMessage(loadError, locale));
    }
  }, [pluginId, locale]);

  const loadHost = useCallback(async () => {
    await Promise.all([
      (async () => {
        try {
          const result = await consoleRpc<{ endpoints?: readonly ConsoleEndpointSummary[] }>('endpoint.list');
          setEndpoints(result.endpoints ?? []);
        } catch {
          setEndpoints([]);
        }
      })(),
      (async () => {
        try {
          const result = await consoleRpc<{ tasks?: readonly AdapterConsoleLoginTask[] }>('login.list');
          setLoginTasks((result.tasks ?? []).filter((task) => task.adapter === adapterKey));
        } catch {
          setLoginTasks([]);
        }
      })(),
    ]);
  }, [adapterKey]);

  const refresh = useCallback(async () => {
    await Promise.all([loadStatus(), loadHost()]);
  }, [loadStatus, loadHost]);

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
    if (!notice) return;
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
    setBusy(key);
    try {
      await action();
    } catch (runError) {
      setNotice({ kind: 'error', message: errorMessage(runError, locale) });
    } finally {
      setBusy('');
    }
  }, [locale]);

  const testConnection = (id: string) => run(`test:${id}`, async () => {
    const result = await consoleRpc<AdapterConsoleConnectionTest>('endpoint.test', {
      adapter: adapterKey,
      endpointKey: id,
    });
    setNotice({
      kind: result.connected ? 'ok' : 'error',
      message: t(locale, '连接测试：{0}（{1} ms）', result.message ?? (result.connected ? t(locale, '在线') : t(locale, '离线')), result.latencyMs ?? 0),
    });
    await loadHost();
  });

  const addEndpoint = () => run('add', async () => {
    if (!pluginId) return;
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
    const result = await pluginRpc<{ message?: string }>(pluginId, 'endpoint-add', { id, values: addValues });
    setNotice({ kind: 'ok', message: result?.message ?? t(locale, '已添加，重启或热重载后生效。') });
    setAddOpen(false);
    setAddId('');
    setAddValues({});
    await refresh();
  });

  const removeEndpoint = (id: string) => run(`remove:${id}`, async () => {
    if (!pluginId) return;
    if (typeof window !== 'undefined' && !window.confirm(t(locale, '确定删除 endpoint「{0}」？配置会从 zhin.config.yml 移除。', id))) return;
    const result = await pluginRpc<{ message?: string }>(pluginId, 'endpoint-remove', { id });
    setNotice({ kind: 'ok', message: result?.message ?? t(locale, '已删除') });
    await refresh();
  });

  const submitLogin = (task: AdapterConsoleLoginTask, value: string) => run(`login:${task.id}`, async () => {
    await consoleRpc('login.submit', { taskId: task.id, value });
    setLoginValues((current) => ({ ...current, [task.id]: '' }));
    setNotice({ kind: 'ok', message: t(locale, '已提交。') });
    await refresh();
  });

  const cancelLogin = (task: AdapterConsoleLoginTask) => run(`login-cancel:${task.id}`, async () => {
    await consoleRpc('login.cancel', { taskId: task.id, reason: 'console_cancelled' });
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
    const result = await pluginRpc<AdapterConsoleActionResult>(pluginId, action.name, input);
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
  });

  const title = status?.displayName ?? adapterKey;
  const docsUrl = status?.docsUrl;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(locale, '管理 {0} 的连接、登录待办和 endpoint 配置。', title)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {docsUrl && (
            <a href={docsUrl} target="_blank" rel="noreferrer" className="text-sm underline-offset-2 hover:underline">
              {t(locale, '文档')}
            </a>
          )}
          <Button onClick={() => void refresh()} disabled={busy !== ''}>{t(locale, '刷新')}</Button>
        </div>
      </header>

      {notice && <NoticeBar notice={notice} />}
      {resolving && <p className="text-sm text-muted-foreground">{t(locale, '正在解析插件…')}</p>}
      {!resolving && !pluginId && <p className="text-sm text-red-600 dark:text-red-400">{t(locale, '找不到页面所属插件。')}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{t(locale, '加载失败：{0}', error)}</p>}
      {!status && pluginId && !error && <p className="text-sm text-muted-foreground">{t(locale, '加载中…')}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t(locale, '运行中的连接')}</h2>
        {runningIds.length === 0
          ? <p className="text-sm text-muted-foreground">{t(locale, '还没有运行中的连接。请检查配置并重启、或等待适配器启动。')}</p>
          : (
            <ul className="space-y-2">
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
      </section>

      {loginTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t(locale, '登录待办')}</h2>
          <ul className="space-y-3">
            {loginTasks.map((task) => {
              const image = typeof task.payload.image === 'string' ? task.payload.image : undefined;
              const url = typeof task.payload.url === 'string' ? task.payload.url : undefined;
              const message = typeof task.payload.message === 'string' ? task.payload.message : undefined;
              const needsValue = task.type === 'slider' || task.type === 'device' || task.type === 'sms' || task.type === 'other';
              const remaining = task.expiresAt ? Math.max(0, Math.ceil((task.expiresAt - now) / 1_000)) : undefined;
              return (
                <li key={task.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warn">{loginTypeLabel(task.type, locale)}</Badge>
                    <span className="text-sm font-medium">{task.endpointKey}</span>
                    {remaining !== undefined && <span className="text-xs text-muted-foreground">{t(locale, '剩余 {0} 秒', remaining)}</span>}
                  </div>
                  {message && <p className="text-sm whitespace-pre-wrap break-words">{message}</p>}
                  {image && isImageSource(image) && (
                    <img src={image} alt="QR" className="max-h-56 rounded bg-white p-1" />
                  )}
                  {image && !isImageSource(image) && isLink(image) && (
                    <a href={image} target="_blank" rel="noreferrer" className="text-sm underline break-all">{image}</a>
                  )}
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer" className="text-sm underline break-all">{url}</a>
                  )}
                  {needsValue ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={loginValues[task.id] ?? ''}
                        onChange={(event) => setLoginValues((current) => ({ ...current, [task.id]: event.target.value }))}
                        placeholder={t(locale, '请输入 {0}', loginTypeLabel(task.type, locale))}
                        className="min-w-0 grow rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <Button variant="primary" disabled={busy !== '' || !(loginValues[task.id] ?? '').trim()}
                        onClick={() => submitLogin(task, loginValues[task.id] ?? '')}>
                        {t(locale, '提交')}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="primary" disabled={busy !== ''} onClick={() => submitLogin(task, 'ok')}>
                        {task.type === 'qrcode' ? t(locale, '已扫码，继续') : t(locale, '完成')}
                      </Button>
                    </div>
                  )}
                  <Button variant="danger" disabled={busy !== ''} onClick={() => cancelLogin(task)}>{t(locale, '取消')}</Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {status && status.actions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t(locale, '平台操作')}</h2>
          <ul className="space-y-3">
            {status.actions.map((action) => {
              const values = actionValues[action.name] ?? {};
              const result = actionResults[action.name];
              return (
                <li key={action.name} className="space-y-3 rounded-lg border p-4">
                  <div>
                    <div className="font-medium">{pickI18n(locale, action.label, action.labelI18n)}</div>
                    {action.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{pickI18n(locale, action.description, action.descriptionI18n)}</p>
                    )}
                  </div>
                  {action.fields.length > 0 && (
                    <div className="space-y-2">
                      {action.fields.map((field) => (
                        <label key={field.key} className="block space-y-1">
                          <span className="text-sm">{pickI18n(locale, field.label, field.labelI18n)}</span>
                          <input
                            type={field.secret ? 'password' : 'text'}
                            value={values[field.key] ?? ''}
                            placeholder={field.placeholder}
                            onChange={(event) => setActionValues((current) => ({
                              ...current,
                              [action.name]: { ...current[action.name], [field.key]: event.target.value },
                            }))}
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {action.options.length > 0 && (
                    <select
                      value={values.value ?? ''}
                      onChange={(event) => setActionValues((current) => ({
                        ...current,
                        [action.name]: { ...current[action.name], value: event.target.value },
                      }))}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">{t(locale, '选择…')}</option>
                      {action.options.map((option) => (
                        <option key={option.value} value={option.value}>{pickI18n(locale, option.label, option.labelI18n)}</option>
                      ))}
                    </select>
                  )}
                  <Button variant="primary" disabled={busy !== ''} onClick={() => runAction(action)}>
                    {pickI18n(locale, action.label, action.labelI18n)}
                  </Button>
                  {result && (
                    <div className={`rounded-md px-3 py-2 text-sm ${result.tone === 'error'
                      ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                      : 'bg-muted/60'}`}>
                      {result.message}
                      {result.url && <> · <a href={result.url} target="_blank" rel="noreferrer" className="underline break-all">{result.url}</a></>}
                      {result.image && <div className="mt-2"><img src={result.image} alt="" className="max-h-56 rounded bg-white p-1" /></div>}
                      {result.details && (
                        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                          {Object.entries(result.details).map(([key, value]) => (
                            <React.Fragment key={key}>
                              <dt className="text-muted-foreground">{key}</dt>
                              <dd className="break-all">{String(value)}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {status?.extra && Object.keys(status.extra).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t(locale, '平台状态')}</h2>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(status.extra).map(([key, value]) => (
              <React.Fragment key={key}>
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="break-all">
                  {typeof value === 'string' && isLink(value)
                    ? <a href={value} target="_blank" rel="noreferrer" className="underline">{value}</a>
                    : String(value)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t(locale, '配置中的 endpoint')}</h2>
        {!status?.configured.length
          ? <p className="text-sm text-muted-foreground">{t(locale, '配置里还没有 endpoint。')}</p>
          : (
            <ul className="space-y-2">
              {status.configured.map((entry) => {
                const running = runningIds.includes(entry.id);
                return (
                  <li key={entry.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{entry.id}</span>
                      <Badge tone={running ? 'ok' : 'muted'}>{running ? t(locale, '运行中') : t(locale, '重启后生效')}</Badge>
                      <span className="grow" />
                      {status.canRemove && (
                        <Button variant="danger" disabled={busy !== ''} onClick={() => removeEndpoint(entry.id)}>
                          {t(locale, '删除')}
                        </Button>
                      )}
                    </div>
                    {Object.keys(entry.values).length > 0 && (
                      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
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
        {status && !status.configStore && (
          <p className="text-xs text-muted-foreground">{t(locale, '配置存储不可用：当前环境只能查看，不能增删 endpoint。')}</p>
        )}
        <p className="text-xs text-muted-foreground">{t(locale, '写入配置后需要重启进程或等待热重载。')}</p>
      </section>

      {status?.canAdd && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{t(locale, '添加 endpoint')}</h2>
            <span className="grow" />
            <Button onClick={() => setAddOpen((open) => !open)}>{addOpen ? t(locale, '取消') : t(locale, '添加')}</Button>
          </div>
          {addOpen && (
            <div className="space-y-3 rounded-lg border p-4">
              <label className="block space-y-1">
                <span className="text-sm">id</span>
                <input
                  value={addId}
                  onChange={(event) => setAddId(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                {status.idHint && <span className="text-xs text-muted-foreground">{pickI18n(locale, status.idHint, status.idHintI18n)}</span>}
              </label>
              {status.fields.map((field) => (
                <label key={field.key} className="block space-y-1">
                  <span className="text-sm">
                    {field.key}
                    {field.required && <span className="ml-1 text-red-600">*</span>}
                  </span>
                  <input
                    type={field.secret ? 'password' : 'text'}
                    value={addValues[field.key] ?? ''}
                    placeholder={pickI18n(locale, field.description, field.descriptionI18n) ?? field.placeholder}
                    onChange={(event) => setAddValues((current) => ({ ...current, [field.key]: event.target.value }))}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {field.description && <span className="text-xs text-muted-foreground">{pickI18n(locale, field.description, field.descriptionI18n)}</span>}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">{t(locale, '凭据会写入 .env，配置里只保留引用。')}</p>
              <Button variant="primary" disabled={busy !== ''} onClick={addEndpoint}>{t(locale, '添加')}</Button>
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">{t(locale, '此页面由适配器提供；敏感凭据不会展示。')}</p>
    </div>
  );
}

/** Convention page factory: `pages/index/index.ts` default-exports this. */
export function createAdapterConsolePage(adapterKey: string): React.ComponentType {
  return function AdapterConsoleRoute() {
    return <AdapterConsolePage adapterKey={adapterKey} />;
  };
}
