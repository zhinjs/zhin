/**
 * `attention.list` (Console 「需要你处理」): gathers what waits for an operator from existing runtime
 * state and filters it by what the caller may view.
 *
 * | kind | source | needs |
 * |---|---|---|
 * | `login.pending` | LoginAssist pending tasks | `endpoint.view` on that account |
 * | `endpoint.offline` | Endpoint registry (offline, not stopped, no login task) | `endpoint.view` on that account |
 * | `endpoint.config-drift` | `zhin.config.yml` `endpoints` vs persisted accounts (#1250) | `endpoint.view` on that adapter instance |
 * | `plugin.error` / `plugin.dependencies` / `plugin.config` | plugin management `inspect` of declared plugins | `feature.view` |
 * | `config.invalid` / `config.apply-failed` / `config.literal-secrets` | configuration store | `ops.config.read` |
 * | `tool-approval.pending` | the Agent Root's tool approval queue | `tool_approvals:read` or `ops:approve` |
 * | `mcp.disconnected` | Agent MCP servers (configured + connected) | `status.view` |
 * | `logs.errors` | SystemLog error rows | `status.view` |
 *
 * Text is localized for the request's `locale` (task catalog pattern); dynamic Host text (issues,
 * error messages, ids) is inserted verbatim. `since` is the source's own start time when it has
 * one (login task, approval card, latest error), otherwise when this Host first observed it.
 */
import {
  ATTENTION_RPC,
  CONSOLE_PERMISSIONS,
  attentionItemId,
  attentionRevision,
  compareAttentionItems,
  isConsoleAttentionRpcType,
  type ConsoleAttentionItem,
  type ConsoleAttentionKind,
  type ConsoleAttentionList,
  type ConsoleAttentionSeverity,
  type ConsoleAttentionSubject,
  type ConsoleConfigSource,
  type ConsoleScopeTarget,
} from '@zhin.js/console-protocol';
import { createMessages, resolveLocale, type Locale } from '@zhin.js/plugin-runtime';

// ---------------------------------------------------------------- sources

export interface AttentionLoginTask {
  readonly id: string;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly type: string;
  readonly createdAt: number;
}

export interface AttentionEndpoint {
  /** Adapter instance alias (Console scope segment). */
  readonly adapter: string;
  /** Account name (Console scope segment). */
  readonly name: string;
  readonly connected: boolean;
  readonly phase: string;
  readonly transportState: string;
  /** Classified, redacted reason of the last failed start (#1250). */
  readonly lastError?: Readonly<{ category: string; message: string }>;
}

/** One adapter instance whose configuration file accounts differ from the persisted ones (#1250). */
export interface AttentionEndpointDrift {
  /** Plugin instance key (Console adapter scope segment and the configuration block name). */
  readonly instanceKey: string;
  /** Adapter local name. */
  readonly adapter: string;
  /** Account ids only in the configuration file (not running). */
  readonly configOnly: readonly string[];
  /** Account ids saved (and possibly running) but no longer in the configuration file. */
  readonly savedOnly: readonly string[];
  /** Account ids in both with different configuration. */
  readonly changed: readonly string[];
}

export interface AttentionPluginState {
  readonly instanceKey: string;
  readonly status: string;
  readonly dependencies: string;
  readonly disabled: boolean;
  readonly issues: readonly string[];
  readonly validation: null | {
    readonly valid: boolean;
    readonly errors: readonly { readonly path: string; readonly message: string }[];
    readonly missingEnv: readonly string[];
  };
}

export interface AttentionConfiguration {
  /** `readSource()`; throws when the file cannot be read or parsed. */
  readonly source: () => Promise<Pick<ConsoleConfigSource, 'application' | 'applicationError'>>;
  readonly literalSecrets?: () => Promise<readonly { readonly path: readonly string[] }[]>;
}

export interface AttentionToolApproval {
  readonly id: string;
  readonly toolName: string;
  readonly sessionKey: string;
  readonly createdAt: number;
}

export interface AttentionMcpServer {
  readonly name: string;
  readonly connected: boolean;
}

export interface AttentionErrorLogs {
  readonly count: number;
  /** ISO time of the newest error row. */
  readonly latest: string | null;
}

/** Every source is optional and only read when the caller may view something it reports. */
export interface AttentionSources {
  readonly loginTasks?: () => readonly AttentionLoginTask[];
  readonly endpoints?: () => readonly AttentionEndpoint[] | Promise<readonly AttentionEndpoint[]>;
  readonly endpointConfigDrift?: () => Promise<readonly AttentionEndpointDrift[]>;
  /** Declared plugins' management state; a rejected entry marks the source incomplete. */
  readonly plugins?: () => Promise<readonly PromiseSettledResult<AttentionPluginState>[]>;
  readonly configuration?: AttentionConfiguration;
  /** `undefined` when the Agent (and its queue) is not running. */
  readonly toolApprovals?: () => readonly AttentionToolApproval[] | undefined;
  readonly mcpServers?: () => readonly AttentionMcpServer[];
  /** `null` when the log store is not available. */
  readonly errorLogs?: () => Promise<AttentionErrorLogs | null>;
}

/** Whether the caller holds `permission` (at `target`; default: global). */
export type AttentionAllows = (permission: string, target?: ConsoleScopeTarget) => boolean;

/** Source names, as reported in `unavailable`. */
export type AttentionSourceName = 'login-assist' | 'endpoints' | 'endpoint-config' | 'plugins' | 'config' | 'tool-approvals' | 'mcp' | 'logs';

// ---------------------------------------------------------------- first observation

/**
 * When the Host first saw each item (for sources without their own start time). An entry is
 * dropped once a read of its source no longer reports it, so a problem that comes back starts anew.
 */
export class AttentionObservations {
  readonly #seen = new Map<string, { readonly source: AttentionSourceName; readonly at: number }>();

  /** First observation of `id`, recording `now` when it is new. */
  since(id: string, source: AttentionSourceName, now: number): number {
    const entry = this.#seen.get(id);
    if (entry) return entry.at;
    this.#seen.set(id, { source, at: now });
    return now;
  }

  /** Forgets items of `source` that its latest read did not report. */
  settle(source: AttentionSourceName, present: ReadonlySet<string>): void {
    for (const [id, entry] of this.#seen) if (entry.source === source && !present.has(id)) this.#seen.delete(id);
  }

  get size(): number { return this.#seen.size; }
}

// ---------------------------------------------------------------- text

const messages = createMessages({
  'login.title': { 'zh-CN': '{account} 等待登录', en: '{account} is waiting to sign in' },
  'login.detail': { 'zh-CN': '需要完成{step}才能上线，超时后登录会被取消。', en: 'Complete the {step} step to bring it online; the sign-in is cancelled if it times out.' },
  'login.action': { 'zh-CN': '去处理登录', en: 'Open sign-in' },
  'login.step.qrcode': { 'zh-CN': '扫码', en: 'QR code' },
  'login.step.sms': { 'zh-CN': '短信验证', en: 'SMS code' },
  'login.step.slider': { 'zh-CN': '滑块验证', en: 'slider' },
  'login.step.device': { 'zh-CN': '设备验证', en: 'device verification' },
  'login.step.auth': { 'zh-CN': '授权', en: 'authorization' },
  'login.step.other': { 'zh-CN': '登录步骤', en: 'sign-in' },
  'endpoint.title': { 'zh-CN': '{account} 离线', en: '{account} is offline' },
  'endpoint.detail': { 'zh-CN': '连接状态：{state}。检查凭据、网络和适配器日志，或在「接入」里测试连接。', en: 'Connection: {state}. Check credentials, network and adapter logs, or test the connection under Connection.' },
  'endpoint.action': { 'zh-CN': '查看接入', en: 'Open connection' },
  'endpoint.reason': { 'zh-CN': '最近一次启动失败（{category}）：{message}', en: 'Last start failed ({category}): {message}' },
  'drift.title': { 'zh-CN': '{adapter} 的配置文件账号与已保存账号不一致', en: 'Accounts of {adapter} in the configuration file differ from the saved ones' },
  'drift.configOnly': { 'zh-CN': '仅在配置文件（未运行）：{ids}', en: 'Only in the configuration file (not running): {ids}' },
  'drift.savedOnly': { 'zh-CN': '已不在配置文件（仍按已保存账号运行）：{ids}', en: 'No longer in the configuration file (still run as saved): {ids}' },
  'drift.changed': { 'zh-CN': '配置不同：{ids}', en: 'Configured differently: {ids}' },
  'drift.detail': { 'zh-CN': '{parts}。配置文件里的 endpoints 只在首次启动时导入；之后以已保存账号为准。请在账号页「从配置导入」或「写回配置文件」。', en: '{parts}. The endpoints list is only imported on first start; the saved accounts win afterwards. Import from the configuration or write back on the accounts page.' },
  'drift.action': { 'zh-CN': '处理账号差异', en: 'Review accounts' },
  'plugin.error.title': { 'zh-CN': '插件 {plugin} 运行异常', en: 'Plugin {plugin} has a problem' },
  'plugin.dependencies.title': { 'zh-CN': '插件 {plugin} 的依赖未满足', en: 'Dependencies of plugin {plugin} are not met' },
  'plugin.config.title': { 'zh-CN': '插件 {plugin} 的配置需要修正', en: 'Configuration of plugin {plugin} needs fixing' },
  'plugin.missingEnv': { 'zh-CN': '未设置的环境变量：{names}', en: 'Unset environment variables: {names}' },
  'plugin.action': { 'zh-CN': '查看插件', en: 'Open plugin' },
  'config.invalid.title': { 'zh-CN': '配置文件无法读取', en: 'The configuration file cannot be read' },
  'config.apply.title': { 'zh-CN': '最近一次配置改动没有生效', en: 'The last configuration change did not take effect' },
  'config.apply.detail': { 'zh-CN': '应用结果：{status}。打开配置文件核对后重新应用。', en: 'Result: {status}. Review the configuration and apply it again.' },
  'config.apply.failed': { 'zh-CN': '失败', en: 'failed' },
  'config.apply.blocked': { 'zh-CN': '被阻止', en: 'blocked' },
  'config.apply.unconfirmed': { 'zh-CN': '未确认', en: 'unconfirmed' },
  'config.apply.invalid': { 'zh-CN': '无效', en: 'invalid' },
  'config.secrets.title': { 'zh-CN': '配置文件中有 {count} 个明文密钥', en: 'Secrets stored as plain text in the configuration: {count}' },
  'config.secrets.detail': { 'zh-CN': '{paths}。运行 zhin doctor --fix 把它们移到 .env 并改为 ${…} 引用。', en: '{paths}. Run zhin doctor --fix to move them to .env as ${…} references.' },
  'config.action': { 'zh-CN': '打开配置文件', en: 'Open configuration' },
  'approval.title': { 'zh-CN': '工具 {tool} 等待审批', en: 'Tool {tool} is waiting for approval' },
  'approval.detail': { 'zh-CN': '来自会话 {session}；超时无人处理会被拒绝。', en: 'Requested in session {session}; it is denied if nobody decides in time.' },
  'approval.action': { 'zh-CN': '去审批', en: 'Review' },
  'mcp.title': { 'zh-CN': 'MCP 服务 {server} 未连接', en: 'MCP server {server} is not connected' },
  'mcp.detail': { 'zh-CN': 'Agent 暂时无法调用它提供的工具。', en: 'The Agent cannot use its tools for now.' },
  'mcp.action': { 'zh-CN': '查看 MCP', en: 'Open MCP' },
  'logs.title': { 'zh-CN': '日志里有 {count} 条错误', en: 'Errors in the logs: {count}' },
  'logs.detail': { 'zh-CN': '持久日志统计；清理日志后重新计数。', en: 'Persistent log count; it restarts after logs are cleaned up.' },
  'logs.action': { 'zh-CN': '打开错误日志', en: 'Open error logs' },
});

const LOGIN_STEPS = new Set(['qrcode', 'sms', 'slider', 'device', 'auth']);
const MAX_LISTED = 5;
const MAX_DETAIL = 500;

function clip(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

function listed(values: readonly string[], locale: Locale): string {
  const shown = values.slice(0, MAX_LISTED).join(locale === 'en' ? ', ' : '、');
  return values.length > MAX_LISTED ? `${shown} …(+${values.length - MAX_LISTED})` : shown;
}

const segment = (value: string) => encodeURIComponent(value);

/** Console deep links (console-routes.mjs). */
export const ATTENTION_PATHS = Object.freeze({
  endpointAccess: (adapter: string, endpoint: string) => `/scope/${segment(adapter)}/${segment(endpoint)}?tab=access`,
  adapterAccounts: (instanceKey: string) => `/plugins/${segment(instanceKey)}`,
  plugin: (instanceKey: string) => `/plugins/${segment(instanceKey)}`,
  config: '/ops/config',
  toolApprovals: '/ops/schedules?tab=admin',
  mcp: '/introspection?tab=mcp',
  errorLogs: '/logs?level=error',
});

// ---------------------------------------------------------------- collection

export interface CollectAttentionOptions {
  readonly locale?: unknown;
  readonly allows: AttentionAllows;
  readonly observations?: AttentionObservations;
  readonly now?: () => number;
  /** Plugin permission levels for `tool_approvals:read` / `ops:approve`. */
  readonly allowsPluginPermission?: (permission: string) => boolean;
}

const P = CONSOLE_PERMISSIONS;
const TOOL_APPROVAL_READ = ['tool_approvals:read', 'ops:approve'] as const;

const endpointTarget = (adapter: string, endpoint: string): ConsoleScopeTarget => Object.freeze({ kind: 'endpoint', adapter, endpoint });

/** Gathers, filters and sorts the attention items the caller may view. */
export async function collectAttention(sources: AttentionSources, options: CollectAttentionOptions): Promise<ConsoleAttentionList> {
  const locale = resolveLocale(options.locale);
  const t = (key: Parameters<typeof messages>[1], values?: Record<string, string | number>) => messages(locale, key, values);
  const now = options.now ?? Date.now;
  const at = now();
  const observations = options.observations ?? new AttentionObservations();
  const allows = options.allows;
  const items: ConsoleAttentionItem[] = [];
  const unavailable: AttentionSourceName[] = [];

  const item = (input: {
    kind: ConsoleAttentionKind;
    severity: ConsoleAttentionSeverity;
    subject?: ConsoleAttentionSubject;
    state: unknown;
    title: string;
    detail: string;
    action: { label: string; path: string };
    source: AttentionSourceName;
    since?: number;
  }, present: Set<string>): void => {
    const id = attentionItemId(input.kind, input.subject);
    present.add(id);
    const since = input.since ?? observations.since(id, input.source, at);
    items.push(Object.freeze({
      id,
      revision: attentionRevision(input.state),
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      detail: clip(input.detail),
      ...(input.subject ? { subject: Object.freeze({ ...input.subject }) } : {}),
      since: new Date(since).toISOString(),
      action: Object.freeze(input.action),
      source: input.source,
    }));
  };

  // A source is read only when the caller may view something it reports; its observations are
  // settled from the full (unfiltered) read so another viewer's filter never resets them.
  const read = async (name: AttentionSourceName, run: (present: Set<string>) => void | Promise<void>): Promise<void> => {
    const present = new Set<string>();
    try {
      await run(present);
      observations.settle(name, present);
    } catch {
      unavailable.push(name);
    }
  };

  const anyEndpointView = allows(P.ENDPOINT_VIEW, Object.freeze({ kind: 'any' }));
  const loginTasks: AttentionLoginTask[] = [];
  if (sources.loginTasks && anyEndpointView) {
    await read('login-assist', () => {
      loginTasks.push(...sources.loginTasks!());
      for (const task of loginTasks) {
        if (!allows(P.ENDPOINT_VIEW, endpointTarget(task.adapter, task.endpointKey))) continue;
        const account = `${task.adapter} / ${task.endpointKey}`;
        const step = LOGIN_STEPS.has(task.type) ? task.type as 'qrcode' : 'other';
        item({
          kind: 'login.pending',
          severity: 'danger',
          subject: { adapter: task.adapter, endpointKey: task.endpointKey, loginTaskId: task.id },
          state: { type: task.type },
          title: t('login.title', { account }),
          detail: t('login.detail', { step: t(`login.step.${step}`) }),
          action: { label: t('login.action'), path: ATTENTION_PATHS.endpointAccess(task.adapter, task.endpointKey) },
          source: 'login-assist',
          since: task.createdAt,
        }, new Set());
      }
    });
  }

  if (sources.endpoints && anyEndpointView) {
    const waiting = new Set(loginTasks.map(task => `${task.adapter}\u0000${task.endpointKey}`));
    await read('endpoints', async (present) => {
      for (const endpoint of await sources.endpoints!()) {
        // Offline for real: not connecting / reconnecting, not stopped on purpose, not waiting for a login step.
        if (endpoint.connected || endpoint.phase !== 'offline' || endpoint.transportState === 'stopped') continue;
        if (waiting.has(`${endpoint.adapter}\u0000${endpoint.name}`)) continue;
        const subject = { adapter: endpoint.adapter, endpointKey: endpoint.name };
        // Observed regardless of the caller; listed only when it may view this account.
        const id = attentionItemId('endpoint.offline', subject);
        present.add(id);
        observations.since(id, 'endpoints', at);
        if (!allows(P.ENDPOINT_VIEW, endpointTarget(endpoint.adapter, endpoint.name))) continue;
        item({
          kind: 'endpoint.offline',
          severity: 'warning',
          subject,
          state: { transportState: endpoint.transportState },
          title: t('endpoint.title', { account: `${endpoint.adapter} / ${endpoint.name}` }),
          detail: endpoint.lastError
            ? `${t('endpoint.detail', { state: endpoint.transportState })} ${t('endpoint.reason', endpoint.lastError)}`
            : t('endpoint.detail', { state: endpoint.transportState }),
          action: { label: t('endpoint.action'), path: ATTENTION_PATHS.endpointAccess(endpoint.adapter, endpoint.name) },
          source: 'endpoints',
        }, present);
      }
    });
  }

  if (sources.endpointConfigDrift && anyEndpointView) {
    await read('endpoint-config', async (present) => {
      for (const drift of await sources.endpointConfigDrift!()) {
        const subject = { adapter: drift.instanceKey, plugin: drift.instanceKey };
        const id = attentionItemId('endpoint.config-drift', subject);
        present.add(id);
        observations.since(id, 'endpoint-config', at);
        if (!allows(P.ENDPOINT_VIEW, Object.freeze({ kind: 'adapter', adapter: drift.instanceKey }))) continue;
        const parts = [
          ...(drift.configOnly.length ? [t('drift.configOnly', { ids: listed(drift.configOnly, locale) })] : []),
          ...(drift.savedOnly.length ? [t('drift.savedOnly', { ids: listed(drift.savedOnly, locale) })] : []),
          ...(drift.changed.length ? [t('drift.changed', { ids: listed(drift.changed, locale) })] : []),
        ];
        item({
          kind: 'endpoint.config-drift',
          severity: 'warning',
          subject,
          state: { configOnly: drift.configOnly, savedOnly: drift.savedOnly, changed: drift.changed },
          title: t('drift.title', { adapter: drift.instanceKey }),
          detail: t('drift.detail', { parts: parts.join(locale === 'en' ? '; ' : '；') }),
          action: { label: t('drift.action'), path: ATTENTION_PATHS.adapterAccounts(drift.instanceKey) },
          source: 'endpoint-config',
        }, present);
      }
    });
  }

  if (sources.plugins && allows(P.FEATURE_VIEW)) {
    await read('plugins', async (present) => {
      let incomplete = false;
      for (const result of await sources.plugins!()) {
        if (result.status === 'rejected') { incomplete = true; continue; }
        const state = result.value;
        if (state.disabled) continue;
        const subject = { plugin: state.instanceKey };
        const action = { label: t('plugin.action'), path: ATTENTION_PATHS.plugin(state.instanceKey) };
        const issues = state.issues.join('; ');
        if (state.dependencies === 'failed') {
          item({ kind: 'plugin.dependencies', severity: 'danger', subject, state: { issues: state.issues },
            title: t('plugin.dependencies.title', { plugin: state.instanceKey }), detail: issues, action, source: 'plugins' }, present);
        } else if (state.status === 'degraded') {
          item({ kind: 'plugin.error', severity: 'danger', subject, state: { issues: state.issues },
            title: t('plugin.error.title', { plugin: state.instanceKey }), detail: issues, action, source: 'plugins' }, present);
        }
        const validation = state.validation;
        if (validation && (!validation.valid || validation.missingEnv.length > 0)) {
          const parts = [
            ...validation.errors.slice(0, MAX_LISTED).map(error => error.path ? `${error.path}: ${error.message}` : error.message),
            ...(validation.missingEnv.length ? [t('plugin.missingEnv', { names: listed(validation.missingEnv, locale) })] : []),
          ];
          item({ kind: 'plugin.config', severity: 'warning', subject,
            state: { errors: validation.errors, missingEnv: validation.missingEnv },
            title: t('plugin.config.title', { plugin: state.instanceKey }), detail: parts.join('; '), action, source: 'plugins' }, present);
        }
      }
      if (incomplete) throw new Error('incomplete');
    });
  }

  if (sources.configuration && allows(P.OPS_CONFIG_READ)) {
    const configuration = sources.configuration;
    const action = { label: t('config.action'), path: ATTENTION_PATHS.config };
    await read('config', async (present) => {
      let source: Awaited<ReturnType<AttentionConfiguration['source']>> | undefined;
      try {
        source = await configuration.source();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        item({ kind: 'config.invalid', severity: 'danger', state: { message }, title: t('config.invalid.title'),
          detail: message, action, source: 'config' }, present);
      }
      if (source) {
        const groups = source.application?.groups ?? [];
        const status = source.applicationError
          ?? (groups.some(group => group.status === 'failed') ? 'failed' : groups.some(group => group.status === 'blocked') ? 'blocked' : undefined);
        if (status && status !== 'superseded') {
          item({ kind: 'config.apply-failed', severity: 'warning', state: { status, operation: source.application?.operationId ?? null },
            title: t('config.apply.title'), detail: t('config.apply.detail', { status: t(`config.apply.${status}`) }), action, source: 'config' }, present);
        }
        const secrets = configuration.literalSecrets ? await configuration.literalSecrets() : [];
        if (secrets.length) {
          const paths = secrets.map(secret => formatPath(secret.path));
          item({ kind: 'config.literal-secrets', severity: 'warning', state: { paths },
            title: t('config.secrets.title', { count: secrets.length }), detail: t('config.secrets.detail', { paths: listed(paths, locale) }),
            action, source: 'config' }, present);
        }
      }
    });
  }

  const approvalsAllowed = options.allowsPluginPermission
    ? TOOL_APPROVAL_READ.some(permission => options.allowsPluginPermission!(permission))
    : TOOL_APPROVAL_READ.some(permission => allows(permission));
  if (sources.toolApprovals && approvalsAllowed) {
    await read('tool-approvals', (present) => {
      for (const card of sources.toolApprovals!() ?? []) {
        item({ kind: 'tool-approval.pending', severity: 'warning', subject: { approvalId: card.id }, state: { id: card.id },
          title: t('approval.title', { tool: card.toolName }), detail: t('approval.detail', { session: card.sessionKey }),
          action: { label: t('approval.action'), path: ATTENTION_PATHS.toolApprovals }, source: 'tool-approvals', since: card.createdAt }, present);
      }
    });
  }

  if (sources.mcpServers && allows(P.STATUS_VIEW)) {
    await read('mcp', (present) => {
      for (const server of sources.mcpServers!()) {
        if (server.connected) continue;
        item({ kind: 'mcp.disconnected', severity: 'warning', subject: { mcpServer: server.name }, state: { connected: false },
          title: t('mcp.title', { server: server.name }), detail: t('mcp.detail'),
          action: { label: t('mcp.action'), path: ATTENTION_PATHS.mcp }, source: 'mcp' }, present);
      }
    });
  }

  if (sources.errorLogs && allows(P.STATUS_VIEW)) {
    await read('logs', async (present) => {
      const logs = await sources.errorLogs!();
      if (logs === null) throw new Error('log store unavailable');
      if (logs.count <= 0) return;
      const latest = logs.latest ? Date.parse(logs.latest) : Number.NaN;
      item({ kind: 'logs.errors', severity: 'info', state: { count: logs.count, latest: logs.latest },
        title: t('logs.title', { count: logs.count }), detail: t('logs.detail'),
        action: { label: t('logs.action'), path: ATTENTION_PATHS.errorLogs }, source: 'logs',
        ...(Number.isNaN(latest) ? {} : { since: latest }) }, present);
    });
  }

  items.sort(compareAttentionItems);
  return Object.freeze({
    items: Object.freeze(items),
    generatedAt: new Date(at).toISOString(),
    ...(unavailable.length ? { unavailable: Object.freeze([...unavailable]) } : {}),
  });
}

function formatPath(path: readonly string[]): string {
  return path.map((part, index) => /^(?:0|[1-9][0-9]*)$/u.test(part) ? `[${part}]` : `${index === 0 ? '' : '.'}${part}`).join('');
}

// ---------------------------------------------------------------- RPC

export interface AttentionRpcContext {
  readonly sources: AttentionSources;
  readonly allows: AttentionAllows;
  readonly allowsPluginPermission?: (permission: string) => boolean;
  readonly observations?: AttentionObservations;
  readonly now?: () => number;
}

export interface AttentionRpcReply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Answers `attention.list`; null means the type belongs elsewhere. The route already checked `status.view`. */
export async function dispatchAttentionConsoleRpc(message: Record<string, unknown>, context: AttentionRpcContext): Promise<AttentionRpcReply | null> {
  const type = message.type;
  if (!isConsoleAttentionRpcType(type)) return null;
  const input = message.data && typeof message.data === 'object' && !Array.isArray(message.data)
    ? message.data as Record<string, unknown> : message;
  const data = await collectAttention(context.sources, {
    locale: input.locale,
    allows: context.allows,
    ...(context.allowsPluginPermission ? { allowsPluginPermission: context.allowsPluginPermission } : {}),
    ...(context.observations ? { observations: context.observations } : {}),
    ...(context.now ? { now: context.now } : {}),
  });
  return { status: 200, body: { success: true, data, type: ATTENTION_RPC.LIST, requestId: message.requestId } };
}
