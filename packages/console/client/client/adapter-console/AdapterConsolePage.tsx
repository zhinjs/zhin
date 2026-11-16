import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleEndpointSummary } from '@zhin.js/console-protocol';
import { consoleRpc, getApiBase, getToken, pluginRpc, PluginRpcError } from '../console-utils/remoteApi.js';
import {
  adapterConsoleLocale,
  adapterConsoleText as t,
  pickI18n,
  type AdapterConsoleLocale,
} from './messages.js';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CodeText,
  ConfirmDialog,
  Grid,
  Section,
  ContentStack,
  Disclosure,
  FormField,
  Input,
  KeyValueList,
  MediaPreview,
  RecordCard,
} from '@zhin.js/console-ui';
import {
  ActionButton,
  ChoiceSelect,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  NoticeBlock,
  RadioChoices,
  RendererPage,
  SwitchRow,
  ToneBadge,
  type RendererTone as BadgeTone,
} from '../renderer/kit.js';
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

function renderConfigInput({ field, locale, id, value, disabled, placeholder, onValueChange, allowDefault = true }: {
  field: AdapterConsoleFieldView;
  locale: AdapterConsoleLocale;
  id?: string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  onValueChange: (value: string) => void;
  allowDefault?: boolean;
}) {
  if (field.type === 'boolean' && !field.secret && !field.env) {
    return <ChoiceSelect id={id} value={value} disabled={disabled} onValueChange={onValueChange} options={[
      { value: '', label: t(locale, '未设置，使用默认值'), disabled: !allowDefault || field.required },
      { value: 'true', label: t(locale, '已开启') },
      { value: 'false', label: t(locale, '已关闭') },
    ]} />;
  }
  return <Input id={id} disabled={disabled} type={field.secret || field.env ? 'password' : field.type === 'number' ? 'number' : 'text'}
    autoComplete={field.secret || field.env ? 'off' : undefined} value={value} placeholder={placeholder} onChange={event => onValueChange(event.target.value)} />;
}

/** `known` 为 false 表示连接列表还没读到：不能把“不知道”显示成“离线”。 */
function connectionTone(endpoint: ConsoleEndpointSummary | undefined, known: boolean): BadgeTone {
  if (!known) return 'neutral';
  if (!endpoint) return 'neutral';
  if (endpoint.pendingLogin) return 'warning';
  if (endpoint.connected && endpoint.status === 'online') return 'success';
  if (endpoint.phase === 'starting' || endpoint.phase === 'awaiting_assist' || endpoint.phase === 'retrying') return 'warning';
  if (endpoint.transportState === 'connecting' || endpoint.transportState === 'reconnecting') return 'warning';
  return 'danger';
}

function connectionLabel(endpoint: ConsoleEndpointSummary | undefined, locale: AdapterConsoleLocale, known: boolean): string {
  if (!known) return t(locale, '状态未知');
  if (!endpoint) return t(locale, '离线');
  if (endpoint.pendingLogin) return t(locale, '等待登录');
  if (endpoint.connected && endpoint.status === 'online') return t(locale, '在线');
  if (endpoint.phase === 'awaiting_assist') return t(locale, '等待登录');
  if (endpoint.phase === 'retrying') return t(locale, '启动失败，等待重试');
  if (endpoint.phase === 'failed') return t(locale, '启动失败');
  if (endpoint.phase === 'starting') return t(locale, '启动中');
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
   *
   * The host must then render `useAdapterAccounts().migration` (and `notice` / `blocked`): an
   * edit or start/stop that needs a migration waits on that confirmation and otherwise appears to
   * do nothing.
   */
  readonly hostAccounts?: boolean;
}

/** What this `AdapterConsolePage` supports, for hosts that must also run against older SDKs. */
/** `pageChrome`: the page hands its header to the shell through `usePageChrome` (ADR 0063 P2). */
export const ADAPTER_CONSOLE_PAGE_CAPABILITIES = Object.freeze({ embedded: true, toolbar: true, refreshKey: true, renderRow: true, hostAccounts: true, pageChrome: true } as const);

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
  // `zk-account-editor-host` is kept only as a marker for Consoles that scroll to the editor by it;
  // it carries no styles any more (use `data-adapter-account-editor`).
  return <div className="zk-account-editor-host" data-adapter-account-editor="">{renderAccountEditor(scope.model)}</div>;
}

type EditorState = { instanceId: string; id: string; originalId: string; values: Record<string, string>; originalValues: Readonly<Record<string, string>>; generation: number; revision: number | null };

type AdapterConsoleViewProps = Pick<AdapterConsolePageProps, 'embedded' | 'toolbar' | 'renderRow' | 'hostAccounts'>;

function AdapterConsoleSession(props: AdapterConsolePageProps & { readonly isCurrent: () => boolean }) {
  const model = useAdapterConsoleModel({ ...props, autoPoll: props.embedded === true });
  return renderAdapterConsoleView(model, props);
}

type AdapterConsoleModel = ReturnType<typeof useAdapterConsoleModel>;

/**
 * `autoPoll`: the reads poll by themselves (embedded pages and `AdapterAccountsProvider`, whose host
 * owns the refresh button). A stand-alone page leaves the timer to its RefreshControl instead
 * (ADR 0063 D5), so the interval the user picks is the only one.
 */
function useAdapterConsoleModel({ adapterKey, refreshKey, isCurrent, autoPoll = true }: { readonly adapterKey: string; readonly refreshKey?: string | number; readonly isCurrent: () => boolean; readonly autoPoll?: boolean }) {
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
  const [pollInterval, setPollInterval] = useState(PAGE_POLL_MS);
  const pollMs = autoPoll ? PAGE_POLL_MS : undefined;
  const statusRead = usePluginRpc<AdapterConsoleStatus>(pluginId, 'status', undefined, { pollMs, isCurrent: current });
  const endpointRead = useRpcResource<{ endpoints?: readonly ConsoleEndpointSummary[] }>('endpoint.list', () => consoleRpc('endpoint.list'), { pollMs, isCurrent: current });
  const loginRead = useRpcResource<{ tasks?: readonly AdapterConsoleLoginTask[] }>('login.list', () => consoleRpc('login.list'), { pollMs, isCurrent: current });
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
    sidebarExtraEntries, hasSidebar, statusError, canAdd, refreshPage, canMigrateNow, migrateNow, pluginId,
    refreshAll, pollInterval, setPollInterval,
  };
}

/** One configuration field of the add form or the account editor. */
function renderAccountField({ field, locale, adapterKey, value, disabled, allowDefault, onValueChange }: {
  field: AdapterConsoleFieldView;
  locale: AdapterConsoleLocale;
  adapterKey: string;
  value: string;
  disabled: boolean;
  allowDefault?: boolean;
  onValueChange: (value: string) => void;
}) {
  const display = resolveFieldDisplay(adapterKey, field, locale);
  const hintText = display.displayLabel !== field.key
    ? `${display.hint ? `${display.hint} · ` : ''}${field.key}`
    : display.hint;
  const id = `adapter-field-${field.key}`;
  return (
    <FormField key={field.key} label={display.displayLabel} required={field.required} hint={hintText} htmlFor={id}>
      <ContentStack direction="row" gap="tight" align="center">
        {renderConfigInput({ field, locale, id, disabled, value, placeholder: display.placeholder, allowDefault, onValueChange })}
        {isRandomSecretField(field.key) && (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onValueChange(generateRandomSecret(field.key))}>
            {t(locale, '生成随机密钥')}
          </Button>
        )}
      </ContentStack>
      {display.quickOptions && display.quickOptions.length > 0 && field.type !== 'boolean' && (
        <ContentStack direction="row" gap="tight">
          {display.quickOptions.map(opt => (
            <Button
              key={opt.value}
              type="button"
              variant={value === opt.value ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={value === opt.value}
              disabled={disabled}
              onClick={() => onValueChange(opt.value)}
            >
              {pickI18n(locale, opt.label, opt.labelI18n) ?? opt.label}
            </Button>
          ))}
        </ContentStack>
      )}
    </FormField>
  );
}

/** Field list with group headings (fields of one group stay together, in first-seen group order). */
function renderFieldBlock(fields: readonly AdapterConsoleFieldView[], locale: AdapterConsoleLocale, adapterKey: string, render: (field: AdapterConsoleFieldView) => React.ReactNode) {
  const order: string[] = [];
  const byGroup = new Map<string, AdapterConsoleFieldView[]>();
  for (const field of fields) {
    const group = resolveFieldDisplay(adapterKey, field, locale).group ?? '';
    if (!byGroup.has(group)) { byGroup.set(group, []); order.push(group); }
    byGroup.get(group)!.push(field);
  }
  return (
    <Grid min="14rem">
      {order.flatMap(group => [
        ...(group ? [<FormField key={`group:${group}`} full label={<span className="console-section-title">{group}</span>} />] : []),
        ...byGroup.get(group)!.map(render),
      ])}
    </Grid>
  );
}

function renderOnboardingGuide(m: AdapterConsoleModel) {
  const { platformProfile, locale } = m;
  if (!platformProfile) return null;
  return (
    <Card aria-label={t(locale, '平台接入指南')}>
      <CardHeader>
        <ContentStack direction="row" gap="tight" justify="between" align="center">
          <CardTitle>{platformProfile.onboardingTitle || t(locale, '平台接入指南')}</CardTitle>
          <ToneBadge tone="neutral">{locale === 'en' ? (platformProfile.categoryBadgeEn ?? platformProfile.categoryBadge) : platformProfile.categoryBadge}</ToneBadge>
        </ContentStack>
      </CardHeader>
      {platformProfile.onboardingSteps.length > 0 && (
        <CardContent>
          <ol data-onboarding-steps="">
            {platformProfile.onboardingSteps.map((step, idx) => <li key={idx}>{step}</li>)}
          </ol>
        </CardContent>
      )}
    </Card>
  );
}

function renderAdapterConsoleView(m: AdapterConsoleModel, { embedded = false, toolbar, renderRow, hostAccounts = false }: AdapterConsoleViewProps) {
  const {
    rows, locale, owner, statusRead, endpointRead, loginRead, status, runtime, connectionsKnown, endpointById, runningIds, runningModes,
    notice, setNotice, isBusy, mutating, addOpen, addId, setAddId, addValues, setAddValues, formError, actionValues, setActionValues, actionResults, actionErrors,
    loginValues, setLoginValues, now, runtimeBlocked, migration, setMigration, editor, setSelectedModeKey, activeConnectionMode, platformProfile,
    copiedCallback, setCopiedCallback, effectiveAdapterKey, testConnection, toggleAdd, addEndpoint, addAndStartEndpoint, submitLogin, cancelLogin,
    validateAction, runAction, visibleLogins, closeEdit, title, docsUrl, addDisabled, sidebarActions,
    sidebarExtraEntries, statusError, canAdd, refreshPage, canMigrateNow, migrateNow, pluginId, refreshAll, pollInterval, setPollInterval,
  } = m;
  const docsLink = docsUrl ? (
    <Button asChild variant="outline" size="sm"><a href={docsUrl} target="_blank" rel="noreferrer">{t(locale, '文档')}</a></Button>
  ) : null;
  const addButton = canAdd ? (
    <Button type="button" variant={addOpen ? 'outline' : 'default'} size="sm" disabled={addDisabled} aria-expanded={addOpen} aria-controls="adapter-add-account" onClick={toggleAdd}>
      {addOpen ? t(locale, '取消') : t(locale, '添加')}
    </Button>
  ) : null;
  const toolbarControls: AdapterConsoleToolbarControls = {
    ...(docsUrl ? { docsUrl } : {}),
    ...(canAdd ? { add: { open: addOpen, disabled: addDisabled, toggle: toggleAdd, controls: 'adapter-add-account' } } : {}),
    refresh: refreshPage,
    refreshing: isBusy('refresh'),
  };
  // The host draws the account list, editor and account status from `useAdapterAccounts()`.
  const showAccounts = !hostAccounts;
  const showEditor = !!editor && showAccounts;
  const fieldDisabled = mutating || !!migration;

  const embeddedToolbar = embedded
    ? (toolbar
      ? (() => { const node = toolbar(toolbarControls); return node == null || node === false ? null : <div data-adapter-toolbar="">{node}</div>; })()
      : (docsLink || addButton) ? <ContentStack direction="row" gap="tight" data-adapter-toolbar="">{docsLink}{addButton}</ContentStack> : null)
    : null;

  const loginTasks = !addOpen && !editor && visibleLogins.length > 0 ? (
    <Section id="adapter-logins" title={t(locale, '登录待办')} description={t(locale, '完成验证后，账号即可继续连接。')}>
      <ContentStack direction="row" gap="tight" aria-label={t(locale, '登录待办')}>
        <ToneBadge tone="neutral">{t(locale, '1. 发起连接')}</ToneBadge>
        <ToneBadge tone="primary">{t(locale, '2. 完成平台安全验证')}</ToneBadge>
        <ToneBadge tone="neutral">{t(locale, '3. 账号在线就绪')}</ToneBadge>
      </ContentStack>
      <ContentStack gap="tight">
        {visibleLogins.map((task) => {
          const image = typeof task.payload.image === 'string' ? task.payload.image : undefined;
          const url = typeof task.payload.url === 'string' ? task.payload.url : undefined;
          const message = typeof task.payload.message === 'string' ? task.payload.message : undefined;
          const needsValue = task.type === 'slider' || task.type === 'device' || task.type === 'sms' || task.type === 'other';
          const remaining = task.expiresAt ? Math.max(0, Math.ceil((task.expiresAt - now) / 1_000)) : undefined;
          const expired = remaining === 0;
          const submitBusy = isBusy(`login:${task.id}`);
          const currentLoginVal = loginValues[task.id] ?? '';
          const inputId = `adapter-login-${task.id}`;
          const announcement = expired ? t(locale, '验证已过期，请刷新或重新启动账号。')
            : remaining !== undefined && remaining <= EXPIRY_WARNING_SECONDS ? t(locale, '验证即将过期') : '';
          return (
            <Card key={task.id} data-login-task={task.id}>
              <CardContent>
                <ContentStack>
                  <ContentStack direction="row" gap="tight" align="center" justify="between">
                    <ContentStack direction="row" gap="tight" align="center">
                      <ToneBadge tone="warning">{loginTypeLabel(task.type, locale)}</ToneBadge>
                      <strong>{task.endpointKey}</strong>
                    </ContentStack>
                    {remaining !== undefined && !expired && <time className="console-form-field-hint" dateTime={`PT${remaining}S`}>{t(locale, '剩余 {0} 秒', remaining)}</time>}
                  </ContentStack>
                  {/* 倒计时本身不朗读（每秒变化）；只在临近过期与已过期时播报一次固定文案。 */}
                  <p role="status" className="console-form-field-hint">{announcement}</p>
                  <ContentStack direction="row" gap="stack" align="start">
                    {image && isImageSource(image) && <MediaPreview src={image} alt={t(locale, '{0}（账号 {1}）', loginTypeLabel(task.type, locale), task.endpointKey)} />}
                    <ContentStack gap="tight">
                      {message && <p>{message}</p>}
                      {image && !isImageSource(image) && isLink(image) && <a className="console-touch" href={image} target="_blank" rel="noreferrer">{image}</a>}
                      {url && (
                        <ContentStack direction="row" gap="tight" align="center">
                          <a className="console-touch" href={url} target="_blank" rel="noreferrer">{url}</a>
                          {task.type === 'slider' && (
                            <Button asChild variant="outline" size="sm"><a href={url} target="_blank" rel="noreferrer">{t(locale, '打开滑块验证页面')}</a></Button>
                          )}
                        </ContentStack>
                      )}
                      {task.type === 'slider' && (
                        <Disclosure summary={t(locale, '如何提取滑块 Ticket？（F12 → Network → cap_union_new_verify → ticket）')}>
                          <p className="console-form-field-hint">
                            1. 打开上方滑块验证页面并按下 F12 打开开发者工具 → Network（网络）面板；2. 拖动滑块完成拼图；3. 在 `cap_union_new_verify` 响应中复制 `ticket` 字段（或直接粘贴整段 JSON 响应，系统将自动提取 Ticket）。
                          </p>
                        </Disclosure>
                      )}
                      {needsValue ? <>
                        <FormField label={t(locale, '请输入 {0}', loginTypeLabel(task.type, locale))} htmlFor={inputId}>
                          <Input id={inputId} value={currentLoginVal} disabled={submitBusy || expired}
                            onChange={event => setLoginValues(values => ({ ...values, [task.id]: event.target.value }))} />
                        </FormField>
                        {task.type === 'slider' && currentLoginVal.trim() && extractSliderTicket(currentLoginVal) !== currentLoginVal.trim() && (
                          <ContentStack direction="row" gap="tight">
                            <Button type="button" variant="outline" size="sm" onClick={() => setLoginValues(values => ({ ...values, [task.id]: extractSliderTicket(currentLoginVal) }))}>
                              {t(locale, '自动提取 Ticket')} ({extractSliderTicket(currentLoginVal).slice(0, 16)}…)
                            </Button>
                          </ContentStack>
                        )}
                      </> : null}
                      <ContentStack direction="row" gap="tight">
                        {needsValue
                          ? <Button type="button" variant="default" size="sm" aria-busy={submitBusy || undefined} disabled={submitBusy || expired || !currentLoginVal.trim()} onClick={() => submitLogin(task, currentLoginVal)}>{t(locale, '提交')}</Button>
                          : <Button type="button" variant="default" size="sm" aria-busy={submitBusy || undefined} disabled={submitBusy || expired} onClick={() => submitLogin(task, 'ok')}>{task.type === 'qrcode' ? t(locale, '已扫码，继续') : t(locale, '完成')}</Button>}
                        <Button type="button" variant="ghost" size="sm" aria-busy={isBusy(`login-cancel:${task.id}`) || undefined} disabled={isBusy(`login-cancel:${task.id}`)} onClick={() => cancelLogin(task)}>{t(locale, '取消')}</Button>
                      </ContentStack>
                    </ContentStack>
                  </ContentStack>
                </ContentStack>
              </CardContent>
            </Card>
          );
        })}
      </ContentStack>
    </Section>
  ) : null;

  const qqWorkbench = status && effectiveAdapterKey === 'qq' && status.actions.some(a => a.name === 'qq-bind-start') ? (() => {
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
    const bindMessage = (typeof status.extra?.bindMessage === 'string' ? status.extra.bindMessage : undefined) ?? startResult?.message;
    const bindActive = Boolean(bindImage || bindUrl || status.extra?.bindFlowActive || status.extra?.bindState === 'waiting' || status.extra?.bindState === 'scanned');
    const chooseKind = (value: string) => setActionValues(curr => ({ ...curr, 'qq-bind-kind': { ...curr['qq-bind-kind'], value } }));
    return (
      <Section title={t(locale, 'QQ 官方机器人双轨接入工作台')} actions={<ToneBadge tone="neutral">QR + AppID</ToneBadge>} role="region" aria-label={t(locale, 'QQ 官方机器人双轨接入工作台')}>
        <ContentStack direction="row" gap="tight">
          {startAction && (
            <Button type="button" variant="default" size="sm" disabled={addDisabled} onClick={() => void runAction(startAction)}>
              {t(locale, '用手机 QQ 扫码一键创建/绑定官方机器人')}
            </Button>
          )}
          {cancelAction && bindActive && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void runAction(cancelAction)}>{t(locale, '取消')}</Button>
          )}
        </ContentStack>
        {(bindImage || bindUrl || bindMessage) && (
          <ContentStack direction="row" gap="stack" align="start">
            {bindImage && <MediaPreview src={bindImage} alt={t(locale, '二维码')} />}
            <ContentStack gap="tight">
              <p className="console-form-field-hint">{bindMessage ?? t(locale, '等待手机 QQ 扫码确认…')}</p>
              {bindUrl && <a className="console-touch" href={bindUrl} target="_blank" rel="noreferrer">{bindUrl}</a>}
            </ContentStack>
          </ContentStack>
        )}
        {kindAction && (
          <ContentStack gap="tight">
            <RadioChoices
              aria-label={t(locale, '机器人类型')}
              value={selectedKind}
              onValueChange={chooseKind}
              options={[
                { value: publicValue, label: t(locale, '公域机器人 (Public)'), description: 'public · 支持开放群聊与频道添加' },
                { value: privateValue, label: t(locale, '私域机器人 (Private)'), description: 'private · 全量群消息权限，适合自用群管' },
              ]}
            />
            {selectedKind && (
              <ContentStack direction="row" gap="tight">
                <Button type="button" variant="default" size="sm" disabled={addDisabled} onClick={() => void runAction(kindAction)}>{t(locale, '确认创建并写入配置')}</Button>
              </ContentStack>
            )}
          </ContentStack>
        )}
      </Section>
    );
  })() : null;

  const accountCards = runtime && showAccounts && !addOpen && !editor ? (
    <Grid data-adapter-accounts="">
      {rows.map(row => {
        if (renderRow) return <div key={row.key} data-adapter-account={row.endpointId}>{renderRow(row)}</div>;
        const protocolPills = inferAccountProtocolPills(effectiveAdapterKey, row.values, runningModes.get(row.endpointId));
        return (
          <RecordCard
            key={row.key}
            title={
              <ContentStack direction="row" gap="tight" align="center" justify="between">
                <ContentStack direction="row" gap="tight" align="center">
                  <strong>{row.endpointId}</strong>
                  {(row.enabled || row.retiring) && <ToneBadge tone={row.state.tone}>{row.state.label}</ToneBadge>}
                  {row.execution && <ToneBadge tone={row.execution.tone}>{row.execution.label}</ToneBadge>}
                  {row.pendingLogin && <ToneBadge tone="warning">{t(locale, '待验证')} · <a className="console-touch" href="#adapter-logins">{t(locale, '前往验证')}</a></ToneBadge>}
                  {row.lastTest && row.lastTest.latencyMs !== undefined && (
                    <ToneBadge tone={row.lastTest.connected ? 'success' : 'danger'}>{row.lastTest.latencyMs} ms</ToneBadge>
                  )}
                </ContentStack>
                {row.can.toggle && (
                  // The switch is the only start / stop control; its visible label names the state.
                  <SwitchRow checked={row.enabled} disabled={row.disabled} label={row.enabledLabel} aria-label={t(locale, '{0}：{1}', row.endpointId, row.enabledLabel)} onCheckedChange={enabled => { void row.setEnabled(enabled); }} />
                )}
              </ContentStack>
            }
            fields={[]}
            actions={row.can.test || row.can.edit || row.can.remove ? <>
              {row.can.test && <Button type="button" variant="outline" size="sm" aria-busy={row.busy.test || undefined} disabled={row.busy.test} onClick={row.test}>{t(locale, '测试连接')}</Button>}
              {row.can.edit && <Button type="button" variant="outline" size="sm" disabled={row.disabled} onClick={row.edit}>{t(locale, '编辑')}</Button>}
              {row.can.remove && (
                <ActionButton
                  label={t(locale, '删除')}
                  variant="danger"
                  locale={locale}
                  disabled={row.disabled}
                  busy={row.busy.remove}
                  confirm={t(locale, '删除账号「{0}」？账号将关闭，历史保留。', row.endpointId)}
                  confirmLabel={t(locale, '删除账号')}
                  onRun={row.remove}
                />
              )}
            </> : undefined}
          >
            <span className="console-form-field-hint">
              {platformProfile ? (locale === 'en' ? (platformProfile.categoryBadgeEn ?? platformProfile.categoryBadge) : platformProfile.categoryBadge) : title}
            </span>
            {protocolPills.length > 0 && (
              <ContentStack direction="row" gap="tight">
                {protocolPills.map((pill) => <ToneBadge key={pill.label} tone={pill.tone === 'info' || pill.tone === 'primary' ? pill.tone : 'neutral'}>{pill.label}</ToneBadge>)}
              </ContentStack>
            )}
            {row.values && Object.keys(row.values).length > 0 && (
              <Disclosure summary={t(locale, '连接配置')}>
                <KeyValueList
                  columns={1}
                  items={Object.entries(row.values).map(([key, value]) => {
                    const fDef = status?.fields.find(f => f.key === key);
                    return { key, label: fDef ? resolveFieldDisplay(effectiveAdapterKey, fDef, locale).displayLabel : key, value };
                  })}
                />
              </Disclosure>
            )}
          </RecordCard>
        );
      })}
      {status?.canAdd && runtime.canManage && (
        <Card>
          <CardContent>
            <ContentStack gap="tight" align="start">
              <Button type="button" variant="outline" size="sm" disabled={addDisabled} onClick={toggleAdd}>{t(locale, '新增平台账号')}</Button>
              <span className="console-form-field-hint">{t(locale, '进入配置工作台')}</span>
            </ContentStack>
          </CardContent>
        </Card>
      )}
    </Grid>
  ) : null;

  const accountsSection = runtime ? (
    <Section id="adapter-accounts" aria-label={t(locale, '账号')}>
      {showAccounts && runtime.needsMigration && (
        <NoticeBlock
          tone="warning"
          actions={canMigrateNow ? <Button type="button" variant="default" size="sm" disabled={mutating || !!migration || runtimeBlocked} onClick={() => void migrateNow()}>{t(locale, '立即迁移')}</Button> : undefined}
        >
          <ContentStack gap="tight">
            <strong>{t(locale, '首次修改前需迁移以下账号，保留身份和历史。')}</strong>
            <ul>{status?.configured.map(entry => <li key={entry.instanceId ?? entry.id}>{entry.id}</li>)}</ul>
            <span>{t(locale, '迁移后账号以数据库为准，配置文件中的 endpoints 不再生效；之后在这里添加、编辑和启停账号。')}</span>
            {!runtime.canMigrate ? <span>{t(locale, '首次迁移需要管理员确认。')}</span>
              : !canMigrateNow ? <span>{t(locale, '第一次编辑或启停账号时会请求确认迁移。')}</span> : null}
          </ContentStack>
        </NoticeBlock>
      )}
      {showAccounts && runtimeBlocked && <NoticeBlock tone="danger">{t(locale, '请刷新账号清单后再操作。')}</NoticeBlock>}
      {showAccounts && migration && (
        <ConfirmDialog
          open
          onOpenChange={open => { if (!open && !mutating) setMigration(undefined); }}
          title={t(locale, '确认迁移')}
          description={t(locale, '确认迁移以下账号并执行本次操作？身份和历史将保留。')}
          confirmLabel={t(locale, '确认迁移')}
          cancelLabel={t(locale, '取消')}
          onConfirm={async () => { await migration.run(); }}
        >
          <ul data-migration-ids="">{migration.ids.map(id => <li key={id}>{id}</li>)}</ul>
        </ConfirmDialog>
      )}
      {showAccounts && !runtime.canManage && <p className="console-form-field-hint">{t(locale, '账号配置存储不可用：当前环境只能查看，不能新增或删除账号。')}</p>}
      {showAccounts && !addOpen && !editor && !runtime.endpoints.length && (
        <EmptyBlock title={t(locale, '还没有账号')} description={t(locale, status?.canAdd && runtime.canManage ? '添加平台账号后，即可在这里管理连接与登录。' : '配置的账号会显示在这里。')} />
      )}
      {accountCards}
      {showAccounts && runtime.lastMutation && <p role="status" className="console-form-field-hint">{t(locale, '最近操作：{0}', operationLabel(runtime.lastMutation.action, locale))} · {executionLabel(runtime.lastMutation, locale)}</p>}
      {showEditor && renderAccountEditor(m)}
    </Section>
  ) : null;

  const addForm = runtime && status?.canAdd && addOpen ? (() => {
    const inactiveSet = new Set(activeConnectionMode?.inactiveFields ?? []);
    const collapsibleSet = new Set(platformProfile?.collapsibleGroups ?? []);
    const primaryFields: AdapterConsoleFieldView[] = [];
    const collapsedFields: AdapterConsoleFieldView[] = [];
    for (const field of status.fields.filter(field => field.key !== 'id')) {
      const display = resolveFieldDisplay(effectiveAdapterKey, field, locale);
      if (inactiveSet.has(field.key) || (display.group && collapsibleSet.has(display.group))) collapsedFields.push(field);
      else primaryFields.push(field);
    }
    const renderField = (field: AdapterConsoleFieldView) => renderAccountField({
      field, locale, adapterKey: effectiveAdapterKey, disabled: fieldDisabled, value: addValues[field.key] ?? '',
      onValueChange: value => setAddValues(values => ({ ...values, [field.key]: value })),
    });
    const callback = activeConnectionMode?.callbackUrlTemplate ? (() => {
      const tpl = activeConnectionMode.callbackUrlTemplate;
      const rawPath = (addValues[tpl.pathField] ?? '').trim() || tpl.fallbackPath;
      const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      const hostPart = typeof location !== 'undefined' && location.host ? location.host : 'localhost:8086';
      const previewUrl = `${tpl.protocol === 'ws' ? 'ws' : 'http'}://${hostPart}${normalizedPath}`;
      return (
        <NoticeBlock
          tone="info"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) void navigator.clipboard.writeText(previewUrl);
              setCopiedCallback(true);
              setTimeout(() => setCopiedCallback(false), 2000);
            }}>
              {copiedCallback ? t(locale, '已复制') : t(locale, '复制回调地址')}
            </Button>
          }
        >
          {tpl.label}：<CodeText>{previewUrl}</CodeText>
        </NoticeBlock>
      );
    })() : null;
    return (
      <Section
        id="adapter-add-account"
        aria-label={t(locale, '添加账号')}
        title={t(locale, '添加账号')}
        description={t(locale, '保存后请手动启动账号。')}
        actions={<>
          <ToneBadge tone="neutral">{title}</ToneBadge>
          <Button type="button" variant="ghost" size="sm" onClick={toggleAdd}>← {t(locale, '账号列表')}</Button>
        </>}
      >
        <Grid min="24rem">
          <Card>
            <CardContent>
              <ContentStack>
                {platformProfile?.connectionModes && platformProfile.connectionModes.length > 0 && (
                  <FormField label={t(locale, '连接模式')}>
                    <RadioChoices
                      aria-label={t(locale, '连接模式')}
                      value={activeConnectionMode?.key ?? ''}
                      onValueChange={(key) => {
                        const mode = platformProfile.connectionModes!.find(item => item.key === key);
                        setSelectedModeKey(key);
                        if (mode?.presetValues) setAddValues((prev) => ({ ...prev, ...mode.presetValues }));
                      }}
                      options={platformProfile.connectionModes.map(mode => ({
                        value: mode.key,
                        label: locale === 'en' ? (mode.labelEn ?? mode.label) : mode.label,
                        description: locale === 'en' ? (mode.descriptionEn ?? mode.description) : mode.description,
                      }))}
                    />
                  </FormField>
                )}
                {callback}
                {platformProfile?.presets && platformProfile.presets.length > 0 && (
                  <FormField label={t(locale, '快速预设模板')}>
                    <Grid min="14rem">
                      {platformProfile.presets.map((preset) => (
                        <ContentStack key={preset.key} gap="tight" align="start">
                          <Button type="button" variant="outline" size="sm" onClick={() => setAddValues((prev) => ({ ...prev, ...preset.values }))}>
                            {locale === 'en' ? (preset.labelEn ?? preset.label) : preset.label}
                            {preset.badge ? ` · ${preset.badge}` : ''}
                          </Button>
                          {preset.description && <span className="console-form-field-hint">{preset.description}</span>}
                        </ContentStack>
                      ))}
                    </Grid>
                  </FormField>
                )}
                {(effectiveAdapterKey === 'email' || platformProfile?.supportsEmailSync) && (
                  <ContentStack direction="row" gap="tight">
                    <Button type="button" variant="outline" size="sm" onClick={() => setAddValues((prev) => {
                      const senderUser = prev['smtp.auth.user'] || prev.user || '';
                      const senderPass = prev['smtp.auth.pass'] || prev.pass || '';
                      return {
                        ...prev,
                        ...(senderUser ? { 'imap.user': senderUser } : {}),
                        ...(senderPass && !prev['imap.password'] ? { 'imap.password': senderPass } : {}),
                      };
                    })}>
                      {t(locale, '将发件账号同步至收件账号')}
                    </Button>
                  </ContentStack>
                )}
                <FormField
                  label={t(locale, '账号 ID')}
                  required
                  htmlFor="adapter-add-id"
                  hint={status.idHint ? pickI18n(locale, status.idHint, status.idHintI18n) : platformProfile?.idLabel}
                >
                  <Input id="adapter-add-id" disabled={fieldDisabled} value={addId} placeholder={platformProfile?.idPlaceholder} onChange={(event) => setAddId(event.target.value)} />
                </FormField>
                {renderFieldBlock(primaryFields, locale, effectiveAdapterKey, renderField)}
                {collapsedFields.length > 0 && (
                  <Disclosure summary={t(locale, '高级与底层连接参数（已按当前模式预设，点击展开）')}>
                    {renderFieldBlock(collapsedFields, locale, effectiveAdapterKey, renderField)}
                  </Disclosure>
                )}
                {formError && <NoticeBlock tone="danger">{formError}</NoticeBlock>}
                <ContentStack direction="row" gap="tight">
                  <Button type="button" variant="default" size="sm" aria-busy={isBusy('mutate:add:') || undefined} disabled={addDisabled} onClick={addEndpoint}>{t(locale, '添加')}</Button>
                  <Button type="button" variant="outline" size="sm" aria-busy={isBusy('mutate:add-start:') || undefined} disabled={addDisabled} onClick={addAndStartEndpoint}>{t(locale, '保存并立即启动')}</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={toggleAdd}>{t(locale, '取消')}</Button>
                </ContentStack>
              </ContentStack>
            </CardContent>
          </Card>
          {renderOnboardingGuide(m)}
        </Grid>
      </Section>
    );
  })() : null;

  const platformActions = status && sidebarActions.length > 0 ? (
    <Section id="adapter-tools" title={t(locale, '平台操作')}>
      <Grid>
        {sidebarActions.map(action => {
          const values = actionValues[action.name] ?? {};
          const result = actionResults[action.name];
          const label = pickI18n(locale, action.label, action.labelI18n) ?? action.name;
          const actionBusy = isBusy(action.accountMutation ? `mutate:action:${action.name}` : `action:${action.name}`);
          const actionDisabled = !!(action.accountMutation && (!runtime?.canManage || runtimeBlocked || migration || (runtime.needsMigration && !runtime.canMigrate) || (mutating && !actionBusy)));
          return (
            <Card key={action.name} data-platform-action={action.name}>
              <CardHeader>
                <CardTitle>{label}</CardTitle>
                {action.description && <span className="console-form-field-hint">{pickI18n(locale, action.description, action.descriptionI18n)}</span>}
              </CardHeader>
              <CardContent>
                <ContentStack>
                  {action.fields.map(field => {
                    const id = `adapter-action-${action.name}-${field.key}`;
                    return (
                      <FormField key={field.key} label={pickI18n(locale, field.label, field.labelI18n) ?? field.key} required={field.required} htmlFor={id}>
                        <Input id={id} type={field.secret ? 'password' : 'text'} autoComplete={field.secret ? 'off' : undefined} value={values[field.key] ?? ''} placeholder={field.placeholder}
                          onChange={event => setActionValues(current => ({ ...current, [action.name]: { ...current[action.name], [field.key]: event.target.value } }))} />
                      </FormField>
                    );
                  })}
                  {action.options.length > 0 && (
                    <FormField label={label} required>
                      <ChoiceSelect
                        aria-label={label}
                        value={values.value ?? ''}
                        placeholder={t(locale, '选择…')}
                        onValueChange={value => setActionValues(current => ({ ...current, [action.name]: { ...current[action.name], value } }))}
                        options={action.options.map(option => ({ value: option.value, label: pickI18n(locale, option.label, option.labelI18n) ?? option.value }))}
                      />
                    </FormField>
                  )}
                  {actionErrors[action.name] && <p role="alert" className="console-form-field-error">{actionErrors[action.name]}</p>}
                  <ContentStack direction="row" gap="tight">
                    <ActionButton
                      label={label}
                      fallbackVariant="default"
                      locale={locale}
                      busy={actionBusy}
                      disabled={actionDisabled}
                      confirm={action.confirm}
                      confirmLabel={label}
                      beforeConfirm={() => validateAction(action)}
                      onRun={() => runAction(action)}
                    />
                  </ContentStack>
                  {result && (
                    <NoticeBlock tone={result.tone === 'error' ? 'danger' : 'success'}>
                      <ContentStack gap="tight">
                        {result.message}
                        {result.url && <a className="console-touch" href={result.url} target="_blank" rel="noreferrer">{result.url}</a>}
                        {result.image && <MediaPreview src={result.image} alt={t(locale, '操作返回的图片')} />}
                        {result.details && <KeyValueList columns={1} items={Object.entries(result.details).map(([key, value]) => ({ key, label: key, value: String(value) }))} />}
                      </ContentStack>
                    </NoticeBlock>
                  )}
                </ContentStack>
              </CardContent>
            </Card>
          );
        })}
      </Grid>
    </Section>
  ) : null;

  return (
    <RendererPage
      title={title}
      description={status ? t(locale, runtime ? '管理 {0} 的账号与登录。' : '查看 {0} 的连接与账号配置。', title) : undefined}
      actions={!embedded && (docsLink || addButton) ? <>{docsLink}{addButton}</> : undefined}
      chromeDeps={[embedded, locale, docsUrl, canAdd, addOpen, addDisabled, runtime?.generation, runtime?.revision]}
      refresh={{ onRefresh: refreshPage, onAutoRefresh: refreshAll, updatedAt: statusRead.lastSuccessAt ?? null, intervalMs: pollInterval, onIntervalChange: setPollInterval, refreshing: isBusy('refresh') || statusRead.refreshing }}
      embedded={embedded}
      data-embedded={embedded ? 'true' : undefined}
      data-zhin-plugin-id={pluginId}
    >
      {embeddedToolbar}

      {status && (
        <nav aria-label={t(locale, '页面导航')}>
          <ContentStack direction="row" gap="tight">
            {showAccounts && (
              <Button asChild variant="ghost" size="sm">
                <a className="console-touch" href="#adapter-accounts" onClick={(e) => { if (addOpen || editor) { e.preventDefault(); if (addOpen) toggleAdd(); if (editor) closeEdit(); } }}>
                  {t(locale, '账号')} <ToneBadge tone="neutral">{runtime?.endpoints.length ?? status.configured.length}</ToneBadge>
                </a>
              </Button>
            )}
            {visibleLogins.length > 0 && (
              <Button asChild variant="ghost" size="sm"><a href="#adapter-logins">{t(locale, '登录待办')} <ToneBadge tone="warning">{visibleLogins.length}</ToneBadge></a></Button>
            )}
            {sidebarActions.length > 0 && <Button asChild variant="ghost" size="sm"><a href="#adapter-tools">{t(locale, '平台操作')}</a></Button>}
          </ContentStack>
        </nav>
      )}

      {notice && showAccounts && (
        <NoticeBlock tone={notice.kind === 'error' ? 'danger' : 'success'} onDismiss={() => setNotice(undefined)} dismissLabel={t(locale, '关闭')}>
          {notice.message}
          {notice.url && <> · <a className="console-touch" href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a></>}
          {/* 二维码必须黑码白底才能被扫描；MediaPreview 固定白底。 */}
          {notice.image && <MediaPreview src={notice.image} alt={t(locale, '操作返回的图片')} />}
        </NoticeBlock>
      )}

      {owner.state === 'loading' && <LoadingBlock label={t(locale, '正在解析插件…')} />}
      {owner.state === 'error' && <ErrorBlock message={`${t(locale, '无法确定本页所属插件')}：${describeError(owner.error, locale, t(locale, '解析插件'))}`}
        details={technicalDetails(owner.error)} onRetry={() => { void owner.refresh(); }} />}
      {owner.state === 'empty' && <ErrorBlock message={`${t(locale, '找不到页面所属插件')}：${t(locale, '请确认该适配器插件已启用，并刷新页面。')}`} onRetry={() => { void owner.refresh(); }} />}

      {pluginId && statusRead.state === 'loading' && <LoadingBlock label={t(locale, '加载中…')} />}
      {statusRead.state === 'error' && <ErrorBlock message={`${t(locale, '无法读取账号状态')}：${describeError(statusError, locale, t(locale, '读取账号状态'))}`}
        details={technicalDetails(statusError)} onRetry={() => { void statusRead.refresh(); }} />}
      {statusRead.state === 'stale' && <NoticeBlock tone="warning">{describeError(statusError, locale, t(locale, '读取账号状态'))}</NoticeBlock>}
      {endpointRead.state === 'error' && (
        <NoticeBlock tone="warning" actions={<Button type="button" variant="outline" size="sm" aria-busy={endpointRead.refreshing || undefined} onClick={() => { void endpointRead.refresh(); }}>{t(locale, '重试')}</Button>}>
          <strong>{t(locale, '无法读取连接状态')}</strong> {t(locale, '账号的在线状态暂时显示为未知。')}
        </NoticeBlock>
      )}
      {endpointRead.state === 'stale' && <NoticeBlock tone="warning">{describeError(endpointRead.error, locale, t(locale, '读取连接状态'))}</NoticeBlock>}
      {loginRead.state === 'error' && (
        <NoticeBlock tone="warning" actions={<Button type="button" variant="outline" size="sm" aria-busy={loginRead.refreshing || undefined} onClick={() => { void loginRead.refresh(); }}>{t(locale, '重试')}</Button>}>
          <strong>{t(locale, '无法读取登录待办')}</strong> {describeError(loginRead.error, locale, t(locale, '读取登录待办'))}
        </NoticeBlock>
      )}

      {!runtime && status && (
        <Section title={t(locale, '运行中的连接')}>
          {runningIds.length === 0
            ? <p className="console-form-field-hint">{t(locale, '还没有运行中的连接。')}</p>
            : (
              <Grid>
                {runningIds.map((id) => {
                  const endpoint = endpointById.get(id);
                  const mode = runningModes.get(id);
                  return (
                    <RecordCard
                      key={id}
                      title={<ContentStack direction="row" gap="tight" align="center">
                        <ToneBadge tone={connectionTone(endpoint, connectionsKnown)}>{connectionLabel(endpoint, locale, connectionsKnown)}</ToneBadge>
                        <strong>{id}</strong>
                        {endpoint?.pendingLogin && <ToneBadge tone="warning">{t(locale, '等待登录')}</ToneBadge>}
                      </ContentStack>}
                      fields={mode ? [{ key: 'mode', label: t(locale, '模式'), value: mode }] : []}
                      actions={<Button type="button" variant="outline" size="sm" aria-busy={isBusy(`test:${id}`) || undefined} disabled={isBusy(`test:${id}`)} onClick={() => testConnection(id)}>{t(locale, '测试连接')}</Button>}
                    />
                  );
                })}
              </Grid>
            )}
        </Section>
      )}

      {loginTasks}
      {qqWorkbench}
      {accountsSection}

      {!runtime && status && (
        <Section id="adapter-accounts" title={t(locale, '已配置的账号')} description={t(locale, '当前环境只能查看账号配置。')}>
          {!status.configured.length
            ? <p className="console-form-field-hint">{runningIds.length > 0 ? t(locale, '此适配器没有提供账号清单；运行中的连接见上方。') : t(locale, '配置里还没有账号。')}</p>
            : (
              <Grid>
                {status.configured.map((entry) => {
                  const running = runningIds.includes(entry.id);
                  return (
                    <RecordCard
                      key={entry.id}
                      title={<ContentStack direction="row" gap="tight" align="center"><strong>{entry.id}</strong><ToneBadge tone={running ? 'success' : 'neutral'}>{running ? t(locale, '运行中') : t(locale, '未运行')}</ToneBadge></ContentStack>}
                      fields={Object.entries(entry.values).map(([key, value]) => ({ key, label: key, value }))}
                    />
                  );
                })}
              </Grid>
            )}
        </Section>
      )}

      {addForm}
      {platformActions}
      {sidebarExtraEntries.length > 0 && (
        <Section title={t(locale, '平台状态')}>
          <KeyValueList
            items={sidebarExtraEntries.map(([key, value]) => ({
              key,
              label: key,
              value: typeof value === 'string' && isLink(value) ? <a className="console-touch" href={value} target="_blank" rel="noreferrer">{value}</a> : typeof value === 'boolean' ? t(locale, value ? '已开启' : '已关闭') : String(value),
            }))}
          />
        </Section>
      )}
      <p className="console-form-field-hint">{t(locale, '此页面由适配器提供；敏感凭据不会展示。')}</p>
    </RendererPage>
  );
}

/** The account editor (edit or replace one account) of a model with an open editor. */
function renderAccountEditor(m: AdapterConsoleModel) {
  const {
    editor, runtime, locale, title, mutating, migration, platformProfile, status, effectiveAdapterKey, setEditor, editorReplacing,
    formError, runtimeBlocked, collectEdit, saveEdit, isBusy, closeEdit,
  } = m;
  if (!editor || !runtime) return null;
  const stale = editor.generation !== runtime.generation || editor.revision !== runtime.revision;
  const fields = status?.fields.filter(field => field.key !== 'id' && (runtime.mutableFields.includes(field.key) || runtime.identityFields.includes(field.key) || editorReplacing)) ?? [];
  const saveBusy = isBusy('mutate:update:' + editor.instanceId);
  return (
    <Section
      role="region"
      aria-label={t(locale, '编辑账号')}
      title={`${t(locale, '编辑账号')} · ${editor.originalId}`}
      actions={<>
        <ToneBadge tone="neutral">{title}</ToneBadge>
        <Button type="button" variant="ghost" size="sm" onClick={closeEdit}>← {t(locale, '账号列表')}</Button>
      </>}
    >
      <Grid min="24rem">
        <Card>
          <CardContent>
            <ContentStack>
              {stale && <NoticeBlock tone="danger">{t(locale, '账号清单已变化，请取消编辑后重新打开。')}</NoticeBlock>}
              <FormField label={t(locale, '账号 ID')} hint={platformProfile?.idLabel} htmlFor="adapter-edit-id">
                <Input id="adapter-edit-id" disabled={mutating || !!migration || !runtime.canReplace || !runtime.identityFields.includes('id')} value={editor.id} onChange={event => setEditor({ ...editor, id: event.target.value })} />
              </FormField>
              <Grid min="14rem">
                {fields.map(field => renderAccountField({
                  field, locale, adapterKey: effectiveAdapterKey, allowDefault: !Object.hasOwn(editor.originalValues, field.key), disabled: mutating || !!migration,
                  value: editor.values[field.key] ?? '', onValueChange: value => setEditor({ ...editor, values: { ...editor.values, [field.key]: value } }),
                }))}
              </Grid>
              {formError && <NoticeBlock tone="danger">{formError}</NoticeBlock>}
              <ContentStack direction="row" gap="tight">
                {editorReplacing
                  ? (
                    <ActionButton
                      label={t(locale, '保存')}
                      fallbackVariant="default"
                      locale={locale}
                      confirm={t(locale, '替换账号「{0}」？旧账号将关闭，历史保留；新账号不继承会话和设置，保存后需手动启动。', editor.originalId)}
                      confirmLabel={t(locale, '替换账号')}
                      disabled={runtimeBlocked || !!migration || mutating || stale}
                      beforeConfirm={() => collectEdit() !== undefined}
                      onRun={saveEdit}
                    />
                  )
                  : <Button type="button" variant="default" size="sm" aria-busy={saveBusy || undefined} disabled={runtimeBlocked || !!migration || (mutating && !saveBusy) || stale} onClick={saveEdit}>{t(locale, '保存')}</Button>}
                <Button type="button" variant="ghost" size="sm" onClick={closeEdit}>{t(locale, '取消')}</Button>
              </ContentStack>
            </ContentStack>
          </CardContent>
        </Card>
        {renderOnboardingGuide(m)}
      </Grid>
    </Section>
  );
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
