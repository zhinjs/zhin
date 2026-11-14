import { resolveHostCredentialSource, type CapabilityId } from '@zhin.js/plugin-runtime';
import { createConfigurationChatAuthorizer, createSenderEnricher } from '@zhin.js/core/runtime';
import { chatRoleMigrationAdapterKinds, prepareChatRoleMigration } from './chat-role-migration.js';
import { prepareFeatureOverrideMigration } from './feature-override-migration.js';
import { migrateConversationColumns, migrateInboxColumns } from '@zhin.js/core/runtime';
import type { StructuredDatabase } from '@zhin.js/database';
import { assertNoPendingInstanceMigration } from '@zhin.js/gateway/project';
import { assertNotLegacyConfig } from '@zhin.js/gateway/project';
import { access, readFile } from 'node:fs/promises';
import { PluginManagementActivity } from '@zhin.js/gateway/plugin-management';
import { join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import open from 'open';
import { adapterFeatureId, isAdapterIndex, endpointConfigSourceToken, endpointDesiredRepositoryToken, endpointSecretResolverToken, resolveStaticCapabilities } from '@zhin.js/adapter';
import { ImRuntime, type Message } from '@zhin.js/core/runtime';
import {
  CONVERSATION_CURSOR_MODEL,
  CONVERSATION_EVENT_MODEL,
  DatabaseConversationEventStore,
  type ConversationDbModel,
} from '@zhin.js/im-contract';
import { createConsoleEventHub, type HttpHost, type HttpHostAddress, type HttpHostOptions } from '@zhin.js/host-http';
import {
  defineInboxTables,
  DEFAULT_ROOT_CONFIG_FILE_NAME,
  readPluginConfigurationMap,
  rootPluginId,
  ROOT_CONFIG_FILE_NAMES,
  selectRootConfigFile,
  type ConfigDocumentPort,
  type RuntimeConfigDocument,
  type RuntimeSnapshot,
  type GenerationAdmissionBindable,
} from '@zhin.js/plugin-runtime';
import { setLevel, getLogger, formatCompact, type LogLevelInput } from '@zhin.js/logger';
import {
  ConfigValidationError,
  createConfigDocument,
  createEnvStore,
  envStoreToken,
  type ConfigFileDocument,
  type RootResourceInstaller,
  ensureTypeScriptSpecifierRemap,
  expandEnvironmentValue,
  findLiteralConfigSecrets,
  formatLiteralConfigSecretWarning,
  HOST_CONFIG_SCHEMA,
  snapshotConfigSecretSchemas,
} from '@zhin.js/runtime';
import {
  createConsoleHostModules,
  ConsoleConfigurationStore,
  installConsoleApiResources,
  installConsoleRuntime,
  registerConsoleHttp,
  startConsoleControlPlane,
  SystemLogStore,
  resolveSystemLogConfig,
  AssistantStatus,
  createHostToolApprovalConsoleRpc,
  HostSelfChanges,
  composeHostConsoleRpc,
  defineWorkspaceConversationTable,
  installConsoleIam,
  installHostConsoleTerminal,
} from './console/module.js';
import { installHttpHost, resolveHttpConfig } from '@zhin.js/host-http';
import { createDatabaseHost, installDatabaseHost, resolveDatabaseConfig } from '@zhin.js/core/runtime';
import { installLocaleHost } from '@zhin.js/core/runtime';
import { installConfigurationHost } from './configuration-host-installer.js';
import { createFeatureHost } from './feature-host-installer.js';
import { setProjectPluginEnabled } from '@zhin.js/runtime';
import {
  createRestartChatAuthorizer,
  deliverPendingRestartReceipt,
  installRestartHost,
} from './restart-host-installer.js';
import { installHtmlRendererHost, prepareHtmlRendererHost } from './html-renderer-host-installer.js';
import { installComponentHost } from '@zhin.js/core/runtime';
import { installOutboundHost } from '@zhin.js/core/runtime';
import { installScheduleHost, createScheduleHost } from './schedule-host-installer.js';
import { installSpeechHost, prepareSpeechHost, resolveSpeechConfig } from './speech-host-installer.js';
import { installProtocolHosts } from './protocol-host-installer.js';
import { RootHost } from './root-host.js';
import { PersistentEndpointRepository } from './runtime-endpoints/state.js';
import { createEndpointConfigSource, createEndpointSecretResolver } from './runtime-endpoints/config-source.js';
import { HostSelfChangeApply } from './self-change-apply.js';
import { registerReadinessRoutes, type ReadinessSource } from '@zhin.js/runtime';
import {
  createPluginLifecycleStore,
  readProjectPluginLifecycleState,
  resolvePluginLifecycleFile,
} from '@zhin.js/runtime';
import { DEFAULT_SHUTDOWN_BUDGET_MS, installProcessLifecycle, nodeProcessLifecycleAdapter } from './process-lifecycle.js';
import { installProcessRejectionHandler } from './process-rejections.js';
import { createBridgedHttpHost, openInstanceControlChannel, type BridgedHttpHost } from '@zhin.js/host-http/bridge';
import {
  ProjectEnvironmentFileSource,
  parseStartOptions,
} from './start/module.js';

export {
  loadRuntimeEnvironmentLayers,
  parseStartOptions,
  type StartOptions,
} from './start/module.js';

const REMOTE_CONSOLE_URL = 'https://console.zhin.dev';

export interface StartCommandOptions {
  readonly root: string;
  readonly args: readonly string[];
  /** Trusted process composition only; never sourced from project config. */
  readonly installTrustedResources?: RootResourceInstaller;
  writeOutput(value: string): void;
  writeError(value: string): void;
  /**
   * Ends the process after a gateway-requested stop (default `process.exit`). Only the
   * supervised paths (gateway `shutdown` / disconnect) exit; an embedded or test caller
   * keeps its process.
   */
  readonly exit?: (code: number) => void;
  /**
   * Development / test only (also `--standalone`): without a gateway control channel, serve HTTP
   * from an in-process Node server (`@zhin.js/host-http/node`, loaded on demand). Without it the
   * instance refuses to start unsupervised (ADR 0054 §3). Ignored under the gateway, which owns
   * the only HTTP server: the instance then serves its routes through `BridgedHttpHost`.
   */
  readonly standaloneHttp?: boolean;
}

/** Thrown when `zhin.js/instance` starts without a gateway and without `standaloneHttp`. */
export class InstanceGatewayRequiredError extends Error {
  readonly code = 'ZHIN_INSTANCE_GATEWAY_REQUIRED';
  constructor() {
    super('zhin.js/instance 只能由网关拉起：请使用 zhin start 启动（开发 / 测试可加 --standalone 在本进程内自带 HTTP 服务器）');
    this.name = 'InstanceGatewayRequiredError';
  }
}

/** The instance's HTTP surface: bridged under the gateway, a Node listener group standalone. */
type InstanceHttpHost = HttpHost & GenerationAdmissionBindable<HttpHost> & {
  listen(): Promise<HttpHostAddress | undefined>;
  close(): Promise<void>;
};

/** Loads the Node transport only in standalone mode: the bridged instance never loads `node:http` / `ws`. */
async function createStandaloneHttpHost(listeners: readonly HttpHostOptions[]): Promise<InstanceHttpHost> {
  const { createHttpHostGroup } = await import('@zhin.js/host-http/node');
  return createHttpHostGroup(listeners);
}

/** Host config `console.terminal` (raw; validated by the terminal installer). */
function readConsoleTerminalConfig(config: unknown): unknown {
  if (!config || typeof config !== 'object') return undefined;
  const consoleBlock = (config as Record<string, unknown>).console;
  if (!consoleBlock || typeof consoleBlock !== 'object') return undefined;
  return (consoleBlock as Record<string, unknown>).terminal;
}

/** Host config `console.loginAssist` (ADR 0058); invalid values are ignored by LoginAssist. */
function readConsoleLoginAssistConfig(config: unknown): { captchaHelperUrl?: string } {
  const consoleBlock = config && typeof config === 'object' ? (config as Record<string, unknown>).console : undefined;
  const block = consoleBlock && typeof consoleBlock === 'object' ? (consoleBlock as Record<string, unknown>).loginAssist : undefined;
  const url = block && typeof block === 'object' ? (block as Record<string, unknown>).captchaHelperUrl : undefined;
  return typeof url === 'string' && url ? { captchaHelperUrl: url } : {};
}

function readableCapabilityId(value: string): string {
  return value.split('\0').join(':');
}

export async function runStartCommand(options: StartCommandOptions): Promise<void> {
  const disposeRejections = installProcessRejectionHandler(process, (reason) => {
    getLogger('runtime').error(formatCompact({
      event: 'unhandledRejection',
      error: reason instanceof Error ? `${reason.name}: ${reason.message}`
        : typeof reason === 'string' ? reason : 'Non-Error rejection',
    }));
  });
  try {
    await runProcessStartCommand(options);
  } finally {
    disposeRejections();
  }
}

async function runProcessStartCommand(options: StartCommandOptions): Promise<void> {
  await assertNoPendingInstanceMigration(options.root);
  // Fail before any I/O-heavy setup with the exact v1 → v2 migration steps.
  await assertNotLegacyConfig(options.root);
  const pluginManagementActivity = new PluginManagementActivity();
  const parsed = parseStartOptions(options.args);
  // Gateway control channel (ADR 0054 §3): present when the supervisor spawned this instance.
  const controlChannel = openInstanceControlChannel();
  if (!controlChannel && options.standaloneHttp !== true && !parsed.standalone) throw new InstanceGatewayRequiredError();
  const restartSupported = controlChannel !== undefined && !parsed.once;
  ensureTypeScriptSpecifierRemap();
  const packageManifest = JSON.parse(await readFile(join(options.root, 'package.json'), 'utf8'));
  if (Array.isArray(packageManifest.zhin?.plugins) && packageManifest.zhin.plugins.length) throw new Error('Legacy package.json zhin.plugins detected; run zhin migrate instances');
  const environmentSource = new ProjectEnvironmentFileSource(options.root, parsed.environment);
  const environmentVariables = await environmentSource.read();
  const { config, file: configFile } = await loadProjectConfig(options.root);
  const runtimeEnvironment = Object.freeze({
    name: parsed.environment,
    mode: parsed.mode,
    platform: 'node',
  } as const);
  const hostEnvironment = createEnvStore(rootPluginId(), runtimeEnvironment, environmentVariables);
  // ADR 0056 §3: people lists move out of the configuration into chat_roles (first start), or stop startup.
  const chatRoleMigration = await prepareChatRoleMigration({
    projectRoot: options.root, config, logger: getLogger('chat-roles'),
    expand: document => hostEnvironment.expandMissingAsEmpty(document) as Readonly<Record<string, unknown>>,
  });
  // ADR 0057 §2: per adapter / account feature overrides move out of the configuration file into
  // feature_overrides (imported once the database is loaded, removed from the file after start),
  // or stop startup once that migration is done.
  const featureOverrideMigration = await prepareFeatureOverrideMigration({
    projectRoot: options.root, config, configFile, logger: getLogger('feature'),
  });
  const rawConfigDocument = (await config.read()).document;
  warnUnsetConfigEnvPlaceholders(rawConfigDocument, name => hostEnvironment.get(name), configFile);
  const hostConfig = hostEnvironment.expandMissingAsEmpty(rawConfigDocument);
  const pluginLifecycleFile = resolvePluginLifecycleFile(options.root);
  await readProjectPluginLifecycleState(options.root, pluginLifecycleFile);
  const pluginLifecycleStore = createPluginLifecycleStore(options.root);
  await applyRuntimeLogLevel(hostConfig);
  const envOverlay = environmentVariables.environments?.[parsed.environment];
  const httpConfig = await resolveHttpConfig(hostConfig, envOverlay, options.root);
  const {listeners: additionalHttpListeners = [], ...primaryHttpListener} = httpConfig;
  // ADR 0054 §2: under the gateway, routes are served over the control channel (additional
  // listeners are opened by the gateway); standalone (dev / test) runs the Node server here.
  const bridgedHttpHost: BridgedHttpHost | undefined = controlChannel
    ? createBridgedHttpHost({
      channel: controlChannel,
      // No `http.token` here: the gateway decides bootstrap and forwards the principal.
      corsOrigins: primaryHttpListener.corsOrigins,
      apiBase: primaryHttpListener.apiBase,
      authExemptPaths: primaryHttpListener.authExemptPaths,
    })
    : undefined;
  const httpHost: InstanceHttpHost = bridgedHttpHost
    ?? await createStandaloneHttpHost([primaryHttpListener, ...additionalHttpListeners]);
  const databaseConfig = await resolveDatabaseConfig(options.root, hostConfig);
  const databaseHost = createDatabaseHost(databaseConfig);
  // Agent is an optional install tier. Do not resolve its module from the
  // IM-only startup graph unless the project actually configures Agent state.
  const agentHost = await loadConfiguredAgentHost({ config: hostConfig, projectRoot: options.root, database: databaseHost,
    resolveSource: reference => resolveHostCredentialSource(reference, name => hostEnvironment.get(name)),
  });
  const speechHandle = await prepareSpeechHost(await resolveSpeechConfig(hostConfig));
  const htmlRendererHost = await prepareHtmlRendererHost(hostConfig);
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  const control: { stop(): Promise<void> } = {
    stop: async () => { throw new Error('RootHost stop is not bound'); },
  };
  // ADR 0055 / 0056: conversation-level feature overrides and chat roles (tables defined before start).
  const featureHost = createFeatureHost({
    database: databaseHost, hostConfig, snapshots: () => host.runtime.snapshots,
    afterLoad: async (roles, candidate, overrides) => {
      await chatRoleMigration.complete(roles, {
        persistent: ['sqlite', 'mysql', 'pg'].includes(databaseHost.dialect),
        adapterKind: chatRoleMigrationAdapterKinds(candidate),
      });
      await featureOverrideMigration.complete(overrides, candidate);
    },
  });
  const senderEnricher = createSenderEnricher({ roles: () => featureHost.roles });
  const im = new ImRuntime({ enrichSender: senderEnricher });
  im.loginAssist.configure({ captchaHelperUrl: readConsoleLoginAssistConfig(hostConfig).captchaHelperUrl });
  const endpointRepository = new PersistentEndpointRepository({ rootId: resolve(options.root),
    directory: join(options.root, '.zhin', 'endpoint-credentials'), state: () => databaseHost.state });
  const currentEnvironment = () => {
    const lease = host.runtime.snapshots.acquire();
    try {
      return lease.value.resources.get(lease.value.root)?.get(envStoreToken.id) as import('@zhin.js/runtime').EnvStore | undefined ?? hostEnvironment;
    } finally { lease.release(); }
  };
  const expandEnvironment = (value: string) => String(currentEnvironment().expandMissingAsEmpty(value));
  const endpointSecretResolver = createEndpointSecretResolver(expandEnvironment);
  const endpointConfigSource = createEndpointConfigSource({
    read: async () => {
      const { document, revision } = await config.read();
      return { document: document as Readonly<Record<string, unknown>>, revision };
    },
    snapshot: () => {
      const lease = host.runtime.snapshots.acquire();
      try { return lease.value; } finally { lease.release(); }
    },
    patch: request => consoleConfigurationStore.patchProject(request),
    expand: expandEnvironment,
    expandStrict: (value: string) => {
      try { return String(currentEnvironment().expand(value)); } catch { return undefined; }
    },
  });
  const isRelationalDialect = ['sqlite', 'mysql', 'pg'].includes(databaseHost.dialect);
  if (isRelationalDialect) {
    databaseHost.define('conversation_events', CONVERSATION_EVENT_MODEL);
    databaseHost.define('conversation_event_cursors', CONVERSATION_CURSOR_MODEL);
    // console endpoint-detail 收件箱三张表（unified_inbox_message/request/notice）；
    // 必须在 installResources（host.start）之前 define，写入订阅由 Console API 挂载。
    defineInboxTables(databaseHost);
    defineWorkspaceConversationTable(databaseHost);
  }
  let durableConversationEventStore: DatabaseConversationEventStore | undefined;
  // console logs 页数据源（SystemLog 表 + 根 logger transport）；
  // 表必须在 installResources（host.start）之前 define，写入在 host started 后才生效。
  const systemLogStore = new SystemLogStore(
    databaseHost,
    await resolveSystemLogConfig(hostConfig),
  );
  const scheduleHost = createScheduleHost();
  const consoleHost = createConsoleHostModules(options.root, !parsed.once && !parsed.noWatch);
  // Console SSE 事件枢纽：/api/events 订阅方 + HMR/消息/配置事件 publish 方共享。
  const consoleEventHub = createConsoleEventHub();
  // 群聊插话 / 技能助手 Console status (#970): process-owned, survives HMR generations.
  const assistantStatus = new AssistantStatus();
  // 受控自我进化审批（ADR 0040 §4）：进程持有，绑定当前 generation 的变更暂存区与审批。
  const selfChanges = new HostSelfChanges();
  const consoleConfigurationStore = new ConsoleConfigurationStore({
    projectRoot: options.root,
    document: config,
    validateConfiguration: document => host.runtime.validateConfiguration(document),
    applyConfiguration: revision => host.runtime.applyConfiguration(revision),
    readApplication: () => host.runtime.configurationApplication,
    environmentName: runtimeEnvironment.name,
    environmentForPlugin: instanceKey => {
      const lease = host.runtime.snapshots.acquire();
      try {
        const node = [...lease.value.tree.values()].find(item => item.parent === rootPluginId() && item.instanceKey === instanceKey);
        return node ? lease.value.resources.get(node.id)?.get(envStoreToken.id) as import('@zhin.js/runtime').EnvStore | undefined : undefined;
      } finally { lease.release(); }
    },
    configDeclarations: async () => {
      await host.runtime.whenConfigurationReady();
      return host.runtime.configurationSchemas;
    },
  });
  // Console access control (ADR 0049) and the terminal (ADR 0051) belong to the gateway, which
  // keeps the accounts in its own .zhin/gateway.db and authenticates every request (ADR 0054 §3 /
  // §7, ADR 0059); this instance only authorizes the forwarded principal and never opens that
  // file. A standalone (dev / test) instance has no gateway, so it opens gateway.db itself on a
  // connection of its own (never through the DatabaseHost) — no process isolation there.
  const consoleIam = bridgedHttpHost ? undefined : installConsoleIam(httpHost, {
    configStore: consoleConfigurationStore,
    projectRoot: options.root,
    projectDatabase: async () => databaseConfig,
    apiBase: httpConfig.apiBase,
    logger: getLogger('console'),
    requestRestart: () => { void requestProcessRestart('database'); },
  });
  const consoleTerminal = bridgedHttpHost ? undefined : installHostConsoleTerminal(httpHost, {
    config: readConsoleTerminalConfig(hostConfig),
    projectRoot: options.root,
    base: httpConfig.apiBase ?? '/api',
    iam: () => consoleIam?.service,
    logger: getLogger('console'),
  });
  const consoleIamService = () => consoleIam?.service;
  const currentSnapshot = () => {
    const lease = host.runtime.snapshots.acquire();
    try { return lease.value; } finally { lease.release(); }
  };
  const authorizeConfigurationChat = createConfigurationChatAuthorizer(() => featureHost.roles, currentSnapshot);
  const authorizeRestartChat = createRestartChatAuthorizer(() => featureHost.roles, currentSnapshot);
  // 受控自我进化生效（ADR 0040 §5 / §6）：进程持有热重载 / 受控重启 / 健康检查 / 配置补丁；最新 generation 绑定生效器。
  const selfChangeApply = new HostSelfChangeApply({
    projectRoot: options.root,
    reload: sources => host.reloadSources(sources),
    restart: () => requestProcessRestart('self-change'),
    snapshot: () => host.runtime.snapshot,
    ownership: () => host.runtime.sourceOwnership,
    configuration: consoleConfigurationStore,
    configFile,
    restartSupported,
  });
  const host = new RootHost({
    projectRoot: options.root,
    config,
    modules: consoleHost.modules,
    watch: parsed.once ? [] : parsed.watch,
    onGenerationCommit: (generation) => {
      // Route table follows hot reloads (ADR 0054 §3 `routes`).
      bridgedHttpHost?.publishRoutes(generation);
      consoleEventHub.publish('hmr:reload', { generation });
    },
    environment: runtimeEnvironment,
    environmentVariables,
    environmentSource,
    configUpdates: [featureOverrideMigration.configUpdate],
    disabledPluginInstanceKeys: [],
    installResources: async (context) => {
      await options.installTrustedResources?.(context);
      im.install(context.resources);
      installHttpHost(httpHost)(context);
      installDatabaseHost(databaseHost)(context);
      featureHost.install({
        context: {
          configuration: consoleConfigurationStore,
          snapshots: host.runtime.snapshots,
          setGlobalEnabled: (instanceKey, enabled) => setProjectPluginEnabled(options.root, instanceKey, enabled),
          requestRestart: () => { void requestProcessRestart('chat'); },
          publishEvent: (type, data) => consoleEventHub.publish(type, data),
        },
        audit: entry => { httpHost.tokenRegistry?.accessProvider?.audit?.(entry); },
      })(context);
      if (consoleIam) context.handoff.add({ activateNext: async () => { await consoleIam.activate(); } });
      // Match DatabaseHost's atomic-state capability. Unsupported dialects keep
      // static accounts; a failed read on a supported database still fails startup.
      if (['sqlite', 'mysql', 'pg'].includes(databaseHost.dialect)) {
        context.resources.provide(endpointDesiredRepositoryToken, endpointRepository);
        // #1250: imported accounts keep `${VAR}` references, resolved here at start against the
        // current environment; the config source compares / writes back `zhin.config.yml` endpoints.
        context.resources.provide(endpointSecretResolverToken, endpointSecretResolver);
        context.resources.provide(endpointConfigSourceToken, endpointConfigSource);
      }
      installLocaleHost(databaseHost)(context);
      installConfigurationHost({ store: consoleConfigurationStore, authorize: authorizeConfigurationChat })(context);
      installRestartHost({
        projectRoot: options.root,
        authorize: authorizeRestartChat,
        restartSupported: () => restartSupported,
        requestRestart: () => requestProcessRestart('chat'),
      })(context);
      if (isRelationalDialect) {
        context.handoff.add({
          activateNext: async (signal) => {
            signal.throwIfAborted();
            if (!durableConversationEventStore) {
              const events = databaseHost.models.get('conversation_events');
              const cursors = databaseHost.models.get('conversation_event_cursors');
              if (!events || !cursors) {
                throw new Error('Conversation event database models are unavailable after DatabaseHost activation');
              }
              await migrateConversationColumns(databaseHost.getRawDatabase() as StructuredDatabase);
              await migrateInboxColumns(databaseHost.getRawDatabase() as StructuredDatabase);
              durableConversationEventStore = new DatabaseConversationEventStore(
                events as unknown as ConversationDbModel,
                cursors as unknown as ConversationDbModel,
              );
              im.replaceConversationEventStore(durableConversationEventStore);
            }
            signal.throwIfAborted();
          },
        });
      }
      installOutboundHost(im)(context);
      installScheduleHost(scheduleHost)(context);
      installComponentHost()(context);
      installHtmlRendererHost(htmlRendererHost)(context);
      installSpeechHost(speechHandle)(context);
      // Agent Host seeds presets async — must await so unmatched handler
      // and dispose hooks are registered before generation commit.
      if (agentHost) {
        await agentHost.install({
          im,
          assistantStatus,
          selfChanges,
          selfChangeApply,
          projectRoot: options.root,
          resolveEndpointOwner: featureHost.resolveEndpointOwner,
          resolveConfiguredEndpointKeys: () => {
            const candidate = context.readCandidateSnapshot?.();
            if (candidate && candidate.generation !== context.generation) throw new Error('Endpoint validation targets another candidate generation');
            return readConfiguredEndpointKeys(config, candidate);
          },
          extraTools: speechHandle?.tools,
          audioTranscriber: speechHandle,
          transcribeUrl: speechHandle
            ? (url) => speechHandle.transcribeUrl(url)
            : undefined,
        })(context);
      }
      await installProtocolHosts({
        config: hostConfig,
        http: httpConfig,
        snapshots: host.runtime.snapshots,
        production: parsed.mode === 'production',
        projectRoot: options.root,
        secureCredentialProvider: {
          resolve(secretRef) {
            const match = /^env:\/\/([A-Z_][A-Z0-9_]*)$/u.exec(secretRef);
            return match ? hostEnvironment.get(match[1]!) : undefined;
          },
        },
      })(context);
      installConsoleRuntime(consoleHost.console)(context);
      installConsoleApiResources(consoleEventHub)(context);
    },
    async onRestartRequired(plan) {
      options.writeError(`${JSON.stringify({ restartRequired: plan }, null, 2)}\n`);
      // 插件管理操作进行中时不在此重启：依赖/声明变更由插件管理流程的
      // 「应用/重启」步骤统一显式触发，避免在安装与应用之间意外重启。
      if (pluginManagementActivity.active) {
        getLogger('runtime').info('插件管理操作进行中，依赖变更等待操作完成后显式应用');
        return;
      }
      // 自我变更生效中：先让生效器落盘 verifying 再重启（否则重启后只能按中途被杀回滚），生效流程结束后补发。
      if (selfChangeApply.active) {
        getLogger('runtime').info('自我变更生效中，重启推迟到变更流程记录进度之后');
        selfChangeApply.deferRestart(() => requestProcessRestart('dependencies'));
        return;
      }
      await requestProcessRestart('dependencies');
    },
    onReload(plan, generation, durationMs) {
      getLogger('runtime').info(formatCompact({
        op: 'hmr_reload',
        generation,
        duration_ms: durationMs,
        scope: plan.subtrees.length > 0 ? 'subtree' : 'capability',
        changed: plan.changed.map((source) => relative(options.root, source)).join(','),
        ...(plan.slots.length > 0
          ? { capabilities: plan.slots.map(readableCapabilityId).join(',') }
          : {}),
        ...(plan.subtrees.length > 0 ? { subtrees: plan.subtrees.join(',') } : {}),
      }));
    },
    onError(error) {
      selfChangeApply.noteError();
      options.writeError(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    },
  });
  // Attach before start so the generation-owned Endpoint event boundary is
  // available while the first generation is still being prepared.
  im.attach(host.runtime.snapshots);
  agentHost?.attach(host.runtime.snapshots, () => host.runtime.sourceOwnership);
  consoleHost.console.attach(host.runtime.snapshots);
  registerConsoleHttp({
    http: httpHost,
    console: consoleHost.console,
    clientOutDir: consoleHost.clientOutDir,
    projectRoot: options.root,
    isSandboxPage: (page) => runtimeSandboxOwners(host.runtime.snapshot).has(page.owner),
  });
  agentHost?.registerHttp(httpHost, httpConfig.apiBase ?? '/api');
  const disposeConsoleControlPlane = startConsoleControlPlane({
    http: httpHost,
    console: consoleHost.console,
    projectRoot: options.root,
    apiBase: httpConfig.apiBase,
    im,
    databaseHost,
    scheduleHost,
    eventHub: consoleEventHub,
    hostConsoleRpc: lease => composeHostConsoleRpc(assistantStatus.forOperation({
      ...(agentHost ? { ambientModels: signal => agentHost.ambientModels({ lease, signal }) } : {}),
    }),
      createHostToolApprovalConsoleRpc({ snapshots: host.runtime.snapshots, lease }),
      selfChanges.consoleRpc),
    pluginLifecycleFile,
    pluginLifecycleStore,
    configuration: consoleConfigurationStore,
    pluginManagementActivity,
    snapshot: () => host.runtime.snapshot,
    snapshots: host.runtime.snapshots,
    onRestart: () => requestProcessRestart('console'),
    consoleIam: consoleIamService,
    featureStores: featureHost.stores,
  });
  function requestProcessRestart(reason: string): Promise<void> {
    // ADR 0054 §3: restarts belong to the gateway. It answers `restart-request` with `shutdown`
    // and starts a fresh instance once this one has exited.
    if (restartSupported) {
      controlChannel!.requestRestart(reason);
      return Promise.resolve();
    }
    // Not supervised (or `--once`): nothing would bring the process back, so only stop it.
    // Never force an exit here: the caller (an embedding, a test worker) owns its process.
    options.writeError(`${JSON.stringify({ restartUnavailable: reason, hint: 'start the instance with zhin start' })}\n`);
    return control.stop().catch((error: unknown) => {
      options.writeError(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
  const exitProcess = options.exit ?? ((code: number) => { process.exit(code); });
  /**
   * Gateway-requested stop (`shutdown`, gateway gone) within `budgetMs`; a stop that hangs
   * (third-party handles) is ended by force, then the process exits so the gateway can start
   * the next instance.
   */
  function stopForShutdown(budgetMs: number): Promise<void> {
    const budgetTimer = setTimeout(() => {
      options.writeError(`${JSON.stringify({ forcedExit: 'budget', stillStopping: [...stoppingComponents] })}\n`);
      exitProcess(Number(process.exitCode ?? 0));
    }, budgetMs);
    budgetTimer.unref?.();
    return control.stop()
      .catch((error: unknown) => {
        options.writeError(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exitCode = 1;
      })
      .finally(() => {
        clearTimeout(budgetTimer);
        controlChannel?.close();
        const drainTimer = setTimeout(() => { exitProcess(Number(process.exitCode ?? 0)); }, 250);
        drainTimer.unref?.();
      });
  }
  const disposeReadiness = registerReadinessRoutes(httpHost, {
    snapshots: host.runtime.snapshots,
    agentBindings: agentHost?.bindings,
  }, httpConfig.apiBase);
  let stopping: Promise<void> | undefined;
  /** Components whose stop has begun but not settled; reported on a forced exit. */
  const stoppingComponents = new Set<string>();
  const stage = async (name: string, run: () => unknown): Promise<void> => {
    stoppingComponents.add(name);
    try { await run(); } finally { stoppingComponents.delete(name); }
  };
  // 幂等：Console 重启、依赖变更、信号与孤儿看门狗可能并发请求停止。
  control.stop = () => (stopping ??= stopAll());
  // `shutdown` may arrive while the first generation is still starting; stop() aborts that start.
  controlChannel?.onShutdown(({ budgetMs }) => { void stopForShutdown(budgetMs); });
  // The gateway went away (killed, crashed): this instance must not outlive it.
  controlChannel?.onDisconnect(() => {
    getLogger('runtime').error(formatCompact({ op: 'orphan_shutdown', reason: 'gateway disconnected' }));
    void stopForShutdown(DEFAULT_SHUTDOWN_BUDGET_MS);
  });
  const stopAll = async (): Promise<void> => {
    try {
      disposeReadiness();
      disposeConsoleControlPlane();
      consoleTerminal?.close();
      await consoleIam?.dispose();
      // Process ingress owns WebSocket operation leases. Close it before Root
      // drain so long-lived connections release those leases instead of
      // deadlocking SnapshotStore.close().
      await stage('http', () => httpHost.close());
    } finally {
      try {
        try { await stage('inference', () => agentHost?.close()); }
        finally { await stage('runtime', () => host.stop()); }
      } finally {
        try {
          await stage('schedule', () => scheduleHost.stop());
        } finally {
          try {
            systemLogStore.dispose();
          } finally {
            try {
              await stage('database', () => databaseHost.stop());
            } finally {
              pluginLifecycleStore.dispose();
              complete();
            }
          }
        }
      }
    }
  };

  let snapshot: Awaited<ReturnType<typeof host.start>>;
  let httpOrigin = `http://${primaryHttpListener.host ?? '127.0.0.1'}:${primaryHttpListener.port ?? 8086}`;
  try {
    const address = await httpHost.listen();
    if (address) httpOrigin = address.origin;
    // Under the gateway, the gateway owns the listener and prints its own guidance.
    if (!bridgedHttpHost && process.stdout.isTTY && !parsed.once) {
      const startup = getLogger('setup');
      startup.success(`zhin control plane listening at ${httpOrigin}`);
      printFirstRunGuidance(httpOrigin, Boolean(httpConfig.token));
      if (parsed.open || process.env.ZHIN_OPEN === '1') {
        openBrowser(createRemoteConsoleUrl(httpOrigin));
      }
    }
    snapshot = await host.start();
    // ADR 0057 §2: the overrides are in the database now; back up and remove the file's blocks.
    await featureOverrideMigration.finish();
    // ADR 0057 §4: one warning for literal secrets (paths only), using the committed Plugin schemas.
    warnLiteralConfigSecrets(rawConfigDocument, host.runtime.snapshot, configFile);
    // The constructor-time prune ran before the database host started and was skipped;
    // without this a frequently restarted process would never prune (next tick is hours away).
    void systemLogStore.prune();
  } catch (error) {
    // #742: HTTP listens before the first generation is committed, so a
    // Console restart or a signal can request stop while host.start() is
    // still running. stop() aborts that start transaction on purpose; the
    // rejection is the expected consequence, not a startup failure. Let the
    // stop that is already running finish (it owns the cleanup) and return
    // normally so the requested exit code (130 for a signal) stands.
    if (stopping) {
      await stopping;
      return;
    }
    // A failed start may already have started the database, schedule and Agent hosts:
    // run the full stop sequence instead of closing HTTP only. The start error wins.
    await control.stop().catch(() => undefined);
    // Annotate schema validation failures with the source config file name.
    if (configFile && error instanceof ConfigValidationError) {
      throw new ConfigValidationError(error.issues, configFile);
    }
    throw error;
  }
  // TTY 交互启动：统一走 logger；裸 JSON 留给 --once / 管道（stable-path、脚本）
  // The gateway pipes the instance's output and echoes it to its terminal (ADR 0054 §3).
  const interactiveOutput = process.stdout.isTTY || process.env.ZHIN_INSTANCE_INTERACTIVE === '1';
  if (interactiveOutput && !parsed.once) {
    // Ready no longer waits for account logins: report who is still starting or failed.
    const endpoints = im.endpoints.list();
    const online = endpoints.filter((ep) => ep.status === 'online').map((ep) => ep.name);
    const rest = endpoints.filter((ep) => ep.status !== 'online');
    const starting = rest.filter((ep) => ep.phase === 'starting' || ep.phase === 'awaiting_assist' || ep.phase === 'reconnecting')
      .map((ep) => ep.phase === 'awaiting_assist' ? `${ep.name} (awaiting login)` : ep.name);
    // Redacted reason (#1250): category + the Adapter-masked message, never the raw error.
    const reason = (ep: (typeof endpoints)[number]) => ep.lastError
      ? `${ep.lastError.category}: ${ep.lastError.message}` : ep.startFailure?.code;
    const failed = rest.filter((ep) => ep.phase === 'failed' || ep.phase === 'retrying')
      .map((ep) => ep.startFailure ? `${ep.name} (${reason(ep)}${ep.phase === 'retrying' ? ', retrying' : ''})` : ep.name);
    const offlineRows = rest.filter((ep) => !['starting', 'awaiting_assist', 'reconnecting', 'failed', 'retrying'].includes(ep.phase));
    const offline = offlineRows.filter((ep) => !ep.startFailure).map((ep) => ep.name);
    const offlineFailed = offlineRows.filter((ep) => ep.startFailure).map((ep) => `${ep.name} (${reason(ep)})`);
    const startup = getLogger('setup');
    startup.success('zhin runtime started');
    startup.info(formatCompact({
      plugins: snapshot.plugins,
      http: httpOrigin,
    }));
    if (online.length > 0) {
      startup.info(`online: ${online.join(', ')}`);
    }
    if (starting.length > 0) {
      startup.info(`starting: ${starting.join(', ')}`);
    }
    if (failed.length > 0) {
      startup.warn(`failed: ${failed.join(', ')}`);
    }
    if (offline.length > 0) {
      startup.info(`offline: ${offline.join(', ')}`);
    }
    if (offlineFailed.length > 0) {
      startup.warn(`offline: ${offlineFailed.join(', ')}`);
    }
  } else {
    options.writeOutput(`${JSON.stringify({ started: true, ...snapshot }, null, 2)}\n`);
  }
  bridgedHttpHost?.publishRoutes(snapshot.generation);
  controlChannel?.ready({
    generation: snapshot.generation,
    ...(bridgedHttpHost ? { routes: bridgedHttpHost.routeTable() } : {}),
  });
  if (parsed.once) {
    // `--once` is a start-up check: it waits (bounded) for every account's first start attempt to
    // settle, then an enabled account whose start failed (failed, or retrying after a failed
    // attempt) fails the run. Accounts still starting at the deadline or waiting for an
    // interactive login are not failures (nothing has failed yet).
    await waitForFirstStartOutcomes(() => im.endpoints.list(), ONCE_START_SETTLE_MS);
    const failures = onceStartFailures(im.endpoints.list(), (() => {
      const lease = host.runtime.snapshots.acquire();
      try {
        const adapters = lease.value.projections.get(adapterFeatureId);
        return isAdapterIndex(adapters) ? (id: string) => adapters.startFailureReason(id as CapabilityId) : () => undefined;
      } finally { lease.release(); }
    })());
    await control.stop();
    controlChannel?.close();
    if (failures.length) throw new AccountStartupError(failures);
    return;
  }
  // ADR 0040 §6：启动完成后接续生效中 / 待校验的自我变更（健康检查、回滚、回报）。
  void selfChangeApply.started().catch(reportSelfChangeRecoverError);
  void deliverPendingRestartReceipt({
    projectRoot: options.root,
    im,
    snapshot,
  });

  const reportStopError = (error: unknown): void => {
    options.writeError(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  };
  const disposeProcessLifecycle = installProcessLifecycle({
    process: nodeProcessLifecycleAdapter,
    requestStop: () => control.stop(),
    describePending: () => [...stoppingComponents],
    reportForcedExit: (reason, pending) => {
      options.writeError(`${JSON.stringify({ forcedExit: reason, stillStopping: pending })}\n`);
    },
    reportError: reportStopError,
  });
  try { await completed; }
  finally {
    controlChannel?.close();
    disposeProcessLifecycle();
  }
}

function reportSelfChangeRecoverError(error: unknown): void {
  getLogger('runtime').warn(formatCompact({
    op: 'self_change_recover_failed',
    error: error instanceof Error ? error.message : String(error),
  }));
}

interface ConfiguredAgentHost {
  close(): Promise<void>;
  registerHttp(http: import('@zhin.js/host-http').HttpHost, base: string): void;
  ambientModels(input: Readonly<{ lease: import('@zhin.js/plugin-runtime').SnapshotLease; signal: AbortSignal }>): Promise<readonly string[]>;
  readonly bindings: NonNullable<ReadinessSource['agentBindings']>;
  attach(
    snapshots: import('@zhin.js/plugin-runtime').SnapshotReader,
    sourceOwnership?: () => import('@zhin.js/runtime').SourceOwnershipIndex,
  ): void;
  install(options: {
    readonly im: ImRuntime;
    readonly projectRoot: string;
    readonly resolveEndpointOwner: (adapter: string, endpoint: string) => string | undefined;
    readonly resolveConfiguredEndpointKeys: () => Promise<ReadonlySet<string>>;
    readonly extraTools?: readonly unknown[];
    readonly audioTranscriber?: import('@zhin.js/agent').AudioTranscriptionPort;
    readonly transcribeUrl?: (url: string) => Promise<string | null>;
    readonly assistantStatus?: AssistantStatus;
    readonly selfChanges?: HostSelfChanges;
    readonly selfChangeApply?: HostSelfChangeApply;
  }): RootResourceInstaller;
}

async function loadConfiguredAgentHost(options: Readonly<{
  config: RuntimeConfigDocument | ConfigDocumentPort;
  projectRoot: string;
  database: import('@zhin.js/plugin-runtime').DatabaseHost;
  resolveSource: (reference: string | import('@zhin.js/plugin-runtime').EnvironmentExpressionSource) => string | undefined | Promise<string | undefined>;
}>): Promise<ConfiguredAgentHost | undefined> {
  const { config, projectRoot } = options;
  const document = isConfigDocumentPort(config) ? (await config.read()).document : config;
  if (!hasAgentConfiguration(document)) return undefined;
  let agentHost: typeof import('./agent/module.js');
  let agentHostToken: typeof import('@zhin.js/agent/runtime').agentHostToken;
  let createTurnTraceArchive: typeof import('@zhin.js/agent/trace').createTurnTraceArchive;
  let defaultTurnTraceDir: typeof import('@zhin.js/agent/trace').defaultTurnTraceDir;
  let defaultTurnTraceFile: typeof import('@zhin.js/agent/trace').defaultTurnTraceFile;
  let resolveTraceArchiveOptions: typeof import('@zhin.js/agent/trace').resolveTraceArchiveOptions;
  let personalSessionOwnerId: typeof import('@zhin.js/agent/personal-session').personalSessionOwnerId;
  try {
    agentHost = await import('./agent/module.js');
    ({ agentHostToken } = await import('@zhin.js/agent/runtime'));
    ({ createTurnTraceArchive, defaultTurnTraceDir, defaultTurnTraceFile, resolveTraceArchiveOptions } = await import('@zhin.js/agent/trace'));
    ({ personalSessionOwnerId } = await import('@zhin.js/agent/personal-session'));
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (
      code === 'ERR_MODULE_NOT_FOUND' ||
      code === 'MODULE_NOT_FOUND' ||
      (error instanceof Error && /Cannot find package|Cannot find module/i.test(error.message))
    ) {
      throw new Error(
        `检测到配置中启用了 AI / Assistant，但缺少 AI 运行时依赖（${error instanceof Error ? error.message : String(error)}）。请运行 \`npx zhin setup\` 或 \`pnpm add @zhin.js/agent @zhin.js/ai ai zod\` 安装依赖。`,
        { cause: error },
      );
    }
    throw error;
  }
  // One writer across generations; persistence maintenance also prunes while the bot is idle.
  const turnTraceStore = createTurnTraceArchive(defaultTurnTraceDir(projectRoot), {
    ...resolveTraceArchiveOptions(),
    legacyFile: defaultTurnTraceFile(projectRoot),
  });
  const initialAi = await agentHost.resolveAiConfig(document);
  const runtime = new agentHost.AgentRuntime({
    coordinator: new agentHost.AgentTurnCoordinator(),
    turnTraceStore,
  });
  let snapshotReader: import('@zhin.js/plugin-runtime').SnapshotReader | undefined;
  const inference = new agentHost.HostInference({ projectRoot, database: options.database, resolveSource: options.resolveSource,
    personalOwners: Object.values(initialAi?.personalPrincipals ?? {}).flat(),
    snapshots: () => {
      if (!snapshotReader) throw new Error('Inference Snapshot reader is not attached');
      return snapshotReader;
    },
  });
  const principalBindings = Object.fromEntries(Object.entries(initialAi?.personalPrincipals ?? {}).map(([id, owners]) => [id,
    owners.map(owner => {
      if (owner.rootId !== inference.rootId) throw new Error('Personal principal binding belongs to another Host');
      return personalSessionOwnerId(owner);
    }),
  ]));
  let sourceOwnership: (() => import('@zhin.js/runtime').SourceOwnershipIndex) | undefined;
  const configured: ConfiguredAgentHost = {
    close: () => inference.close(),
    ambientModels: input => inference.ambientModels(input),
    registerHttp(http, base) {
      if (!snapshotReader) throw new Error('Agent Host Snapshot reader is not attached');
      agentHost.registerInferenceRoutes({ http, base, acquire: () => inference.acquireManagement(),
        principal: input => agentHost.resolveInferenceManagementPrincipal({ ...input, hostOwnerId: inference.hostOwnerId, bindings: principalBindings }),
        owners: input => {
          if (input.scope === 'full') return [{ id: inference.hostOwnerId, label: '部署模型', kind: 'host' }];
          const bound = input.principalId ? initialAi?.personalPrincipals?.[input.principalId] : undefined;
          if (!bound?.length) throw new agentHost.InferenceManagementError('forbidden');
          return bound.map(owner => ({ id: personalSessionOwnerId(owner), label: `${owner.platform} · ${owner.endpoint} · ${owner.subjectId}`, kind: 'personal' as const, personal: owner }));
        },
      });
    },
    bindings: (snapshot) => {
      const port = snapshot.resources.get(snapshot.root)?.get(agentHostToken.id) as
        import('@zhin.js/agent/runtime').AgentHostPort | undefined;
      return port?.protocol.listBindings() ?? [];
    },
    attach: (snapshots, ownership) => {
      snapshotReader = snapshots;
      sourceOwnership = ownership;
      runtime.attach(snapshots);
    },
    install: (options) => {
      if (!snapshotReader) throw new Error('Agent Host Snapshot reader is not attached');
      return agentHost.installAgentHost({
        ...options,
        inference,
        pruneTraces: () => turnTraceStore.prune(),
        runtime,
        snapshots: snapshotReader,
        selfChangeImpact: agentHost.createSelfChangeImpactPort(sourceOwnership),
        selfChangePluginRoots: agentHost.createSelfChangePluginRoots(options.projectRoot, sourceOwnership),
        extraTools: options.extraTools as Parameters<typeof agentHost.installAgentHost>[0]['extraTools'],
      });
    },
  };
  return Object.freeze(configured);
}

export function hasAgentConfiguration(document: RuntimeConfigDocument): boolean {
  const value = document as Record<string, unknown>;
  assertNoRemovedAgentConfiguration(value.ai);
  return ['ai', 'assistant'].some((key) => {
    const section = value[key];
    if (section == null || typeof section !== 'object' || Array.isArray(section)) return false;
    return (section as { enabled?: unknown }).enabled !== false;
  });
}

function assertNoRemovedAgentConfiguration(section: unknown): void {
  if (section == null || typeof section !== 'object' || Array.isArray(section)) return;
  const ai = section as Record<string, unknown>;
  if (Object.hasOwn(ai, 'workroom')) {
    throw new Error(
      'ai.workroom removed in ADR 0048; declare shared rooms under ai.venues and agent collaboration ceilings under agents/<name>/agent.json ("collaboration")',
    );
  }
  if (Object.hasOwn(ai, 'workrooms')) {
    throw new Error(
      'ai.workrooms removed in ADR 0048; declare shared rooms under ai.venues and agent collaboration ceilings under agents/<name>/agent.json ("collaboration")',
    );
  }
  if (Object.hasOwn(ai, 'remoteAgents')) {
    throw new Error(
      'ai.remoteAgents removed in ADR 0048; declare remote peers under a2a.mailbox.peers',
    );
  }
  if (Object.hasOwn(ai, 'remote_mesh')) {
    throw new Error(
      'ai.remote_mesh removed in ADR 0048; use a2a.mailbox for remote peer mail transport',
    );
  }
  if (Object.hasOwn(ai, 'remoteMesh')) {
    throw new Error(
      'ai.remoteMesh removed in ADR 0048; use a2a.mailbox for remote peer mail transport',
    );
  }
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  return Boolean(value && typeof value === 'object'
    && typeof (value as Partial<ConfigDocumentPort>).read === 'function');
}

function createRemoteConsoleUrl(httpOrigin: string): string {
  return `${REMOTE_CONSOLE_URL}?host=${encodeURIComponent(httpOrigin)}`;
}

function printFirstRunGuidance(httpOrigin: string, tokenConfigured: boolean): void {
  const startup = getLogger('setup');
  const consoleUrl = createRemoteConsoleUrl(httpOrigin);
  startup.info(`Remote Console: ${consoleUrl}${tokenConfigured ? chalk.dim(' (token required — 见 .env 中的 HTTP_TOKEN)') : ''}`);
  startup.info(`Local Sandbox:  ${httpOrigin}/sandbox${tokenConfigured ? chalk.dim(' (可在页面顶部直接输入 HTTP_TOKEN 或访问 ?token=<HTTP_TOKEN>)') : ''}`);
}

function warnUnsetConfigEnvPlaceholders(
  document: unknown,
  getEnv: (name: string) => string | undefined,
  configFile: string,
): void {
  const unset = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        const varName = match[1];
        if (varName && getEnv(varName) === undefined) {
          unset.add(varName);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(document);
  if (unset.size > 0) {
    const vars = [...unset].map(name => `\${${name}}`).join(', ');
    const rel = relative(process.cwd(), configFile) || configFile;
    getLogger('setup').warn(`配置文件 ${rel} 中引用了未设置的环境变量: ${vars}（已展开为空字符串，请检查 .env）`);
  }
}

/** Logs ONE warning listing secret paths that hold literals instead of `${VAR}`; never the values. */
export function warnLiteralConfigSecrets(
  document: unknown,
  snapshot: Parameters<typeof snapshotConfigSecretSchemas>[0],
  configFile: string,
  logger: Pick<ReturnType<typeof getLogger>, 'warn'> = getLogger('setup'),
): void {
  const secrets = findLiteralConfigSecrets(document, {
    host: HOST_CONFIG_SCHEMA as Readonly<Record<string, unknown>>,
    plugins: snapshotConfigSecretSchemas(snapshot),
  });
  if (secrets.length === 0) return;
  logger.warn(formatLiteralConfigSecretWarning(secrets, relative(process.cwd(), configFile) || configFile));
}

function openBrowser(url: string): void {
  // CI / 无显示环境直接跳过，不报错。
  if (process.env.CI) return;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
  void open(url).catch((error) => {
    getLogger('setup').warn(formatCompact({
      op: 'open_remote_console_failed',
      url,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

/** One account that failed to start within `zhin start --once`. */
export interface OnceStartFailure {
  readonly account: string;
  readonly phase: 'failed' | 'retrying';
  readonly category?: string;
  /** The account's start failure, credentials masked (the `endpoint_start_failed` log text). */
  readonly reason: string;
}

/** Upper bound `zhin start --once` waits for first start attempts beyond the activation grace. */
export const ONCE_START_SETTLE_MS = 30_000;

/**
 * Resolves once no account is still in its first start attempt (`starting` without a login flow
 * waiting for a person), or after `timeoutMs`.
 */
export async function waitForFirstStartOutcomes(
  list: () => readonly Readonly<{ phase: string; pendingLogin?: boolean }>[],
  timeoutMs: number,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (list().some(row => row.phase === 'starting' && !row.pendingLogin) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
}

/**
 * Accounts that make `zhin start --once` fail: not online, start phase `failed` or `retrying`
 * (a start attempt failed; retries would follow in a long-running instance), and no login flow
 * waiting for a person. `starting` / `awaiting_assist` are not failures.
 */
export function onceStartFailures(
  endpoints: readonly Readonly<{ id: string; name: string; adapter: string; status: string; phase: string; pendingLogin?: boolean;
    lastError?: Readonly<{ category: string; message: string }>; startFailure?: Readonly<{ code: string }> }>[],
  reasonOf: (id: string) => string | undefined,
): readonly OnceStartFailure[] {
  return endpoints
    .filter(row => row.status !== 'online' && (row.phase === 'failed' || row.phase === 'retrying') && !row.pendingLogin)
    .map(row => Object.freeze({
      account: `${row.adapter}/${row.name}`,
      phase: row.phase as 'failed' | 'retrying',
      ...(row.lastError ? { category: row.lastError.category } : {}),
      reason: reasonOf(row.id) ?? row.lastError?.message ?? row.startFailure?.code ?? 'start failed',
    }));
}

/**
 * `zhin start --once` with failed accounts: the message leads with the first failure (as the CLI
 * printed a failed start before #1250) and names every failed account.
 */
export class AccountStartupError extends Error {
  readonly failures: readonly OnceStartFailure[];
  constructor(failures: readonly OnceStartFailure[]) {
    const [first, ...rest] = failures;
    const describe = (failure: OnceStartFailure) =>
      `${failure.account}${failure.category ? ` ${failure.category}` : ''}${failure.phase === 'retrying' ? ', retrying' : ''}`;
    super(`${first!.reason} [${describe(first!)}]${rest.length
      ? `; ${rest.length} more account(s) failed to start: ${rest.map(describe).join('; ')}` : ''}`);
    this.name = 'AccountStartupError';
    this.failures = Object.freeze([...failures]);
  }
}

/** Plugins owning an Endpoint whose profile declares `runtime.sandbox` (ADR 0044). */
export function runtimeSandboxOwners(snapshot: RuntimeSnapshot | undefined): ReadonlySet<string> {
  const owners = new Set<string>();
  const adapters = snapshot?.projections.get(adapterFeatureId);
  if (!isAdapterIndex(adapters)) return owners;
  for (const row of adapters.describe()) {
    const profile = adapters.capabilityProfile(row.id);
    if (!profile) continue;
    if (resolveStaticCapabilities(profile, []).runtime?.sandbox === true) owners.add(String(row.owner));
  }
  return owners;
}

/** Reads Bot Endpoint identities from the candidate config, not the old live ImRuntime. */
export async function readConfiguredEndpointKeys(
  config: RuntimeConfigDocument | ConfigDocumentPort,
  candidate?: RuntimeSnapshot,
): Promise<ReadonlySet<string>> {
  const keys = new Set<string>();
  const adapters = candidate?.projections.get(adapterFeatureId);
  if (candidate && isAdapterIndex(adapters)) {
    const aliasCounts = new Map<string, number>();
    for (const row of adapters.describe()) {
      const packageName = candidate.tree.get(row.owner)?.packageName;
      const alias = packageName?.replace(/^@[^/]+\/adapter-/, '') ?? row.name;
      const key = `${alias}:${row.name}`;
      aliasCounts.set(key, (aliasCounts.get(key) ?? 0) + 1);
      keys.add(`${row.owner}:${row.name}`);
    }
    for (const [key, count] of aliasCounts) if (count === 1) keys.add(key);
    return keys;
  }
  if (candidate) return keys;
  const document = await readConfigDocumentValue(config);
  if (!document || typeof document !== 'object') return keys;
  const plugins = readPluginConfigurationMap(document as Record<string, unknown>);
  const expanded = expandEnvironmentValue(plugins, (key) => process.env[key]) as Record<string, unknown>;
  for (const [adapter, raw] of Object.entries(expanded)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const endpoints = (raw as Record<string, unknown>).endpoints;
    if (endpoints === undefined || (Array.isArray(endpoints) && endpoints.length === 0)) {
      keys.add(`${adapter}:${adapter}`);
      continue;
    }
    if (!Array.isArray(endpoints)) continue;
    for (const entry of endpoints) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const endpoint = entry as Record<string, unknown>;
      const identity = endpoint.name ?? endpoint.id;
      if (identity != null && String(identity).trim() !== '') {
        keys.add(`${adapter}:${String(identity)}`);
      }
    }
  }
  return keys;
}

/** @internal Exported for tests. */
export async function applyRuntimeLogLevel(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<void> {
  const document = await readConfigDocumentValue(config);
  const raw = document && typeof document === 'object' ? (document as Record<string, unknown>).log_level : undefined;
  // ZHIN_LOG_LEVEL / LOG_LEVEL override config for one-shot debugging, also when config sets none.
  // An empty variable counts as unset.
  const level = process.env.ZHIN_LOG_LEVEL || process.env.LOG_LEVEL || raw;
  if (level === undefined || level === null || level === '') return;
  setLevel(level as LogLevelInput, undefined, true);
}

async function readConfigDocumentValue(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!config || typeof config !== 'object') return config;
  const candidate = config as Partial<ConfigDocumentPort>;
  if (typeof candidate.read === 'function') {
    const snapshot = await candidate.read();
    return snapshot && typeof snapshot === 'object' && 'document' in snapshot
      ? (snapshot as { document: unknown }).document
      : snapshot;
  }
  return config;
}

async function loadProjectConfig(
  root: string,
): Promise<{ config: ConfigFileDocument; file: string }> {
  const existing: string[] = [];
  for (const candidate of ROOT_CONFIG_FILE_NAMES) {
    const file = join(root, candidate);
    try { await access(file); existing.push(file); }
    catch { /* Missing candidates are expected. */ }
  }
  const file = selectRootConfigFile(existing) ?? join(root, DEFAULT_ROOT_CONFIG_FILE_NAME);
  return { config: createConfigDocument(file), file };
}
