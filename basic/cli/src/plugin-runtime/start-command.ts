import { migrateConversationColumns, migrateInboxColumns } from './conversation-migration.js';
import type { StructuredDatabase } from '@zhin.js/database';
import { assertNoPendingInstanceMigration } from './migrate/instance-declarations.js';
import { assertNotLegacyConfig } from '../utils/legacy-config.js';
import { access, readFile } from 'node:fs/promises';
import { PluginManagementActivity } from '../plugin-management/activity.js';
import { join, relative } from 'node:path';
import chalk from 'chalk';
import open from 'open';
import { createConfigDocument, type ConfigFileDocument } from '@zhin.js/config-file';
import { adapterFeatureId, isAdapterIndex, endpointConfigurationStoreToken } from '@zhin.js/adapter';
import { ImRuntime, type Message } from '@zhin.js/core/runtime';
import {
  CONVERSATION_CURSOR_MODEL,
  CONVERSATION_EVENT_MODEL,
  DatabaseConversationEventStore,
  type ConversationDbModel,
} from '@zhin.js/im-contract';
import { createConsoleEventHub, createHttpHostGroup } from '@zhin.js/host-http';
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
} from '@zhin.js/plugin-runtime';
import { setLevel, getLogger, formatCompact, type LogLevelInput } from '@zhin.js/logger';
import {
  ConfigValidationError,
  createEnvStore,
  envStoreToken,
  type RootResourceInstaller,
  ensureTypeScriptSpecifierRemap,
  expandEnvironmentValue,
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
  HostToolApprovals,
  HostSelfChanges,
  composeHostConsoleRpc,
} from './console/module.js';
import { installHttpHost, resolveHttpConfig } from './http-host-installer.js';
import { createDatabaseHost, installDatabaseHost, resolveDatabaseConfig } from './database-host-installer.js';
import { installLocaleHost } from './locale-host-installer.js';
import { installHtmlRendererHost, prepareHtmlRendererHost } from './html-renderer-host-installer.js';
import { installComponentHost } from './component-host-installer.js';
import { installOutboundHost } from './outbound-host-installer.js';
import { installScheduleHost, createScheduleHost } from './schedule-host-installer.js';
import { installSpeechHost, prepareSpeechHost, resolveSpeechConfig } from './speech-host-installer.js';
import { installProtocolHosts } from './protocol-host-installer.js';
import { ProjectEndpointConfigurationStore } from './endpoint-configuration-store.js';
import { RootHost } from './root-host.js';
import { HostSelfChangeApply } from './self-change-apply.js';
import { registerReadinessRoutes, type ReadinessSource } from './readiness.js';
import {
  createPluginLifecycleStore,
  readProjectPluginLifecycleState,
  resolvePluginLifecycleFile,
} from './plugin-lifecycle-store.js';
import { installProcessLifecycle, nodeProcessLifecycleAdapter } from './process-lifecycle.js';
import { installProcessRejectionHandler } from './process-rejections.js';
import {
  ProjectEnvironmentFileSource,
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
  const hostConfig = hostEnvironment.expandMissingAsEmpty((await config.read()).document);
  const pluginLifecycleFile = resolvePluginLifecycleFile(options.root);
  await readProjectPluginLifecycleState(options.root, pluginLifecycleFile);
  const pluginLifecycleStore = createPluginLifecycleStore(options.root);
  await applyRuntimeLogLevel(hostConfig);
  const envOverlay = environmentVariables.environments?.[parsed.environment];
  const httpConfig = await resolveHttpConfig(hostConfig, envOverlay, options.root);
  const {listeners: additionalHttpListeners = [], ...primaryHttpListener} = httpConfig;
  const httpHost = createHttpHostGroup([primaryHttpListener, ...additionalHttpListeners]);
  const databaseConfig = await resolveDatabaseConfig(options.root, hostConfig);
  // Agent is an optional install tier. Do not resolve its module from the
  // IM-only startup graph unless the project actually configures Agent state.
  const agentHost = await loadConfiguredAgentHost(hostConfig, options.root);
  const endpointRoles = await createEndpointRoleResolver(hostConfig);
  const speechHandle = await prepareSpeechHost(await resolveSpeechConfig(hostConfig));
  const htmlRendererHost = await prepareHtmlRendererHost(hostConfig);
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  const control: { stop(): Promise<void> } = {
    stop: async () => { throw new Error('RootHost stop is not bound'); },
  };
  const senderEnricher = await createSenderEnricher(hostConfig, endpointRoles);
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
    await resolveSystemLogConfig(hostConfig),
  );
  const scheduleHost = createScheduleHost();
  const consoleHost = createConsoleHostModules(options.root, !parsed.once && !parsed.noWatch);
  // Console SSE 事件枢纽：/api/events 订阅方 + HMR/消息/配置事件 publish 方共享。
  const consoleEventHub = createConsoleEventHub();
  // 群聊插话 / 技能助手 Console status (#970): process-owned, survives HMR generations.
  const assistantStatus = new AssistantStatus();
  // 危险工具硬闸审批卡片（ADR 0036）：进程持有，绑定当前 generation 的 Agent 队列。
  const toolApprovals = new HostToolApprovals();
  // 受控自我进化审批（ADR 0040 §4）：进程持有，绑定当前 generation 的变更暂存区与审批。
  const selfChanges = new HostSelfChanges();
  const endpointConfigurationStore = new ProjectEndpointConfigurationStore({
    projectRoot: options.root,
    configFile,
    document: config,
  });
  const consoleConfigurationStore = new ConsoleConfigurationStore({
    projectRoot: options.root,
    document: config,
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
  // 受控自我进化生效（ADR 0040 §5 / §6）：进程持有热重载 / exit 75 / 健康检查 / 配置补丁；最新 generation 绑定生效器。
  const selfChangeApply = new HostSelfChangeApply({
    projectRoot: options.root,
    reload: sources => host.reloadSources(sources),
    restart: () => requestProcessRestart(),
    snapshot: () => host.runtime.snapshot,
    ownership: () => host.runtime.sourceOwnership,
    configuration: consoleConfigurationStore,
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
    environment: runtimeEnvironment,
    environmentVariables,
    environmentSource,
    disabledPluginInstanceKeys: [],
    installResources: async (context) => {
      await options.installTrustedResources?.(context);
      context.resources.provide(endpointConfigurationStoreToken, endpointConfigurationStore);
      im.install(context.resources);
      installHttpHost(httpHost)(context);
      installDatabaseHost(databaseHost)(context);
      installLocaleHost(databaseHost)(context);
      context.handoff.add({
        activateNext: async (signal) => {
          signal.throwIfAborted();
          const events = databaseHost.models.get('conversation_events');
          const cursors = databaseHost.models.get('conversation_event_cursors');
          if (!events || !cursors) {
            throw new Error('Conversation event database models are unavailable after DatabaseHost activation');
          }
          await migrateConversationColumns(databaseHost.getRawDatabase() as StructuredDatabase);
          await migrateInboxColumns(databaseHost.getRawDatabase() as StructuredDatabase);
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
          assistantStatus,
          toolApprovals,
          selfChanges,
          selfChangeApply,
          projectRoot: options.root,
          resolveEndpointOwner: endpointRoles.resolveOwner,
          resolveEndpointTrusted: endpointRoles.resolveTrusted,
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
        selfChangeApply.deferRestart(() => requestProcessRestart());
        return;
      }
      process.exitCode = processRestartExitCode;
      // 仅设置 exitCode，让事件循环自然结束，保证 stderr/管道日志完整写出。
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
  });
  const disposeConsoleControlPlane = startConsoleControlPlane({
    http: httpHost,
    console: consoleHost.console,
    projectRoot: options.root,
    apiBase: httpConfig.apiBase,
    im,
    databaseHost,
    scheduleHost,
    eventHub: consoleEventHub,
    hostConsoleRpc: composeHostConsoleRpc(assistantStatus.consoleRpc, toolApprovals.consoleRpc, selfChanges.consoleRpc),
    pluginLifecycleFile,
    pluginLifecycleStore,
    configuration: consoleConfigurationStore,
    pluginManagementActivity,
    snapshot: () => host.runtime.snapshot,
    snapshots: host.runtime.snapshots,
    onRestart: () => requestProcessRestart(),
  });
  function requestProcessRestart(): void {
    // The native TypeScript supervisor treats this code as an intentional
    // process-generation restart in both foreground Desktop and daemon mode.
    // 只设置 exitCode 并完整停止，进程在所有句柄释放后自然退出（端口随之释放）。
    process.exitCode = processRestartExitCode;
    void control.stop().catch((error: unknown) => {
      options.writeError(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
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
  const stopAll = async (): Promise<void> => {
    try {
      disposeReadiness();
      disposeConsoleControlPlane();
      // Process ingress owns WebSocket operation leases. Close it before Root
      // drain so long-lived connections release those leases instead of
      // deadlocking SnapshotStore.close().
      await stage('http', () => httpHost.close());
    } finally {
      try {
        await stage('runtime', () => host.stop());
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
    httpOrigin = address.origin;
    if (process.stdout.isTTY && !parsed.once) {
      const startup = getLogger('setup');
      startup.success(`zhin control plane listening at ${httpOrigin}`);
      printFirstRunGuidance(httpOrigin, Boolean(httpConfig.token));
      if (parsed.open || process.env.ZHIN_OPEN === '1') {
        openBrowser(createRemoteConsoleUrl(httpOrigin));
      }
    }
    snapshot = await host.start();
  } catch (error) {
    // #742: HTTP listens before the first generation is committed, so a
    // Console restart or a signal can request stop while host.start() is
    // still running. stop() aborts that start transaction on purpose; the
    // rejection is the expected consequence, not a startup failure. Let the
    // stop that is already running finish (it owns the cleanup) and return
    // normally so the requested exit code (75 restart, 130 signal) stands.
    if (stopping) {
      await stopping;
      return;
    }
    disposeReadiness();
    disposeConsoleControlPlane();
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
    const endpoints = im.endpoints.list();
    const online = endpoints.filter((ep) => ep.status === 'online').map((ep) => ep.name);
    const offline = endpoints.filter((ep) => ep.status !== 'online').map((ep) => ep.name);
    const startup = getLogger('setup');
    startup.success('zhin runtime started');
    startup.info(formatCompact({
      plugins: snapshot.plugins,
      http: httpOrigin,
    }));
    if (online.length > 0) {
      startup.info(`online: ${online.join(', ')}`);
    }
    if (offline.length > 0) {
      startup.info(`offline: ${offline.join(', ')}`);
    }
  } else {
    options.writeOutput(`${JSON.stringify({ started: true, ...snapshot }, null, 2)}\n`);
  }
  if (parsed.once) {
    await control.stop();
    return;
  }
  // ADR 0040 §6：启动完成后接续生效中 / 待校验的自我变更（健康检查、回滚、回报）。
  void selfChangeApply.started().catch(reportSelfChangeRecoverError);

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
    describePending: () => [...stoppingComponents],
    reportForcedExit: (reason, pending) => {
      options.writeError(`${JSON.stringify({ forcedExit: reason, stillStopping: pending })}\n`);
    },
    reportError: reportStopError,
  });
  try { await completed; }
  finally {
    clearInterval(orphanWatchdog);
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
  readonly bindings: NonNullable<ReadinessSource['agentBindings']>;
  attach(
    snapshots: import('@zhin.js/plugin-runtime').SnapshotReader,
    sourceOwnership?: () => import('@zhin.js/runtime').SourceOwnershipIndex,
  ): void;
  install(options: {
    readonly im: ImRuntime;
    readonly projectRoot: string;
    readonly resolveEndpointOwner: (adapter: string, endpoint: string) => string | undefined;
    readonly resolveEndpointTrusted: (adapter: string, endpoint: string) => readonly string[];
    readonly resolveConfiguredEndpointKeys: () => Promise<ReadonlySet<string>>;
    readonly extraTools?: readonly unknown[];
    readonly audioTranscriber?: import('@zhin.js/agent').AudioTranscriptionPort;
    readonly transcribeUrl?: (url: string) => Promise<string | null>;
    readonly assistantStatus?: AssistantStatus;
    readonly toolApprovals?: HostToolApprovals;
    readonly selfChanges?: HostSelfChanges;
    readonly selfChangeApply?: HostSelfChangeApply;
  }): RootResourceInstaller;
}

async function loadConfiguredAgentHost(
  config: RuntimeConfigDocument | ConfigDocumentPort,
  projectRoot: string,
): Promise<ConfiguredAgentHost | undefined> {
  const document = isConfigDocumentPort(config) ? (await config.read()).document : config;
  if (!hasAgentConfiguration(document)) return undefined;
  const agentHost = await import('./agent/module.js');
  // Only a missing @zhin.js/workroom package degrades; any other load failure aborts startup.
  const workroom = await agentHost.loadWorkroomHostModule();
  if (!workroom) getLogger('runtime').info('Workroom 未安装，仅启用 Agent');
  const { agentHostToken } = await import('@zhin.js/agent/runtime');
  const { createTurnTraceArchive, defaultTurnTraceDir, defaultTurnTraceFile, resolveTraceArchiveOptions } = await import('@zhin.js/agent/trace');
  // One writer across generations; persistence maintenance also prunes while the bot is idle.
  const turnTraceStore = createTurnTraceArchive(defaultTurnTraceDir(projectRoot), {
    ...resolveTraceArchiveOptions(),
    legacyFile: defaultTurnTraceFile(projectRoot),
  });
  const initialAi = await agentHost.resolveAiConfig(document);
  const workroomStorageMode = agentHost.resolveWorkroomStorageMode(initialAi);
  const runtime = new agentHost.AgentRuntime({
    coordinator: new agentHost.AgentTurnCoordinator(),
    turnTraceStore,
  });
  let snapshotReader: import('@zhin.js/plugin-runtime').SnapshotReader | undefined;
  let sourceOwnership: (() => import('@zhin.js/runtime').SourceOwnershipIndex) | undefined;
  let localWorkroomDataGovernance: ReturnType<
    NonNullable<typeof workroom>['createLocalWorkroomDataGovernanceAuthority']
  > | undefined;
  const configured: ConfiguredAgentHost = {
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
      localWorkroomDataGovernance ??= workroom?.createLocalWorkroomDataGovernanceAuthority({
        stateRoot: join(options.projectRoot, '.zhin'),
      });
      return agentHost.installAgentHost({
        ...options,
        pruneTraces: () => turnTraceStore.prune(),
        runtime,
        snapshots: snapshotReader,
        workroom,
        workroomStorageMode,
        workroomTrustedPackPublishers: agentHost.resolveWorkroomTrustedPackPublishers(initialAi),
        workroomLocalDataGovernance: localWorkroomDataGovernance,
        selfChangeImpact: agentHost.createSelfChangeImpactPort(sourceOwnership),
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

function createRemoteConsoleUrl(httpOrigin: string): string {
  return `${REMOTE_CONSOLE_URL}?host=${encodeURIComponent(httpOrigin)}`;
}

function printFirstRunGuidance(httpOrigin: string, tokenConfigured: boolean): void {
  const startup = getLogger('setup');
  const consoleUrl = createRemoteConsoleUrl(httpOrigin);
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
