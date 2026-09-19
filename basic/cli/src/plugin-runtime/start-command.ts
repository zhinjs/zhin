import { access, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import chalk from 'chalk';
import open from 'open';
import { YamlConfigDocument } from '@zhin.js/config-yaml';
import { endpointConfigurationStoreToken } from '@zhin.js/adapter';
import { ImRuntime, type Message } from '@zhin.js/core/runtime';
import {
  CONVERSATION_CURSOR_MODEL,
  CONVERSATION_EVENT_MODEL,
  DatabaseConversationEventStore,
  type ConversationDbModel,
} from '@zhin.js/im-contract';
import { createConsoleEventHub, createHttpHostGroup } from '@zhin.js/host-http';
import { defineInboxTables, readPluginConfigurationMap } from '@zhin.js/plugin-runtime';
import { setLevel, getLogger, formatCompact, type LogLevelInput } from '@zhin.js/logger';
import {
  ConfigValidationError,
  type ConfigDocumentPort,
  type RuntimeConfigDocument,
  type RootResourceInstaller,
  ensureTypeScriptSpecifierRemap,
  expandEnvironmentValue,
} from '@zhin.js/runtime';
import {
  createConsoleHostModules,
  installConsoleApi,
  installConsoleHttp,
  SystemLogStore,
  resolveSystemLogConfig,
} from './console/module.js';
import { installHttpHost, resolveHttpConfig } from './http-host-installer.js';
import { createDatabaseHost, installDatabaseHost, resolveDatabaseConfig } from './database-host-installer.js';
import { installHtmlRendererHost, prepareHtmlRendererHost } from './html-renderer-host-installer.js';
import { installComponentHost } from './component-host-installer.js';
import { installOutboundHost } from './outbound-host-installer.js';
import { installScheduleHost, createScheduleHost } from './schedule-host-installer.js';
import { installSpeechHost, prepareSpeechHost, resolveSpeechConfig } from './speech-host-installer.js';
import { installProtocolHosts } from './protocol-host-installer.js';
import { YamlEndpointConfigurationStore } from './endpoint-configuration-store.js';
import { RootHost } from './root-host.js';
import { registerReadinessRoutes, type ReadinessSource } from './readiness.js';
import {
  createPluginLifecycleStore,
  readPluginLifecycleState,
  resolvePluginLifecycleFile,
} from './plugin-lifecycle-store.js';
import { installProcessLifecycle, nodeProcessLifecycleAdapter } from './process-lifecycle.js';
import {
  NativeTypeScriptSupervisor,
  loadRuntimeEnvironmentLayers,
  parseStartOptions,
  processRestartExitCode,
  startSupervisorWatchdog,
} from './start/module.js';

export {
  MAX_RESPAWNS_PER_MINUTE,
  RESPAWN_DELAY_MS,
  SUPERVISOR_CHILD_EXIT_GRACE_MS,
  loadRuntimeEnvironmentLayers,
  parseStartOptions,
  planRespawn,
  processRestartExitCode,
  type RespawnPlan,
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
}

function readableCapabilityId(value: string): string {
  return value.split('\0').join(':');
}

export async function runStartCommand(options: StartCommandOptions): Promise<void> {
  // Parse before any relaunch so invalid options fail fast instead of looping.
  const parsed = parseStartOptions(options.args);
  if (await new NativeTypeScriptSupervisor(options.root, parsed).runIfRequired()) return;
  ensureTypeScriptSpecifierRemap();
  const environmentVariables = await loadRuntimeEnvironmentLayers(options.root, parsed.environment);
  const { config, file: configFile } = await loadProjectConfig(options.root);
  const pluginLifecycleFile = resolvePluginLifecycleFile(options.root);
  const pluginLifecycle = await readPluginLifecycleState(pluginLifecycleFile);
  const pluginLifecycleStore = createPluginLifecycleStore();
  await applyRuntimeLogLevel(config);
  const envOverlay = environmentVariables.environments?.[parsed.environment];
  const httpConfig = await resolveHttpConfig(config, envOverlay, options.root);
  const {listeners: additionalHttpListeners = [], ...primaryHttpListener} = httpConfig;
  const httpHost = createHttpHostGroup([primaryHttpListener, ...additionalHttpListeners]);
  const databaseConfig = await resolveDatabaseConfig(options.root, config);
  // Agent is an optional install tier. Do not resolve its module from the
  // IM-only startup graph unless the project actually configures Agent state.
  const agentHost = await loadConfiguredAgentHost(config);
  const endpointRoles = await createEndpointRoleResolver(config);
  const speechHandle = await prepareSpeechHost(await resolveSpeechConfig(config));
  const htmlRendererHost = await prepareHtmlRendererHost(config);
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  const control: { stop(): Promise<void> } = {
    stop: async () => { throw new Error('RootHost stop is not bound'); },
  };
  const senderEnricher = await createSenderEnricher(config, endpointRoles);
  const im = new ImRuntime({ enrichSender: senderEnricher });
  const databaseHost = createDatabaseHost(databaseConfig);
  databaseHost.define('conversation_events', CONVERSATION_EVENT_MODEL);
  databaseHost.define('conversation_event_cursors', CONVERSATION_CURSOR_MODEL);
  // console endpoint-detail 收件箱三张表（unified_inbox_message/request/notice）；
  // 必须在 installResources（host.start）之前 define，写入订阅由 Console API 挂载。
  defineInboxTables(databaseHost);
  // console logs 页数据源（SystemLog 表 + 根 logger transport）；
  // 表必须在 installResources（host.start）之前 define，写入在 host started 后才生效。
  const systemLogStore = new SystemLogStore(
    databaseHost,
    await resolveSystemLogConfig(config),
  );
  const scheduleHost = createScheduleHost();
  const consoleHost = createConsoleHostModules(options.root, !parsed.once && !parsed.noWatch);
  // Console SSE 事件枢纽：/api/events 订阅方 + HMR/消息/配置事件 publish 方共享。
  const consoleEventHub = createConsoleEventHub();
  const endpointConfigurationStore = new YamlEndpointConfigurationStore({
    projectRoot: options.root,
    configFile,
  });
  const host = new RootHost({
    projectRoot: options.root,
    config,
    modules: consoleHost.modules,
    watch: !parsed.once && !parsed.noWatch,
    onGenerationCommit: (generation) => {
      consoleEventHub.publish('hmr:reload', { generation });
    },
    environment: {
      name: parsed.environment,
      mode: parsed.mode,
      platform: 'node',
    },
    environmentVariables,
    disabledPluginInstanceKeys: pluginLifecycle.disabled,
    installResources: async (context) => {
      await options.installTrustedResources?.(context);
      context.resources.provide(endpointConfigurationStoreToken, endpointConfigurationStore);
      im.install(context.resources);
      installHttpHost(httpHost)(context);
      installDatabaseHost(databaseHost)(context);
      context.handoff.add({
        activateNext: async (signal) => {
          signal.throwIfAborted();
          const events = databaseHost.models.get('conversation_events');
          const cursors = databaseHost.models.get('conversation_event_cursors');
          if (!events || !cursors) {
            throw new Error('Conversation event database models are unavailable after DatabaseHost activation');
          }
          im.replaceConversationEventStore(new DatabaseConversationEventStore(
            events as unknown as ConversationDbModel,
            cursors as unknown as ConversationDbModel,
          ));
          signal.throwIfAborted();
        },
      });
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
          projectRoot: options.root,
          resolveEndpointOwner: endpointRoles.resolveOwner,
          resolveEndpointTrusted: endpointRoles.resolveTrusted,
          resolveConfiguredEndpointKeys: () => readConfiguredEndpointKeys(config),
          extraTools: speechHandle?.tools,
          audioTranscriber: speechHandle,
          transcribeUrl: speechHandle
            ? (url) => speechHandle.transcribeUrl(url)
            : undefined,
        })(context);
      }
      await installProtocolHosts({
        config,
        http: httpConfig,
        snapshots: host.runtime.snapshots,
        production: parsed.mode === 'production',
        projectRoot: options.root,
        secureCredentialProvider: {
          resolve(secretRef) {
            const match = /^env:\/\/([A-Z_][A-Z0-9_]*)$/u.exec(secretRef);
            return match ? process.env[match[1]!] : undefined;
          },
        },
      })(context);
      installConsoleHttp({
        console: consoleHost.console,
        clientOutDir: consoleHost.clientOutDir,
        projectRoot: options.root,
      })(context);
      installConsoleApi({
        console: consoleHost.console,
        projectRoot: options.root,
        apiBase: httpConfig.apiBase,
        im,
        databaseHost,
        scheduleHost,
        eventHub: consoleEventHub,
        pluginLifecycleFile,
        pluginLifecycleStore,
        snapshot: () => host.runtime.snapshot,
        snapshots: host.runtime.snapshots,
        onRestart: () => {
          // The native TypeScript supervisor treats this code as an intentional
          // process-generation restart in both foreground Desktop and daemon mode.
          process.exit(processRestartExitCode);
        },
      })(context);
    },
    async onRestartRequired(plan) {
      options.writeError(`${JSON.stringify({ restartRequired: plan }, null, 2)}\n`);
      process.exitCode = processRestartExitCode;
      await control.stop();
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
      options.writeError(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    },
  });
  // Attach before start so the generation-owned Endpoint event boundary is
  // available while the first generation is still being prepared.
  im.attach(host.runtime.snapshots);
  agentHost?.attach(host.runtime.snapshots);
  consoleHost.console.attach(host.runtime.snapshots);
  const disposeReadiness = registerReadinessRoutes(httpHost, {
    snapshots: host.runtime.snapshots,
    agentBindings: agentHost?.bindings,
  }, httpConfig.apiBase);
  control.stop = async () => {
    try {
      disposeReadiness();
      // Process ingress owns WebSocket operation leases. Close it before Root
      // drain so long-lived connections release those leases instead of
      // deadlocking SnapshotStore.close().
      await httpHost.close();
    } finally {
      try {
        await host.stop();
      } finally {
        try {
          scheduleHost.stop();
        } finally {
          try {
            systemLogStore.dispose();
          } finally {
            try {
              await databaseHost.stop();
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
  try {
    await httpHost.listen();
    snapshot = await host.start();
  } catch (error) {
    await httpHost.close().catch(() => undefined);
    systemLogStore.dispose();
    // Annotate schema validation failures with the source config file name.
    if (configFile && error instanceof ConfigValidationError) {
      throw new ConfigValidationError(error.issues, configFile);
    }
    throw error;
  }
  // TTY 交互启动：统一走 logger；裸 JSON 留给 --once / 管道（stable-path、脚本）
  if (process.stdout.isTTY && !parsed.once) {
    const endpoints = im.listEndpoints();
    const online = endpoints.filter((ep) => ep.status === 'online').map((ep) => ep.name);
    const offline = endpoints.filter((ep) => ep.status !== 'online').map((ep) => ep.name);
    const httpAddress = `${primaryHttpListener.host ?? '127.0.0.1'}:${primaryHttpListener.port ?? 8086}`;
    const startup = getLogger('setup');
    startup.success('zhin runtime started');
    startup.info(formatCompact({
      plugins: snapshot.plugins,
      http: `http://${httpAddress}`,
    }));
    if (online.length > 0) {
      startup.info(`online: ${online.join(', ')}`);
    }
    if (offline.length > 0) {
      startup.info(`offline: ${offline.join(', ')}`);
    }
    printFirstRunGuidance(httpAddress, Boolean(httpConfig.token));
    if (parsed.open || process.env.ZHIN_OPEN === '1') openBrowser(REMOTE_CONSOLE_URL);
  } else {
    options.writeOutput(`${JSON.stringify({ started: true, ...snapshot }, null, 2)}\n`);
  }
  if (parsed.once) {
    await control.stop();
    return;
  }

  // Orphan watchdog: if the supervising CLI wrapper died (kill -9, terminal
  // closed, wrapper crashed) this bot must not outlive it — a zombie keeps
  // platform connections alive and keeps watching project files.
  const reportStopError = (error: unknown): void => {
    options.writeError(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  };
  const orphanWatchdog = startSupervisorWatchdog(() => {
    void control.stop().then(() => process.exit(0), (error) => {
      reportStopError(error);
      process.exit(1);
    });
  });
  const disposeProcessLifecycle = installProcessLifecycle({
    process: nodeProcessLifecycleAdapter,
    requestStop: () => control.stop(),
    reportError: reportStopError,
  });
  try { await completed; }
  finally {
    clearInterval(orphanWatchdog);
    disposeProcessLifecycle();
  }
}

interface ConfiguredAgentHost {
  readonly bindings: NonNullable<ReadinessSource['agentBindings']>;
  attach(snapshots: import('@zhin.js/plugin-runtime').SnapshotReader): void;
  install(options: {
    readonly im: ImRuntime;
    readonly projectRoot: string;
    readonly resolveEndpointOwner: (adapter: string, endpoint: string) => string | undefined;
    readonly resolveEndpointTrusted: (adapter: string, endpoint: string) => readonly string[];
    readonly resolveConfiguredEndpointKeys: () => Promise<ReadonlySet<string>>;
    readonly extraTools?: readonly unknown[];
    readonly audioTranscriber?: import('@zhin.js/agent').AudioTranscriptionPort;
    readonly transcribeUrl?: (url: string) => Promise<string | null>;
  }): RootResourceInstaller;
}

async function loadConfiguredAgentHost(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<ConfiguredAgentHost | undefined> {
  const document = isConfigDocumentPort(config) ? (await config.read()).document : config;
  if (!hasAgentConfiguration(document)) return undefined;
  const [agentHost, workroom] = await Promise.all([
    import('./agent/module.js'),
    import('./workroom/module.js'),
  ]);
  const { agentHostToken } = await import('@zhin.js/agent/runtime');
  const initialAi = await agentHost.resolveAiConfig(document);
  const workroomStorageMode = agentHost.resolveWorkroomStorageMode(initialAi);
  const runtime = new agentHost.AgentRuntime({ coordinator: new agentHost.AgentTurnCoordinator() });
  let snapshotReader: import('@zhin.js/plugin-runtime').SnapshotReader | undefined;
  let localWorkroomDataGovernance: ReturnType<
    typeof workroom.createLocalWorkroomDataGovernanceAuthority
  > | undefined;
  const configured: ConfiguredAgentHost = {
    bindings: (snapshot) => {
      const port = snapshot.resources.get(snapshot.root)?.get(agentHostToken.id) as
        import('@zhin.js/agent/runtime').AgentHostPort | undefined;
      return port?.protocol.listBindings() ?? [];
    },
    attach: (snapshots) => {
      snapshotReader = snapshots;
      runtime.attach(snapshots);
    },
    install: (options) => {
      if (!snapshotReader) throw new Error('Agent Host Snapshot reader is not attached');
      localWorkroomDataGovernance ??= workroom.createLocalWorkroomDataGovernanceAuthority({
        stateRoot: join(options.projectRoot, '.zhin'),
      });
      return agentHost.installAgentHost({
        ...options,
        runtime,
        snapshots: snapshotReader,
        workroomStorageMode,
        workroomTrustedPackPublishers: agentHost.resolveWorkroomTrustedPackPublishers(initialAi),
        workroomLocalDataGovernance: localWorkroomDataGovernance,
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
  if (Object.hasOwn(ai, 'workrooms')) {
    throw new Error(
      'ai.workrooms removed; manage the persistent Workroom Catalog through Console or its repository API',
    );
  }
  if (Object.hasOwn(ai, 'remoteAgents')) {
    throw new Error(
      'ai.remoteAgents removed; register a governed Workroom A2A Executor through the persistent Catalog and generation resources',
    );
  }
  if (Object.hasOwn(ai, 'remote_mesh')) {
    throw new Error(
      'ai.remote_mesh removed; use the fenced Workroom Assignment A2A transport instead of a parallel remote Task state machine',
    );
  }
  if (Object.hasOwn(ai, 'remoteMesh')) {
    throw new Error(
      'ai.remoteMesh removed; use the fenced Workroom Assignment A2A transport instead of a parallel remote Task state machine',
    );
  }
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  return Boolean(value && typeof value === 'object'
    && typeof (value as Partial<ConfigDocumentPort>).read === 'function');
}

function printFirstRunGuidance(httpAddress: string, tokenConfigured: boolean): void {
  const startup = getLogger('setup');
  const consoleUrl = `${REMOTE_CONSOLE_URL}?host=${encodeURIComponent(`http://${httpAddress}`)}`;
  startup.info(`Remote Console: ${consoleUrl}${tokenConfigured ? chalk.dim(' (token required)') : ''}`);
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

/**
 * Endpoint master / trusted 解析器。
 * master 来源：plugins.<key>.master、plugins.<key>.endpoints[].master（+ name 别名键）。
 * trusted 来源：plugins.<key>.trusted、plugins.<key>.endpoints[].trusted（数组或空白/逗号分隔字符串）。
 * 不读 owner/admin：那是群/频道平台身份，不是框架 master。
 */
export async function createEndpointRoleResolver(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<{
  resolveOwner: (adapterLocalName: string, endpointKey: string) => string | undefined;
  resolveTrusted: (adapterLocalName: string, endpointKey: string) => readonly string[];
}> {
  const document = await readConfigDocumentValue(config);
  const map = new Map<string, string>();
  const trustedMap = new Map<string, string[]>();
  if (!document || typeof document !== 'object') {
    return { resolveOwner: () => undefined, resolveTrusted: () => [] };
  }
  const plugins = readPluginConfigurationMap(document as Record<string, unknown>);
  const addMaster = (key: string, raw: unknown) => {
    if (raw == null || String(raw).trim() === '') return;
    map.set(key, String(raw));
  };
  const addTrusted = (key: string, raw: unknown) => {
    const ids = normalizeTrustedIdList(raw);
    if (ids.length === 0) return;
    trustedMap.set(key, [...new Set([...(trustedMap.get(key) ?? []), ...ids])]);
  };
  const expanded = expandEnvironmentValue(plugins, (key) => process.env[key]) as Record<string, unknown>;
  for (const [pluginKey, raw] of Object.entries(expanded)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const cfg = raw as Record<string, unknown>;
    const nameKey = cfg.name != null && String(cfg.name).trim() !== '' ? String(cfg.name) : undefined;
    addMaster(pluginKey, cfg.master);
    if (nameKey) addMaster(nameKey, cfg.master);
    addTrusted(pluginKey, cfg.trusted);
    if (nameKey) addTrusted(nameKey, cfg.trusted);
    if (Array.isArray(cfg.endpoints)) {
      for (const entry of cfg.endpoints) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const ep = entry as Record<string, unknown>;
        const epName = ep.name != null && String(ep.name).trim() !== '' ? String(ep.name) : undefined;
        // 仅挂到 endpoint 名，避免多账号时互相污染插件键
        if (epName) {
          addMaster(epName, ep.master);
          addTrusted(epName, ep.trusted);
        }
      }
    }
  }
  return {
    resolveOwner: (adapterLocalName, endpointKey) =>
      map.get(endpointKey) ?? map.get(adapterLocalName),
    resolveTrusted: (adapterLocalName, endpointKey) => [
      ...new Set([
        ...(trustedMap.get(endpointKey) ?? []),
        ...(trustedMap.get(adapterLocalName) ?? []),
      ]),
    ],
  };
}

/** Reads Bot Endpoint identities from the candidate config, not the old live ImRuntime. */
export async function readConfiguredEndpointKeys(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<ReadonlySet<string>> {
  const document = await readConfigDocumentValue(config);
  const keys = new Set<string>();
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

/** trusted id 归一：数组逐项、字符串按空白/逗号拆分（对齐 legacy normalizeEndpointIdList）。 */
function normalizeTrustedIdList(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((v) => String(v).trim()).filter(Boolean);
  if (typeof input === 'string') {
    return input.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

async function createSenderEnricher(
  config: RuntimeConfigDocument | ConfigDocumentPort,
  endpointRoles: Awaited<ReturnType<typeof createEndpointRoleResolver>>,
): Promise<NonNullable<ConstructorParameters<typeof ImRuntime>[0]>['enrichSender']> {
  const document = await readConfigDocumentValue(config);
  const ai = (document as Record<string, unknown> | undefined)?.ai as
    | { trigger?: { masters?: unknown; trusted?: unknown } }
    | undefined;
  const globalMasters = normalizeTrustedIdList(ai?.trigger?.masters);
  const globalTrusted = normalizeTrustedIdList(ai?.trigger?.trusted);

  return (sender, conversation) => {
    if (!sender?.id) return sender;
    const senderId = sender.id;
    const capId = String(conversation.endpoint.id);
    const parts = capId.split('\0');
    const adapterLocalName = (parts.length >= 3 ? parts[2]! : capId).split('~')[0]!;
    const endpointKey = sender.name ?? adapterLocalName;

    const endpointMaster = endpointRoles.resolveOwner(adapterLocalName, endpointKey);
    const endpointTrustedIds = endpointRoles.resolveTrusted(adapterLocalName, endpointKey);

    const isMaster = globalMasters.includes(senderId)
      || (endpointMaster != null && senderId === endpointMaster);
    const isTrusted = !isMaster
      && (globalTrusted.includes(senderId) || endpointTrustedIds.includes(senderId));

    if (!isMaster && !isTrusted) return sender;

    const role = isMaster ? 'master' : 'trusted';
    const existing = sender.roles ?? [];
    if (existing.includes(role)) return sender;
    return { ...sender, roles: [role, ...existing] };
  };
}

async function applyRuntimeLogLevel(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<void> {
  const document = await readConfigDocumentValue(config);
  if (!document || typeof document !== 'object') return;
  const raw = (document as Record<string, unknown>).log_level;
  if (raw === undefined || raw === null) return;
  // Prefer config; allow ZHIN_LOG_LEVEL / LOG_LEVEL to override for one-shot debug.
  const envLevel = process.env.ZHIN_LOG_LEVEL ?? process.env.LOG_LEVEL;
  setLevel((envLevel ?? raw) as LogLevelInput, undefined, true);
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
): Promise<{ config: RuntimeConfigDocument | ConfigDocumentPort; file: string | undefined }> {
  const candidates = [
    'config.yml', 'config.yaml', 'config.json',
    'zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json',
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    const file = join(root, candidate);
    try { await access(file); existing.push(file); }
    catch { /* Missing candidates are expected. */ }
  }
  if (existing.length > 1) {
    throw new Error(`Multiple Root config files found: ${existing.join(', ')}`);
  }
  const file = existing[0];
  if (!file) return { config: Object.freeze({}), file: undefined };
  if (file.endsWith('.yml') || file.endsWith('.yaml')) {
    return { config: new YamlConfigDocument(file), file };
  }
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} must contain an object`);
  }
  return { config: Object.freeze(value as RuntimeConfigDocument), file };
}
