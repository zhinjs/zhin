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
import { Badge, Button, ConfirmButton, EmptyState, ErrorState, Field, LoadingState, Notice, PageHeader, PluginPage, Section, StaleNotice, Switch, type BadgeTone } from '../ui/components.js';
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
import {
  extractSliderTicket,
  generateRandomSecret,
  getPlatformProfile,
  inferAccountProtocolPills,
  isRandomSecretField,
  resolveFieldDisplay,
} from './platform-profiles.js';

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

function sanitizeAddValues(
  fields: readonly AdapterConsoleFieldView[],
  raw: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowed = new Set(fields.filter((f) => f.key !== 'id').map((f) => f.key));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowed.has(k)) continue;
    if (typeof v !== 'string' || v.trim() === '') continue;
    out[k] = v;
  }
  return out;
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

/** Page actions handed to a host that renders them with its own buttons (`toolbar`). */
export interface AdapterConsoleToolbarControls {
  /** The adapter's documentation link, when it has one. */
  readonly docsUrl?: string;
  /** Adding an account; absent when this adapter cannot add accounts from the Console. */
  readonly add?: {
    /** The add form is open (the action reads 「取消」 then). */
    readonly open: boolean;
    readonly disabled: boolean;
    readonly toggle: () => void;
    /** `id` of the add form, for `aria-controls`. */
    readonly controls: string;
  };
  /** Re-read status, connections and login tasks (the same as the SDK's own 「刷新」). */
  readonly refresh: () => Promise<void>;
  readonly refreshing: boolean;
}

export interface AdapterConsolePageProps {
  /** Adapter type key (e.g. `telegram`, `wechat-mp`). */
  readonly adapterKey: string;
  /**
   * Render inside a host page that already shows the title and a refresh button: no SDK page header,
   * no page padding or width limit. Page actions (docs, add) move to a toolbar row — the SDK's own,
   * or the host's via `toolbar`. Default `false` (stand-alone plugin page, unchanged).
   */
  readonly embedded?: boolean;
  /**
   * Embedded only: render the page actions with the host's own buttons. Return `null` to show none.
   * Without it, an embedded page shows the SDK's 「文档」/「添加」 buttons (no 「刷新」).
   */
  readonly toolbar?: (controls: AdapterConsoleToolbarControls) => React.ReactNode;
  /**
   * Changing this value re-reads everything, as the SDK's 「刷新」 does — wire the host's refresh
   * button to it. The first value does not trigger a read.
   */
  readonly refreshKey?: string | number;
  /**
   * Render each account of the SDK account list with the host's own markup (inside the SDK's list
   * item). The row carries the account's state and its start / stop / edit / remove / test actions.
   */
  readonly renderRow?: (row: AdapterAccountRow) => React.ReactNode;
  /**
   * The host renders the accounts itself from `useAdapterAccounts()` (inside an
   * `AdapterAccountsProvider` for the same adapter): this page then draws no account list, no
   * account editor (see `AdapterAccountEditor`) and none of the account status the controller
   * exposes (notice, migration confirmation, blocked notice). It keeps the add form, login tasks,
   * platform actions and read errors. Without a provider the page ignores this flag.
   */
  readonly hostAccounts?: boolean;
}

/** What this `AdapterConsolePage` supports, for hosts that must also run against older SDKs. */
export const ADAPTER_CONSOLE_PAGE_CAPABILITIES = Object.freeze({ embedded: true, toolbar: true, refreshKey: true, renderRow: true, hostAccounts: true } as const);

/** A notice about the last account operation (success notices clear themselves after 8 s). */
export interface AdapterAccountsNotice {
  readonly kind: 'ok' | 'error';
  readonly message: string;
  readonly url?: string;
  readonly image?: string;
}

/** One managed account of an adapter, with its state and the operations allowed on it. */
export interface AdapterAccountRow {
  /** Stable React key (instance and epoch). */
  readonly key: string;
  /** Account id as configured (the Host's endpoint name). */
  readonly endpointId: string;
  readonly instanceId: string;
  readonly canonicalId: string;
  /** Desired state: the account is switched on (「运行中」) or off (「已停止」). */
  readonly enabled: boolean;
  /** The localized label of `enabled` for the switch: 「运行中」 / 「已停止」. */
  readonly enabledLabel: string;
  /** The account's transport has been started on this Host. */
  readonly started: boolean;
  /** The account is closing after a remove or replace; it can no longer be changed. */
  readonly retiring: boolean;
  /** Connection / lifecycle state for a badge. */
  readonly state: { readonly label: string; readonly tone: BadgeTone };
  /** The last operation on this account while it is pending or failed. */
  readonly execution?: { readonly label: string; readonly tone: BadgeTone };
  /** A login verification for this account is waiting. */
  readonly pendingLogin: boolean;
  /** The Host's connection summary, when the connection list knows this account. */
  readonly connection?: ConsoleEndpointSummary;
  /** Configured values (credentials masked by the adapter). */
  readonly values?: Readonly<Record<string, string>>;
  /** Latest result of 「测试连接」 in this page. */
  readonly lastTest?: AdapterConsoleConnectionTest;
  /** Which operations exist for this account (independent of `disabled`). */
  readonly can: { readonly toggle: boolean; readonly edit: boolean; readonly remove: boolean; readonly test: boolean };
  /** Account changes are locked right now (another change running, migration pending, read-only, blocked). */
  readonly disabled: boolean;
  readonly busy: { readonly toggle: boolean; readonly remove: boolean; readonly test: boolean };
  /** Switch the account on or off (start / stop, with revision checks and migration consent). */
  readonly setEnabled: (enabled: boolean) => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  /** Open the account editor (rendered by `AdapterConsolePage` or `AdapterAccountEditor`). */
  readonly edit: () => void;
  /** Remove the account (the caller confirms first). */
  readonly remove: () => Promise<void>;
  readonly test: () => Promise<void>;
}

/** Headless view of an adapter's managed accounts: the state and actions of `AdapterConsolePage`'s list. */
export interface AdapterAccounts {
  readonly adapterKey: string;
  /**
   * `loading` until the first status read; `error` when the owner plugin or the status cannot be
   * read; `unmanaged` when the adapter offers no account directory (read-only, no rows); `ready`.
   */
  readonly state: 'loading' | 'error' | 'unmanaged' | 'ready';
  readonly error?: Error;
  readonly rows: readonly AdapterAccountRow[];
  /** The account store is unavailable: accounts can be viewed but not changed. */
  readonly readOnly: boolean;
  /** A change failed in an unknown way (for example `commit_unknown`): refresh before changing again. */
  readonly blocked: boolean;
  readonly needsMigration: boolean;
  readonly canMigrate: boolean;
  /**
   * 「立即迁移」: migrate the listed accounts now (asks for consent through `migration` first). Absent
   * when the adapter cannot migrate without a real change; the first edit / start / stop then asks.
   */
  readonly migrate?: () => Promise<void>;
  /** An operation waits for the user's consent to migrate the listed accounts first. */
  readonly migration?: { readonly ids: readonly string[]; readonly busy: boolean; readonly confirm: () => Promise<void>; readonly cancel: () => void };
  readonly notice?: AdapterAccountsNotice;
  readonly dismissNotice: () => void;
  /** Adding accounts; absent when this adapter cannot add accounts from the Console. */
  readonly add?: { readonly open: boolean; readonly disabled: boolean; readonly toggle: () => void };
  /** The account whose editor is open. */
  readonly editing?: { readonly instanceId: string; readonly endpointId: string };
  readonly closeEditor: () => void;
  /** Label of the last account operation and its result. */
  readonly lastMutation?: string;
  readonly refresh: () => Promise<void>;
  readonly refreshing: boolean;
}

/** Watches the credentials and page the requests use; a change starts a fresh session. */
function useConsoleConnection(): readonly [number, () => boolean] {
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
  return [connection, context.current] as const;
}

type AdapterAccountsScope = { readonly adapterKey: string; readonly model: AdapterConsoleModel };
const AdapterAccountsContext = React.createContext<AdapterAccountsScope | undefined>(undefined);

/**
 * Shared React page body for adapter Console pages.
 *
 * It reads the adapter's `plugin.<pluginId>.status`, the Host's `endpoint.list` /
 * `endpoint.test`, and LoginAssist's `login.list` / `login.submit` / `login.cancel`.
 * Adapter-specific controls come from `status.actions` (for example QQ QR binding).
 *
 * Inside an `AdapterAccountsProvider` for the same adapter, the page shares the provider's state
 * (one set of reads, one revision and migration flow) with `useAdapterAccounts()`.
 */
export function AdapterConsolePage(props: AdapterConsolePageProps) {
  const hosted = React.useContext(AdapterAccountsContext);
  const [connection, isCurrent] = useConsoleConnection();
  if (hosted && hosted.adapterKey === props.adapterKey) return renderAdapterConsoleView(hosted.model, props);
  return <AdapterConsoleSession key={`${props.adapterKey}:${connection}`} {...props} hostAccounts={false} isCurrent={isCurrent} />;
}
AdapterConsolePage.capabilities = ADAPTER_CONSOLE_PAGE_CAPABILITIES;

/**
 * Holds the account state of one adapter for `useAdapterAccounts()`, `AdapterAccountEditor` and an
 * `AdapterConsolePage` of the same adapter below it. Changing `refreshKey` re-reads everything.
 */
export function AdapterAccountsProvider({ adapterKey, refreshKey, children }: { readonly adapterKey: string; readonly refreshKey?: string | number; readonly children?: React.ReactNode }) {
  const [connection, isCurrent] = useConsoleConnection();
  return <AdapterAccountsScopeProvider key={`${adapterKey}:${connection}`} adapterKey={adapterKey} refreshKey={refreshKey} isCurrent={isCurrent}>{children}</AdapterAccountsScopeProvider>;
}

function AdapterAccountsScopeProvider({ adapterKey, refreshKey, isCurrent, children }: { readonly adapterKey: string; readonly refreshKey?: string | number; readonly isCurrent: () => boolean; readonly children?: React.ReactNode }) {
  const model = useAdapterConsoleModel({ adapterKey, refreshKey, isCurrent });
  return <AdapterAccountsContext.Provider value={{ adapterKey, model }}>{children}</AdapterAccountsContext.Provider>;
}

/**
 * Headless account list of the nearest `AdapterAccountsProvider`: rows with state and
 * start / stop / edit / remove / test, plus notice, migration and add controls. Throws outside a provider.
 */
export function useAdapterAccounts(): AdapterAccounts {
  const scope = React.useContext(AdapterAccountsContext);
  if (!scope) throw new Error('useAdapterAccounts() must be used inside <AdapterAccountsProvider>');
  return scope.model.accounts;
}

/** The account editor of the nearest `AdapterAccountsProvider`; renders nothing while no account is being edited. */
export function AdapterAccountEditor() {
  const scope = React.useContext(AdapterAccountsContext);
  if (!scope || !scope.model.editor) return null;
  return <div className="zk-root zk-account-editor-host"><style>{adapterConsoleStyles}</style>{renderAccountEditor(scope.model)}</div>;
}

type EditorState = { instanceId: string; id: string; originalId: string; values: Record<string, string>; originalValues: Readonly<Record<string, string>>; generation: number; revision: number | null };

type AdapterConsoleViewProps = Pick<AdapterConsolePageProps, 'embedded' | 'toolbar' | 'renderRow' | 'hostAccounts'>;

function AdapterConsoleSession(props: AdapterConsolePageProps & { readonly isCurrent: () => boolean }) {
  const model = useAdapterConsoleModel(props);
  return renderAdapterConsoleView(model, props);
}

type AdapterConsoleModel = ReturnType<typeof useAdapterConsoleModel>;

function useAdapterConsoleModel({ adapterKey, refreshKey, isCurrent }: { readonly adapterKey: string; readonly refreshKey?: string | number; readonly isCurrent: () => boolean }) {
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
  const [selectedModeKey, setSelectedModeKey] = useState<string | undefined>();
  const [lastTestByCanonicalId, setLastTestByCanonicalId] = useState<Record<string, AdapterConsoleConnectionTest>>({});
  const [copiedCallback, setCopiedCallback] = useState(false);

  const effectiveAdapterKey = status?.adapterKey || adapterKey;
  const platformProfile = useMemo(
    () => (status ? getPlatformProfile(effectiveAdapterKey) : undefined),
    [status, effectiveAdapterKey],
  );
  const activeConnectionMode = useMemo(() => {
    const modes = platformProfile?.connectionModes;
    if (!modes || modes.length === 0) return undefined;
    return modes.find((m) => m.key === selectedModeKey) ?? modes[0];
  }, [platformProfile, selectedModeKey]);

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

  // The host's refresh button: every new `refreshKey` after the first re-reads, like the SDK's 「刷新」.
  const seenRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (Object.is(seenRefreshKey.current, refreshKey)) return;
    seenRefreshKey.current = refreshKey;
    void run('refresh', t(locale, '刷新'), reread);
  }, [refreshKey]);

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
    setLastTestByCanonicalId((prev) => ({ ...prev, [id]: result }));
    const detail = result.message ?? (result.connected ? t(locale, '在线') : t(locale, '离线'));
    setNotice(result.connected
      ? { kind: 'ok', message: result.latencyMs === undefined ? t(locale, '连接测试通过：{0}', detail) : t(locale, '连接测试通过：{0}（{1} ms）', detail, result.latencyMs) }
      : { kind: 'error', message: t(locale, '连接测试未通过：{0}。请确认账号已启动、网络可用，必要时查看登录待办。', detail) });
    await endpointRead.refresh();
  });

  const runtimeMutation = async (action: string, payload: Record<string, unknown>, base: { generation: number; revision: number | null }, done?: () => void, successMessage?: string) => {
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
        setNotice({ kind: result.execution.status === 'failed' ? 'error' : 'ok', message: successMessage && result.execution.status !== 'failed' ? successMessage : t(locale,
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

  /**
   * 「立即迁移」: an empty configuration update of one account is a pure desired-state commit (no
   * restart), so it carries the migration through the same confirm / revision / commit_unknown path.
   */
  const migrationTarget = runtime?.endpoints.find(endpoint => !endpoint.retiring && !endpoint.removed);
  const canMigrateNow = !!runtime?.needsMigration && runtime.canMigrate && runtime.canUpdate && !!migrationTarget;
  const migrateNow = async () => {
    if (!canMigrateNow || !runtime || !migrationTarget) return;
    await runtimeMutation('update', { instanceId: migrationTarget.instanceId, values: {} }, runtime, undefined,
      t(locale, '已迁移。账号以数据库为准，配置文件中的 endpoints 不再生效。'));
  };

  const toggleAdd = () => {
    if (!runtime) return;
    if (addOpen) { setAddId(''); setAddValues({}); setFormError(undefined); restoreTrigger(); } else rememberTrigger();
    setAddOpen(open => !open);
    setAddBase({ generation: runtime.generation, revision: runtime.revision });
  };

  const validateAddId = (): string | undefined => {
    if (!status) return undefined;
    const id = addId.trim();
    if (!id) {
      setFormError(t(locale, '请填写 {0}', t(locale, '账号 ID')));
      return undefined;
    }
    if (status.idPattern) {
      let pattern: RegExp | undefined;
      try { pattern = new RegExp(status.idPattern, 'u'); } catch { pattern = undefined; }
      if (pattern && !pattern.test(id)) {
        setFormError(pickI18n(locale, status.idHint, status.idHintI18n) ?? t(locale, '账号 ID 格式不正确'));
        return undefined;
      }
    }
    setFormError(undefined);
    return id;
  };

  const addEndpoint = async () => {
    if (!pluginId || !status?.runtime) return;
    const id = validateAddId();
    if (!id) return;
    const cleanValues = sanitizeAddValues(status.fields, addValues);
    await runtimeMutation('add', { id, values: cleanValues }, addBase ?? status.runtime, () => { setAddOpen(false); setAddId(''); setAddValues({}); restoreTrigger(); });
  };

  const addAndStartEndpoint = async () => {
    if (!pluginId || !status?.runtime || !runtime || !runtime.canManage || runtimeBlocked || !current()) return;
    const id = validateAddId();
    if (!id) return;
    const cleanValues = sanitizeAddValues(status.fields, addValues);
    const base = addBase ?? status.runtime;
    const key = 'mutate:add-start:';
    const perform = async (confirmed = false) => {
      if (!current()) return;
      setBusy((value) => ({ ...value, [key]: true }));
      let added = false;
      try {
        const addRes = await pluginRpc<AdapterConsoleMutationResult>(pluginId, 'endpoint-add', {
          id,
          values: cleanValues,
          expectedGeneration: base.generation,
          expectedRevision: base.revision,
          ...(confirmed ? { confirmMigration: true } : {}),
        });
        added = true;
        if (!current()) return;
        latestRuntime.current = addRes.runtime;
        statusRead.mutate((previous) => (previous ? { ...previous, runtime: addRes.runtime } : previous));
        setAddOpen(false);
        setAddId('');
        setAddValues({});
        restoreTrigger();
        setMigration(undefined);

        const created = addRes.runtime.endpoints.find(
          (ep) => ep.endpointId === id && !ep.removed && !ep.retiring,
        );
        if (created && !created.desiredEnabled && addRes.execution.status !== 'failed') {
          const startRes = await pluginRpc<AdapterConsoleMutationResult>(pluginId, 'endpoint-start', {
            instanceId: created.instanceId,
            expectedGeneration: addRes.runtime.generation,
            expectedRevision: addRes.runtime.revision,
          });
          if (!current()) return;
          latestRuntime.current = startRes.runtime;
          statusRead.mutate((previous) => (previous ? { ...previous, runtime: startRes.runtime } : previous));
          setNotice({
            kind: startRes.execution.status === 'failed' ? 'error' : 'ok',
            message: t(locale, startRes.execution.status === 'failed' ? '配置已保存，执行失败。请查看账号状态。' : '已保存并启动账号。'),
          });
        } else {
          setNotice({
            kind: addRes.execution.status === 'failed' ? 'error' : 'ok',
            message: t(locale, addRes.execution.status === 'failed' ? '配置已保存，执行失败。请查看账号状态。' : '已保存并启动账号。'),
          });
        }
        await refreshAll();
      } catch (mutationError) {
        if (!current()) return;
        const knownInvalid = mutationError instanceof PluginRpcError && mutationError.code === 'invalid_input';
        if (!knownInvalid) setRuntimeBlocked(true);
        setMigration(undefined);
        if (added) {
          void refreshAll();
          setNotice({
            kind: 'error',
            message: t(locale, '配置已保存，执行失败。请查看账号状态。'),
          });
        } else {
          setNotice({
            kind: 'error',
            message: t(
              locale,
              knownInvalid
                ? '输入无效，请检查账号字段。'
                : mutationError instanceof PluginRpcError && mutationError.code === 'conflict'
                  ? '账号清单已变化，请刷新后重新操作。'
                  : mutationError instanceof PluginRpcError && mutationError.code === 'forbidden'
                    ? '没有此操作的权限。'
                    : !(mutationError instanceof PluginRpcError) || mutationError.code === 'commit_unknown'
                      ? '提交结果尚未确认，请刷新核实，不要重复提交。'
                      : '操作未能完成，请刷新账号清单。',
            ),
          });
        }
      } finally {
        if (current()) setBusy((value) => { const { [key]: _done, ...rest } = value; return rest; });
      }
    };
    if (runtime.needsMigration) {
      if (!runtime.canMigrate) {
        setNotice({ kind: 'error', message: t(locale, '首次迁移需要管理员确认。') });
        return;
      }
      setMigration({ ids: (status?.configured ?? []).map((entry) => entry.id), run: () => perform(true) });
    } else {
      await perform();
    }
  };

  const submitLogin = (task: AdapterConsoleLoginTask, rawValue: string) => run(`login:${task.id}`, t(locale, '提交登录验证'), async () => {
    if (!latestRuntime.current || !runtimeLoginMatches(task, latestRuntime.current)) return;
    const value = task.type === 'slider' ? extractSliderTicket(rawValue) : rawValue;
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

  const runAction = (action: AdapterConsoleActionView) => {
    const actionKey = action.accountMutation ? `mutate:action:${action.name}` : `action:${action.name}`;
    const actionContext = pickI18n(locale, action.label, action.labelI18n) ?? action.name;
    const executePerform = (
      input: Record<string, string>,
      base: AdapterConsoleRuntimeView | undefined,
      confirmed: boolean,
    ) =>
      run(actionKey, actionContext, async () => {
        if (!pluginId || !current()) return;
        try {
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
        } catch (actionErr) {
          if (current() && action.accountMutation) {
            const knownInvalid = actionErr instanceof PluginRpcError && actionErr.code === 'invalid_input';
            if (!knownInvalid) setRuntimeBlocked(true);
            setMigration(undefined);
          }
          throw actionErr;
        }
      });

    if (!pluginId) return Promise.resolve();
    if (!validateAction(action)) return Promise.resolve();
    const input: Record<string, string> = { ...(actionValues[action.name] ?? {}) };
    const base = status?.runtime;
    if (action.accountMutation) {
      if (!status || !base?.canManage || runtimeBlocked) return Promise.resolve();
      if (base.needsMigration) {
        if (!base.canMigrate) {
          setNotice({ kind: 'error', message: t(locale, '首次迁移需要管理员确认。') });
          return Promise.resolve();
        }
        setMigration({
          ids: status.configured.map((entry) => entry.id),
          run: () => executePerform(input, base, true),
        });
        return Promise.resolve();
      }
    }
    return executePerform(input, base, false);
  };

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
  const hasQqWorkbench = !!status && effectiveAdapterKey === 'qq' && status.actions.some(a => a.name === 'qq-bind-start');
  const sidebarActions = useMemo(
    () => (status?.actions ?? []).filter(a => !hasQqWorkbench || !['qq-bind-start', 'qq-bind-kind', 'qq-bind-cancel'].includes(a.name)),
    [status?.actions, hasQqWorkbench],
  );
  const sidebarExtraEntries = useMemo(
    () => Object.entries(status?.extra ?? {}).filter(([k]) => !hasQqWorkbench || !['bindFlowActive', 'bindState', 'scanUrl', 'bindUrl', 'bindMessage'].includes(k)),
    [status?.extra, hasQqWorkbench],
  );
  const hasSidebar = !!status && (sidebarActions.length > 0 || sidebarExtraEntries.length > 0);
  const statusError = statusRead.error;
  const canAdd = !!runtime && !!status?.canAdd;
  const refreshPage = () => run('refresh', t(locale, '刷新'), reread);
  // Account avatar: the first character of the adapter's display name (adapter metadata, no platform table).
  const mark = (Array.from((status?.displayName || adapterKey).trim())[0] ?? '?').toUpperCase();

  // One row per managed account: the SDK list, `renderRow` and `useAdapterAccounts()` all read these.
  const rows: AdapterAccountRow[] = (runtime?.endpoints ?? []).map(endpoint => {
    const connection = endpoints.find(value => value.endpoint?.id === endpoint.canonicalId);
    const configured = status?.configured.find(entry => entry.instanceId === endpoint.instanceId);
    const editable = !endpoint.retiring && !endpoint.removed;
    const disabled = mutationLocked || mutating;
    const lastTest = lastTestByCanonicalId[endpoint.canonicalId];
    const setEnabled = async (enabled: boolean) => {
      if (disabled || !runtime || !editable) return;
      await runtimeMutation(enabled ? 'start' : 'stop', { instanceId: endpoint.instanceId }, runtime);
    };
    return {
      key: `${endpoint.instanceId}:${endpoint.epoch}`,
      endpointId: endpoint.endpointId,
      instanceId: endpoint.instanceId,
      canonicalId: endpoint.canonicalId,
      enabled: endpoint.desiredEnabled,
      enabledLabel: t(locale, endpoint.desiredEnabled ? '运行中' : '已停止'),
      started: endpoint.started,
      retiring: !!endpoint.retiring,
      state: {
        label: endpoint.retiring ? t(locale, '正在关闭') : !endpoint.desiredEnabled ? t(locale, '已停止') : connectionLabel(connection, locale, connectionsKnown),
        tone: endpoint.retiring ? 'warning' : !endpoint.desiredEnabled ? 'neutral' : connectionTone(connection, connectionsKnown),
      },
      ...(endpoint.execution ? { execution: {
        label: executionLabel(endpoint.execution, locale),
        tone: endpoint.execution.status === 'failed' ? 'danger' : endpoint.execution.status === 'pending' ? 'warning' : 'neutral',
      } } : {}),
      pendingLogin: visibleLogins.some(task => task.endpointIdentity?.instanceId === endpoint.instanceId || task.endpointKey === endpoint.endpointId),
      ...(connection ? { connection } : {}),
      ...(configured ? { values: configured.values } : {}),
      ...(lastTest ? { lastTest } : {}),
      can: { toggle: editable, edit: editable && !!(runtime?.canUpdate || runtime?.canReplace), remove: editable && !!status?.canRemove, test: editable && endpoint.started },
      disabled,
      busy: {
        toggle: isBusy(`mutate:start:${endpoint.instanceId}`) || isBusy(`mutate:stop:${endpoint.instanceId}`),
        remove: isBusy(`mutate:remove:${endpoint.instanceId}`),
        test: isBusy(`test:${endpoint.canonicalId}`),
      },
      setEnabled,
      start: () => setEnabled(true),
      stop: () => setEnabled(false),
      edit: () => { if (editable && !disabled) openEdit(endpoint); },
      remove: async () => { if (editable && !disabled && runtime) await runtimeMutation('remove', { instanceId: endpoint.instanceId }, runtime); },
      test: () => testConnection(endpoint.canonicalId),
    } satisfies AdapterAccountRow;
  });

  const accountsError = owner.state === 'error' ? owner.error : statusRead.state === 'error' ? statusError : undefined;
  const accounts: AdapterAccounts = {
    adapterKey,
    state: owner.state === 'error' || owner.state === 'empty' || statusRead.state === 'error' ? 'error' : !status ? 'loading' : !runtime ? 'unmanaged' : 'ready',
    ...(accountsError ? { error: accountsError } : {}),
    rows,
    readOnly: !!runtime && !runtime.canManage,
    blocked: runtimeBlocked,
    needsMigration: !!runtime?.needsMigration,
    canMigrate: !!runtime?.canMigrate,
    ...(canMigrateNow ? { migrate: migrateNow } : {}),
    ...(migration ? { migration: { ids: migration.ids, busy: mutating, confirm: () => migration.run(), cancel: () => setMigration(undefined) } } : {}),
    ...(notice ? { notice } : {}),
    dismissNotice: () => setNotice(undefined),
    ...(canAdd ? { add: { open: addOpen, disabled: addDisabled, toggle: toggleAdd } } : {}),
    ...(editor ? { editing: { instanceId: editor.instanceId, endpointId: editor.originalId } } : {}),
    closeEditor: closeEdit,
    ...(runtime?.lastMutation ? { lastMutation: `${operationLabel(runtime.lastMutation.action, locale)} · ${executionLabel(runtime.lastMutation, locale)}` } : {}),
    refresh: refreshPage,
    refreshing: isBusy('refresh'),
  };

  return {
    accounts, rows, locale, owner, statusRead, endpointRead, loginRead, status, runtime, connectionsKnown, endpoints, endpointById, runningIds, runningModes,
    notice, setNotice, isBusy, mutating, addOpen, addId, setAddId, addValues, setAddValues, formError, actionValues, setActionValues, actionResults, actionErrors,
    loginValues, setLoginValues, now, runtimeBlocked, migration, setMigration, editor, setEditor, setSelectedModeKey, activeConnectionMode, platformProfile,
    copiedCallback, setCopiedCallback, effectiveAdapterKey, testConnection, toggleAdd, addEndpoint, addAndStartEndpoint, submitLogin, cancelLogin,
    validateAction, runAction, visibleLogins, closeEdit, editorReplacing, collectEdit, saveEdit, title, docsUrl, mutationLocked, addDisabled, sidebarActions,
    sidebarExtraEntries, hasSidebar, statusError, canAdd, refreshPage, mark, canMigrateNow, migrateNow, pluginId,
  };
}

function renderAdapterConsoleView(m: AdapterConsoleModel, { embedded = false, toolbar, renderRow, hostAccounts = false }: AdapterConsoleViewProps) {
  const {
    rows, locale, owner, statusRead, endpointRead, loginRead, status, runtime, connectionsKnown, endpointById, runningIds, runningModes,
    notice, setNotice, isBusy, mutating, addOpen, addId, setAddId, addValues, setAddValues, formError, actionValues, setActionValues, actionResults, actionErrors,
    loginValues, setLoginValues, now, runtimeBlocked, migration, setMigration, editor, setSelectedModeKey, activeConnectionMode, platformProfile,
    copiedCallback, setCopiedCallback, effectiveAdapterKey, testConnection, toggleAdd, addEndpoint, addAndStartEndpoint, submitLogin, cancelLogin,
    validateAction, runAction, visibleLogins, closeEdit, title, docsUrl, addDisabled, sidebarActions,
    sidebarExtraEntries, hasSidebar, statusError, canAdd, refreshPage, mark, canMigrateNow, migrateNow, pluginId,
  } = m;
  const docsLink = docsUrl ? <a href={docsUrl} target="_blank" rel="noreferrer" className="zk-btn zk-btn--secondary">{t(locale, '文档')}</a> : null;
  const addButton = canAdd ? <Button variant="primary" disabled={addDisabled} aria-expanded={addOpen} aria-controls="adapter-add-account" onClick={toggleAdd}>{addOpen ? t(locale, '取消') : t(locale, '添加')}</Button> : null;
  const toolbarControls: AdapterConsoleToolbarControls = {
    ...(docsUrl ? { docsUrl } : {}),
    ...(canAdd ? { add: { open: addOpen, disabled: addDisabled, toggle: toggleAdd, controls: 'adapter-add-account' } } : {}),
    refresh: refreshPage,
    refreshing: isBusy('refresh'),
  };
  // The host draws the account list, editor and account status from `useAdapterAccounts()`.
  const showAccounts = !hostAccounts;
  const showEditor = !!editor && showAccounts;

  return (
    <PluginPage className={embedded ? 'zk-page--embedded' : undefined} data-embedded={embedded || undefined}>
      <style>{adapterConsoleStyles}</style>
      {!embedded && <PageHeader
        title={title}
        mark={status ? title.slice(0, 2) : undefined}
        description={status ? t(locale, runtime ? '管理 {0} 的账号与登录。' : '查看 {0} 的连接与账号配置。', title) : undefined}
        actions={<>
          {docsLink}
          <Button busy={isBusy('refresh')} onClick={refreshPage}>{isBusy('refresh') ? t(locale, '刷新中…') : t(locale, '刷新')}</Button>
          {addButton}
        </>}
      />}
      {embedded && (toolbar
        ? (() => { const node = toolbar(toolbarControls); return node == null || node === false ? null : <div className="zk-embedded-toolbar">{node}</div>; })()
        : (docsLink || addButton) && <div className="zk-embedded-toolbar zk-row">{docsLink}{addButton}</div>)}

      {status && <nav className="zk-nav" aria-label={t(locale, '页面导航')}>
        {showAccounts && <a href="#adapter-accounts" onClick={(e) => { if (addOpen || editor) { e.preventDefault(); if (addOpen) toggleAdd(); if (editor) closeEdit(); } }}>{t(locale, '账号')}<span className="zk-count">{runtime?.endpoints.length ?? status.configured.length}</span></a>}
        {visibleLogins.length > 0 && <a href="#adapter-logins">{t(locale, '登录待办')}<span className="zk-count">{visibleLogins.length}</span></a>}
        {sidebarActions.length > 0 && <a href="#adapter-tools">{t(locale, '平台操作')}</a>}
      </nav>}

      {notice && showAccounts && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} onDismiss={() => setNotice(undefined)}>
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

      {!addOpen && !editor && visibleLogins.length > 0 && (
        <Section id="adapter-logins" title={t(locale, '登录待办')} description={t(locale, '完成验证后，账号即可继续连接。')}>
          <div className="zk-login-steps" aria-label={t(locale, '登录待办')}>
            <span className="zk-login-step">{t(locale, '1. 发起连接')}</span>
            <span className="zk-login-step zk-login-step--active">{t(locale, '2. 完成平台安全验证')}</span>
            <span className="zk-login-step">{t(locale, '3. 账号在线就绪')}</span>
          </div>
          <ul className="zk-list">
            {visibleLogins.map((task) => {
              const image = typeof task.payload.image === 'string' ? task.payload.image : undefined;
              const url = typeof task.payload.url === 'string' ? task.payload.url : undefined;
              const message = typeof task.payload.message === 'string' ? task.payload.message : undefined;
              const needsValue = task.type === 'slider' || task.type === 'device' || task.type === 'sms' || task.type === 'other';
              const remaining = task.expiresAt ? Math.max(0, Math.ceil((task.expiresAt - now) / 1_000)) : undefined;
              const expired = remaining === 0;
              const submitBusy = isBusy(`login:${task.id}`);
              const currentLoginVal = loginValues[task.id] ?? '';
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
                      {url && (
                        <div className="zk-row">
                          <a href={url} target="_blank" rel="noreferrer">{url}</a>
                          {task.type === 'slider' && (
                            <a href={url} target="_blank" rel="noreferrer" className="zk-chip-btn">{t(locale, '打开滑块验证页面')}</a>
                          )}
                        </div>
                      )}
                      {task.type === 'slider' && (
                        <details className="zk-slider-guide">
                          <summary className="zk-hint">{t(locale, '如何提取滑块 Ticket？（F12 → Network → cap_union_new_verify → ticket）')}</summary>
                          <p className="zk-hint">
                            1. 打开上方滑块验证页面并按下 F12 打开开发者工具 → Network（网络）面板；2. 拖动滑块完成拼图；3. 在 `cap_union_new_verify` 响应中复制 `ticket` 字段（或直接粘贴整段 JSON 响应，系统将自动提取 Ticket）。
                          </p>
                        </details>
                      )}
                      {needsValue ? <>
                        <Field label={t(locale, '请输入 {0}', loginTypeLabel(task.type, locale))}>
                          <input value={currentLoginVal} disabled={submitBusy || expired}
                            onChange={event => setLoginValues(values => ({ ...values, [task.id]: event.target.value }))} />
                        </Field>
                        {task.type === 'slider' && currentLoginVal.trim() && extractSliderTicket(currentLoginVal) !== currentLoginVal.trim() && (
                          <div className="zk-option-pills">
                            <button
                              type="button"
                              className="zk-chip-btn"
                              onClick={() => setLoginValues(values => ({ ...values, [task.id]: extractSliderTicket(currentLoginVal) }))}
                            >
                              {t(locale, '自动提取 Ticket')} ({extractSliderTicket(currentLoginVal).slice(0, 16)}…)
                            </button>
                          </div>
                        )}
                      </> : null}
                      <div className="zk-row">
                        {needsValue
                          ? <Button variant="primary" busy={submitBusy} disabled={expired || !currentLoginVal.trim()} onClick={() => submitLogin(task, currentLoginVal)}>{t(locale, '提交')}</Button>
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

      {status && effectiveAdapterKey === 'qq' && status.actions.some(a => a.name === 'qq-bind-start') && (() => {
        const startAction = status.actions.find(a => a.name === 'qq-bind-start');
        const kindAction = status.actions.find(a => a.name === 'qq-bind-kind');
        const cancelAction = status.actions.find(a => a.name === 'qq-bind-cancel');
        const startResult = actionResults['qq-bind-start'];
        const selectedKind = actionValues['qq-bind-kind']?.value ?? '';
        const publicValue = kindAction?.options.find(o => o.value === 'public' || o.value === '1')?.value ?? 'public';
        const privateValue = kindAction?.options.find(o => o.value === 'private' || o.value === '4')?.value ?? 'private';
        const bindImage = startResult?.image;
        const bindUrl =
          startResult?.url ??
          (typeof status.extra?.scanUrl === 'string' ? status.extra.scanUrl : undefined) ??
          (typeof status.extra?.bindUrl === 'string' ? status.extra.bindUrl : undefined);
        const bindMessage =
          (typeof status.extra?.bindMessage === 'string' ? status.extra.bindMessage : undefined) ??
          startResult?.message;
        const bindActive = Boolean(
          bindImage ||
            bindUrl ||
            status.extra?.bindFlowActive ||
            status.extra?.bindState === 'waiting' ||
            status.extra?.bindState === 'scanned',
        );
        return (
          <div className="zk-qq-workbench" role="region" aria-label={t(locale, 'QQ 官方机器人双轨接入工作台')}>
            <div className="zk-account__head">
              <strong>{t(locale, 'QQ 官方机器人双轨接入工作台')}</strong>
              <Badge tone="neutral">QR + AppID</Badge>
            </div>
            <div className="zk-row">
              {startAction && (
                <button
                  type="button"
                  className="zk-chip-btn"
                  disabled={addDisabled}
                  onClick={() => void runAction(startAction)}
                >
                  {t(locale, '用手机 QQ 扫码一键创建/绑定官方机器人')}
                </button>
              )}
              {cancelAction && bindActive && (
                <button
                  type="button"
                  className="zk-chip-btn"
                  onClick={() => void runAction(cancelAction)}
                >
                  {t(locale, '取消')}
                </button>
              )}
            </div>
            {(bindImage || bindUrl || bindMessage) && (
              <div className="zk-media">
                {bindImage && <img className="zk-qr" src={bindImage} alt={t(locale, '二维码')} />}
                <div className="zk-media__body">
                  <p className="zk-hint">{bindMessage ?? t(locale, '等待手机 QQ 扫码确认…')}</p>
                  {bindUrl && (
                    <p>
                      <a href={bindUrl} target="_blank" rel="noreferrer">{bindUrl}</a>
                    </p>
                  )}
                </div>
              </div>
            )}
            {kindAction && (
              <div className="zk-stack">
                <div className="zk-qq-kind-grid">
                  <button
                    type="button"
                    className="zk-preset-card"
                    aria-pressed={selectedKind === publicValue}
                    onClick={() => setActionValues(curr => ({ ...curr, 'qq-bind-kind': { ...curr['qq-bind-kind'], value: publicValue } }))}
                  >
                    <strong>{t(locale, '公域机器人 (Public)')}</strong>
                    <span className="zk-hint">public · 支持开放群聊与频道添加</span>
                  </button>
                  <button
                    type="button"
                    className="zk-preset-card"
                    aria-pressed={selectedKind === privateValue}
                    onClick={() => setActionValues(curr => ({ ...curr, 'qq-bind-kind': { ...curr['qq-bind-kind'], value: privateValue } }))}
                  >
                    <strong>{t(locale, '私域机器人 (Private)')}</strong>
                    <span className="zk-hint">private · 全量群消息权限，适合自用群管</span>
                  </button>
                </div>
                {selectedKind && (
                  <div className="zk-row">
                    <button
                      type="button"
                      className="zk-chip-btn"
                      disabled={addDisabled}
                      onClick={() => void runAction(kindAction)}
                    >
                      {t(locale, '确认创建并写入配置')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {runtime && <section id="adapter-accounts" className="zk-section">
        {showAccounts && runtime.needsMigration && <Notice tone="warning" title={t(locale, '首次修改前需迁移以下账号，保留身份和历史。')}
          actions={canMigrateNow ? <Button variant="primary" size="sm" disabled={mutating || !!migration || runtimeBlocked} onClick={() => void migrateNow()}>{t(locale, '立即迁移')}</Button> : undefined}>
          <ul>{status?.configured.map(entry => <li key={entry.instanceId ?? entry.id}>{entry.id}</li>)}</ul>
          <p>{t(locale, '迁移后账号以数据库为准，配置文件中的 endpoints 不再生效；之后在这里添加、编辑和启停账号。')}</p>
          {!runtime.canMigrate ? <p>{t(locale, '首次迁移需要管理员确认。')}</p>
            : !canMigrateNow ? <p>{t(locale, '第一次编辑或启停账号时会请求确认迁移。')}</p> : null}
        </Notice>}
        {showAccounts && runtimeBlocked && <Notice tone="danger">{t(locale, '请刷新账号清单后再操作。')}</Notice>}
        {showAccounts && migration && <div role="alertdialog" aria-label={t(locale, '确认迁移')} className="zk-card">
          <p>{t(locale, '确认迁移以下账号并执行本次操作？身份和历史将保留。')}</p>
          <ul>{migration.ids.map(id => <li key={id}>{id}</li>)}</ul>
          <div className="zk-row"><Button variant="primary" busy={mutating} onClick={() => void migration.run()}>{t(locale, '确认迁移')}</Button>
            <Button disabled={mutating} onClick={() => setMigration(undefined)}>{t(locale, '取消')}</Button></div>
        </div>}
        {showAccounts && !runtime.canManage && <p className="zk-hint">{t(locale, '账号配置存储不可用：当前环境只能查看，不能新增或删除账号。')}</p>}
        {showAccounts && !addOpen && !editor && !runtime.endpoints.length && <EmptyState title={t(locale, '还没有账号')} description={t(locale, status?.canAdd && runtime.canManage ? '添加平台账号后，即可在这里管理连接与登录。' : '配置的账号会显示在这里。')} />}
        {showAccounts && !addOpen && !editor && <ul className="zk-bot-grid">{rows.map(row => {
          if (renderRow) return <li key={row.key} className="zk-bot-tile zk-bot-tile--host">{renderRow(row)}</li>;
          const protocolPills = inferAccountProtocolPills(effectiveAdapterKey, row.values, runningModes.get(row.endpointId));
          return <li key={row.key} className="zk-bot-tile">
            <div className="zk-bot-tile__head">
              <div className="zk-bot-tile__identity">
                <div className="zk-bot-tile__icon" aria-hidden="true">{mark}</div>
                <div className="zk-bot-tile__title-wrap">
                  <div className="zk-bot-tile__title">
                    <strong>{row.endpointId}</strong>
                    {(row.enabled || row.retiring) && <Badge tone={row.state.tone}>{row.state.label}</Badge>}
                    {row.execution && <Badge tone={row.execution.tone}>{row.execution.label}</Badge>}
                    {row.pendingLogin && (
                      <Badge tone="warning">
                        {t(locale, '待验证')} · <a href="#adapter-logins">{t(locale, '前往验证')}</a>
                      </Badge>
                    )}
                    {row.lastTest && row.lastTest.latencyMs !== undefined && (
                      <Badge tone={row.lastTest.connected ? 'success' : 'danger'}>{row.lastTest.latencyMs} ms</Badge>
                    )}
                  </div>
                  <span className="zk-bot-tile__subtitle">
                    {platformProfile ? (locale === 'en' ? (platformProfile.categoryBadgeEn ?? platformProfile.categoryBadge) : platformProfile.categoryBadge) : title}
                  </span>
                </div>
              </div>
              {row.can.toggle && (
                <div className="zk-bot-tile__head-right">
                  {/* The switch is the only start / stop control; its visible label names the state. */}
                  <Switch size="sm" checked={row.enabled} disabled={row.disabled} label={row.enabledLabel}
                    ariaLabel={t(locale, '{0}：{1}', row.endpointId, row.enabledLabel)} onChange={enabled => { void row.setEnabled(enabled); }} />
                </div>
              )}
            </div>
            {protocolPills.length > 0 && (
              <div className="zk-account-pills">
                {protocolPills.map((pill) => (
                  <span key={pill.label} className={`zk-account-pill${pill.tone ? ` zk-account-pill--${pill.tone}` : ''}`}>{pill.label}</span>
                ))}
              </div>
            )}
            {row.values && Object.keys(row.values).length > 0 && <details className="zk-bot-tile__config"><summary>{t(locale, '连接配置')}</summary><dl className="zk-dl">
              {Object.entries(row.values).map(([key, value]) => {
                const fDef = status?.fields.find(f => f.key === key);
                const labelText = fDef ? resolveFieldDisplay(effectiveAdapterKey, fDef, locale).displayLabel : key;
                return <React.Fragment key={key}><dt title={key}>{labelText}</dt><dd>{value}</dd></React.Fragment>;
              })}
            </dl></details>}
            {(row.can.test || row.can.edit || row.can.remove) && <div className="zk-bot-tile__actions">
              {row.can.test && <Button busy={row.busy.test} onClick={row.test}>{t(locale, '测试连接')}</Button>}
              {row.can.edit && <Button disabled={row.disabled} onClick={row.edit}>{t(locale, '编辑')}</Button>}
              {row.can.remove && <ConfirmButton disabled={row.disabled} busy={row.busy.remove} confirmLabel={t(locale, '删除账号')}
                message={t(locale, '删除账号「{0}」？账号将关闭，历史保留。', row.endpointId)}
                onConfirm={row.remove}>{t(locale, '删除')}</ConfirmButton>}
            </div>}
          </li>;
        })}
        {status?.canAdd && runtime.canManage && (
          <li>
            <button
              type="button"
              className="zk-bot-tile--add"
              disabled={addDisabled}
              onClick={toggleAdd}
            >
              <span className="zk-bot-tile--add__plus" aria-hidden="true">+</span>
              <span>{t(locale, '新增平台账号')}</span>
              <span className="zk-hint">{t(locale, '进入配置工作台')}</span>
            </button>
          </li>
        )}
        </ul>}
        {showAccounts && runtime.lastMutation && <p role="status" className="zk-hint">{t(locale, '最近操作：{0}', operationLabel(runtime.lastMutation.action, locale))} · {executionLabel(runtime.lastMutation, locale)}</p>}
        {showEditor && renderAccountEditor(m)}
      </section>}

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
          <div className="zk-editor-topbar">
            <div className="zk-editor-topbar__left">
              <button type="button" className="zk-chip-btn" onClick={toggleAdd}>← {t(locale, '账号列表')}</button>
              <strong className="zk-editor-topbar__title">{t(locale, '添加账号')}</strong>
            </div>
            <Badge tone="neutral">{title}</Badge>
          </div>
          <div className="zk-editor-layout">
            <div className="zk-card zk-editor-main">
              <p className="zk-hint">{t(locale, '保存后请手动启动账号。')}</p>

              {platformProfile?.connectionModes && platformProfile.connectionModes.length > 0 && (
                <div className="zk-studio-block">
                  <span className="zk-studio-label">{t(locale, '连接模式')}</span>
                  <div className="zk-mode-tabs">
                    {platformProfile.connectionModes.map((mode) => {
                      const active = activeConnectionMode?.key === mode.key;
                      return (
                        <button
                          key={mode.key}
                          type="button"
                          className="zk-mode-tab"
                          aria-pressed={active}
                          onClick={() => {
                            setSelectedModeKey(mode.key);
                            if (mode.presetValues) {
                              setAddValues((prev) => ({ ...prev, ...mode.presetValues }));
                            }
                          }}
                        >
                          <strong>{locale === 'en' ? (mode.labelEn ?? mode.label) : mode.label}</strong>
                          <span className="zk-hint">{locale === 'en' ? (mode.descriptionEn ?? mode.description) : mode.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeConnectionMode?.callbackUrlTemplate && (() => {
                const tpl = activeConnectionMode.callbackUrlTemplate;
                const rawPath = (addValues[tpl.pathField] ?? '').trim() || tpl.fallbackPath;
                const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
                const hostPart = typeof location !== 'undefined' && location.host ? location.host : 'localhost:8086';
                const scheme = tpl.protocol === 'ws' ? 'ws' : 'http';
                const previewUrl = `${scheme}://${hostPart}${normalizedPath}`;
                return (
                  <div className="zk-callback-box">
                    <span>
                      {tpl.label}：<code>{previewUrl}</code>
                    </span>
                    <button
                      type="button"
                      className="zk-chip-btn"
                      onClick={() => {
                        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                          void navigator.clipboard.writeText(previewUrl);
                        }
                        setCopiedCallback(true);
                        setTimeout(() => setCopiedCallback(false), 2000);
                      }}
                    >
                      {copiedCallback ? t(locale, '已复制') : t(locale, '复制回调地址')}
                    </button>
                  </div>
                );
              })()}

              {platformProfile?.presets && platformProfile.presets.length > 0 && (
                <div className="zk-studio-block">
                  <span className="zk-studio-label">{t(locale, '快速预设模板')}</span>
                  <div className="zk-preset-grid">
                    {platformProfile.presets.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        className="zk-preset-card"
                        onClick={() => setAddValues((prev) => ({ ...prev, ...preset.values }))}
                      >
                        <strong>
                          {locale === 'en' ? (preset.labelEn ?? preset.label) : preset.label}
                          {preset.badge ? ` · ${preset.badge}` : ''}
                        </strong>
                        {preset.description && <span className="zk-hint">{preset.description}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(effectiveAdapterKey === 'email' || platformProfile?.supportsEmailSync) && (
                <div className="zk-row">
                  <button
                    type="button"
                    className="zk-chip-btn"
                    onClick={() =>
                      setAddValues((prev) => {
                        const senderUser = prev['smtp.auth.user'] || prev.user || '';
                        const senderPass = prev['smtp.auth.pass'] || prev.pass || '';
                        return {
                          ...prev,
                          ...(senderUser ? { 'imap.user': senderUser } : {}),
                          ...(senderPass && !prev['imap.password'] ? { 'imap.password': senderPass } : {}),
                        };
                      })
                    }
                  >
                    {t(locale, '将发件账号同步至收件账号')}
                  </button>
                </div>
              )}

              <div className="zk-form-grid">
                <div className="zk-field-cell zk-field-cell--full">
                  <Field
                    label={t(locale, '账号 ID')}
                    required
                    hint={
                      status.idHint
                        ? pickI18n(locale, status.idHint, status.idHintI18n)
                        : platformProfile?.idLabel
                    }
                  >
                    <input
                      disabled={mutating || !!migration}
                      value={addId}
                      placeholder={platformProfile?.idPlaceholder}
                      onChange={(event) => setAddId(event.target.value)}
                    />
                  </Field>
                </div>
              </div>
              {(() => {
                const inactiveSet = new Set(activeConnectionMode?.inactiveFields ?? []);
                const collapsibleSet = new Set(platformProfile?.collapsibleGroups ?? []);
                const nonIdFields = status.fields.filter(field => field.key !== 'id');
                const primaryFields: AdapterConsoleFieldView[] = [];
                const collapsedFields: AdapterConsoleFieldView[] = [];
                for (const field of nonIdFields) {
                  const display = resolveFieldDisplay(effectiveAdapterKey, field, locale);
                  if (inactiveSet.has(field.key) || (display.group && collapsibleSet.has(display.group))) {
                    collapsedFields.push(field);
                  } else {
                    primaryFields.push(field);
                  }
                }
                const renderFieldBlock = (list: readonly AdapterConsoleFieldView[]) => {
                  const sortedList: AdapterConsoleFieldView[] = [];
                  const groupOrder: string[] = [];
                  const byGroup = new Map<string, AdapterConsoleFieldView[]>();
                  for (const f of list) {
                    const g = resolveFieldDisplay(effectiveAdapterKey, f, locale).group ?? '';
                    if (!byGroup.has(g)) {
                      byGroup.set(g, []);
                      groupOrder.push(g);
                    }
                    byGroup.get(g)!.push(f);
                  }
                  for (const g of groupOrder) {
                    sortedList.push(...byGroup.get(g)!);
                  }
                  let lastGroup: string | undefined;
                  return sortedList.map((field) => {
                    const display = resolveFieldDisplay(effectiveAdapterKey, field, locale);
                    const showGroup = display.group && display.group !== lastGroup;
                    if (display.group) lastGroup = display.group;
                    const hintText = display.displayLabel !== field.key
                      ? `${display.hint ? `${display.hint} · ` : ''}${field.key}`
                      : display.hint;
                    return (
                      <React.Fragment key={field.key}>
                        {showGroup && <div className="zk-group-header">{display.group}</div>}
                        <div className="zk-field-cell">
                          <Field label={display.displayLabel} required={field.required} hint={hintText}>
                            <div className="zk-input-group">
                              {renderConfigInput({
                                field,
                                locale,
                                disabled: mutating || !!migration,
                                value: addValues[field.key] ?? '',
                                placeholder: display.placeholder,
                                onValueChange: value => setAddValues(values => ({ ...values, [field.key]: value })),
                              })}
                              {isRandomSecretField(field.key) && (
                                <button
                                  type="button"
                                  className="zk-chip-btn"
                                  onClick={() => setAddValues(values => ({ ...values, [field.key]: generateRandomSecret(field.key) }))}
                                >
                                  🎲 {t(locale, '生成随机密钥')}
                                </button>
                              )}
                            </div>
                          </Field>
                          {display.quickOptions && display.quickOptions.length > 0 && field.type !== 'boolean' && (
                            <div className="zk-option-pills">
                              {display.quickOptions.map(opt => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  className="zk-chip-btn"
                                  aria-pressed={(addValues[field.key] ?? '') === opt.value}
                                  onClick={() => setAddValues(values => ({ ...values, [field.key]: opt.value }))}
                                >
                                  {pickI18n(locale, opt.label, opt.labelI18n) ?? opt.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  });
                };
                return (
                  <>
                    <div className="zk-form-grid">
                      {renderFieldBlock(primaryFields)}
                    </div>
                    {collapsedFields.length > 0 && (
                      <details className="zk-advanced-details">
                        <summary>{t(locale, '高级与底层连接参数（已按当前模式预设，点击展开）')}</summary>
                        <div className="zk-form-grid">
                          {renderFieldBlock(collapsedFields)}
                        </div>
                      </details>
                    )}
                  </>
                );
              })()}
              {formError && <Notice tone="danger">{formError}</Notice>}
              <div className="zk-row">
                <Button variant="primary" busy={isBusy('mutate:add:')} disabled={addDisabled && !isBusy('mutate:add:')} onClick={addEndpoint}>{t(locale, '添加')}</Button>
                <Button variant="secondary" busy={isBusy('mutate:add-start:')} disabled={addDisabled && !isBusy('mutate:add-start:')} onClick={addAndStartEndpoint}>{t(locale, '保存并立即启动')}</Button>
                <Button variant="ghost" onClick={toggleAdd}>{t(locale, '取消')}</Button>
              </div>
            </div>
            {platformProfile && (
              <aside className="zk-editor-side" aria-label={t(locale, '平台接入指南')}>
                <div className="zk-guide-card">
                  <div className="zk-guide-card__head">
                    <strong>{platformProfile.onboardingTitle || t(locale, '平台接入指南')}</strong>
                    <Badge tone="neutral">{locale === 'en' ? (platformProfile.categoryBadgeEn ?? platformProfile.categoryBadge) : platformProfile.categoryBadge}</Badge>
                  </div>
                  {platformProfile.onboardingSteps.length > 0 && (
                    <ol className="zk-guide-steps">
                      {platformProfile.onboardingSteps.map((step, idx) => (
                        <li key={idx} className="zk-guide-step">{step}</li>
                      ))}
                    </ol>
                  )}
                </div>
              </aside>
            )}
          </div>
        </Section>
      )}

      </main>
      {hasSidebar && <aside className="zk-stack" aria-label={t(locale, '平台信息')}>
        {status && sidebarActions.length > 0 && <Section id="adapter-tools" title={t(locale, '平台操作')}>
          <ul className="zk-list">{sidebarActions.map(action => {
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
        {sidebarExtraEntries.length > 0 && <Section title={t(locale, '平台状态')}>
          <dl className="zk-dl">{sidebarExtraEntries.map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{typeof value === 'string' && isLink(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : typeof value === 'boolean' ? t(locale, value ? '已开启' : '已关闭') : String(value)}</dd></React.Fragment>)}</dl>
        </Section>}
      </aside>}
      </div>
      <p className="zk-footnote">{t(locale, '此页面由适配器提供；敏感凭据不会展示。')}</p>
    </PluginPage>
  );
}

/** The account editor (edit or replace one account) of a model with an open editor. */
function renderAccountEditor(m: AdapterConsoleModel) {
  const {
    editor, runtime, locale, title, mutating, migration, platformProfile, status, effectiveAdapterKey, setEditor, editorReplacing,
    formError, runtimeBlocked, collectEdit, saveEdit, isBusy, closeEdit,
  } = m;
  if (!editor || !runtime) return null;
  return <div className="zk-stack" role="region" aria-label={t(locale, '编辑账号')}>
          <div className="zk-editor-topbar">
            <div className="zk-editor-topbar__left">
              <button type="button" className="zk-chip-btn" onClick={closeEdit}>← {t(locale, '账号列表')}</button>
              <strong className="zk-editor-topbar__title">{t(locale, '编辑账号')} · {editor.originalId}</strong>
            </div>
            <Badge tone="neutral">{title}</Badge>
          </div>
          <div className="zk-editor-layout">
            <div className="zk-card zk-editor-main">
              {(editor.generation !== runtime.generation || editor.revision !== runtime.revision) && <Notice tone="danger">{t(locale, '账号清单已变化，请取消编辑后重新打开。')}</Notice>}
              <div className="zk-form-grid">
                <div className="zk-field-cell zk-field-cell--full">
                  <Field label={t(locale, '账号 ID')} hint={platformProfile?.idLabel}><input disabled={mutating || !!migration || !runtime.canReplace || !runtime.identityFields.includes('id')} value={editor.id} onChange={event => setEditor({ ...editor, id: event.target.value })} /></Field>
                </div>
                {status?.fields.filter(field => field.key !== 'id' && (runtime.mutableFields.includes(field.key) || runtime.identityFields.includes(field.key) || editorReplacing)).map(field => {
                  const display = resolveFieldDisplay(effectiveAdapterKey, field, locale);
                  const hintText = display.displayLabel !== field.key
                    ? `${display.hint ? `${display.hint} · ` : ''}${field.key}`
                    : display.hint;
                  return <div key={field.key} className="zk-field-cell">
                    <Field label={display.displayLabel} hint={hintText}>
                      <div className="zk-input-group">
                        {renderConfigInput({ field, locale, allowDefault: !Object.hasOwn(editor.originalValues, field.key), disabled: mutating || !!migration, value: editor.values[field.key] ?? '', placeholder: display.placeholder, onValueChange: value => setEditor({ ...editor, values: { ...editor.values, [field.key]: value } }) })}
                        {isRandomSecretField(field.key) && (
                          <button
                            type="button"
                            className="zk-chip-btn"
                            onClick={() => setEditor({ ...editor, values: { ...editor.values, [field.key]: generateRandomSecret(field.key) } })}
                          >
                            🎲 {t(locale, '生成随机密钥')}
                          </button>
                        )}
                      </div>
                    </Field>
                    {display.quickOptions && display.quickOptions.length > 0 && field.type !== 'boolean' && (
                      <div className="zk-option-pills">
                        {display.quickOptions.map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            className="zk-chip-btn"
                            aria-pressed={(editor.values[field.key] ?? '') === opt.value}
                            onClick={() => setEditor({ ...editor, values: { ...editor.values, [field.key]: opt.value } })}
                          >
                            {pickI18n(locale, opt.label, opt.labelI18n) ?? opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>;
                })}
              </div>
              {formError && <Notice tone="danger">{formError}</Notice>}
              <div className="zk-row">
                {editorReplacing
                  ? <ConfirmButton variant="primary" danger={false} confirmLabel={t(locale, '替换账号')} disabled={runtimeBlocked || !!migration || mutating || editor.generation !== runtime.generation || editor.revision !== runtime.revision}
                    message={t(locale, '替换账号「{0}」？旧账号将关闭，历史保留；新账号不继承会话和设置，保存后需手动启动。', editor.originalId)}
                    beforeOpen={() => collectEdit() !== undefined} onConfirm={saveEdit}>{t(locale, '保存')}</ConfirmButton>
                  : <Button variant="primary" busy={isBusy('mutate:update:' + editor.instanceId)} disabled={runtimeBlocked || !!migration || (mutating && !isBusy('mutate:update:' + editor.instanceId)) || editor.generation !== runtime.generation || editor.revision !== runtime.revision} onClick={saveEdit}>{t(locale, '保存')}</Button>}
                <Button variant="ghost" onClick={closeEdit}>{t(locale, '取消')}</Button>
              </div>
            </div>
            {platformProfile && (
              <aside className="zk-editor-side" aria-label={t(locale, '平台接入指南')}>
                <div className="zk-guide-card">
                  <div className="zk-guide-card__head">
                    <strong>{platformProfile.onboardingTitle || t(locale, '平台接入指南')}</strong>
                    <Badge tone="neutral">{locale === 'en' ? (platformProfile.categoryBadgeEn ?? platformProfile.categoryBadge) : platformProfile.categoryBadge}</Badge>
                  </div>
                  {platformProfile.onboardingSteps.length > 0 && (
                    <ol className="zk-guide-steps">
                      {platformProfile.onboardingSteps.map((step, idx) => (
                        <li key={idx} className="zk-guide-step">{step}</li>
                      ))}
                    </ol>
                  )}
                </div>
              </aside>
            )}
          </div>
        </div>;
}

/** Convention page factory: `pages/index/index.ts` default-exports this. */
export function createAdapterConsolePage(adapterKey: string): React.ComponentType {
  const bp = {
    kind: 'zhin.console.adapter-page' as const,
    version: 1 as const,
    adapterKey,
    dataSource: { action: 'status' as const },
  };
  const fn = function AdapterConsoleRoute() {
    return <AdapterConsolePage adapterKey={adapterKey} />;
  };
  return Object.assign(fn, bp);
}

if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__ZHIN_RENDER_ADAPTER_PAGE__ = (bpOrKey: string | { adapterKey?: string }) =>
    React.createElement(AdapterConsolePage, {
      adapterKey: typeof bpOrKey === 'string' ? bpOrKey : String(bpOrKey?.adapterKey ?? ''),
    });
}
