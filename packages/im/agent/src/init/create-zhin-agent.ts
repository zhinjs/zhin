/**
 * Create ZhinAgent global brain and wire up sub-systems
 * (follow-up sender, subagent manager, cron engine, scheduler).
 */
import * as path from 'node:path';
import { formatCompact, getPlugin, getScheduler, isZhinTool, Scheduler, setScheduler, type SendOptions, type Plugin, createSyntheticMessage, type Message, defineContext } from '@zhin.js/core';
import { createProactiveOutboundService } from '../outbound/send-proactive.js';
import { composeZhinAgentRuntime } from './compose-zhin-agent-runtime.js';
import { ModelRegistry, computeTierScore, InMemoryMemoryEntryRepository, type AIConfig } from '@zhin.js/ai';
import { provideMemoryEntryRepository } from '../memory-entry-registry.js';
import { ZhinAgent } from '../zhin-agent/index.js';
import { createBuiltinTools } from '../builtin-tools.js';
import { createGenerateImageTool } from '../builtin/generate-image-tool.js';
import { discoverWorkspaceAgents } from '../discovery/agents.js';
import {
  DEFAULT_CONFIG,
  DEFAULT_HARD_ORCHESTRATOR_TOOLS,
  DEFAULT_ALWAYS_LOADED_TOOLS,
  type ZhinAgentConfig,
} from '../config/index.js';
import { ScheduleEngine, getScheduleEngine, setScheduleEngine } from '@zhin.js/kernel';
import { DisposeStack } from '@zhin.js/plugin-runtime';
import { createTaskExecutor } from '../task-executor.js';
import {
  AssistantEventIngress,
  ScheduleJobEngine,
  JobWorker,
  ScheduleJobStore,
  createScheduleJobStoreFromConfig,
  createNotificationRouter,
  loadAssistantProfileFile,
  parseJobNotify,
  syncProfileHeartbeatToStore,
  syncProfileRoutinesToStore,
  pruneStaleProfileCronJobs,
  validateAssistantProfile,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  resolveAssistantQueueConfig,
  provideAssistantRuntime,
  type AssistantConfig,
} from '../assistant/index.js';
import type { AIServiceRefs } from './shared-refs.js';
import { activateAiDatabaseStorage } from './activate-ai-database-storage.js';
import { wireCollaborationStorage } from '../collaboration/wire-collaboration-storage.js';
import {
  createSessionTreeRuntimeFromAgent,
  provideSessionTreeRuntime,
} from '../session-tree-runtime-registry.js';
import { createAgentSessionHostPort, type AgentSessionHostPort } from '../session/agent-session-host-port.js';
import { MemoryOrchestrationRepository } from '../orchestrator/orchestration-repository.js';
import {
  createOrchestrationService,
  provideOrchestrationService,
} from '../orchestrator/orchestration-service.js';
import {
  createOrchestrationRuntimeFromService,
  provideOrchestrationRuntime,
} from '../orchestration-runtime-registry.js';
import { registerDefaultExecutors } from '../orchestrator/bootstrap-executors.js';
import { provideRemoteAgentRegistry } from '../orchestrator/remote-agent-registry.js';
import { provideRemoteTaskPoller } from '../orchestrator/remote-task-poller.js';
import { provideTaskQueue } from '../orchestrator/task-queue.js';
import { asPrivate } from '../internal/as-private.js';
import type { AIService } from '../service.js';
/** yaml 中显式 models 列表：覆盖 provider.models 与 ModelRegistry 缓存，避免 /v1/models 发现结果污染白名单 */
function applyExplicitModelLists(ai: AIService, modelRegistry: ModelRegistry): void {
  for (const alias of ai.listProviders()) {
    if (!ai.hasExplicitModelList(alias)) continue;
    const ids = ai.getRoutingConfig().providers[alias]?.models ?? [];
    if (ids.length === 0) continue;
    ai.getProvider(alias).models = [...ids];
    modelRegistry.seedProviderModels(alias, ids);
  }
}

function seedProviderModelsFromRegistry(ai: AIService, modelRegistry: ModelRegistry): void {
  for (const alias of ai.listProviders()) {
    if (ai.hasExplicitModelList(alias)) continue;
    const cached = modelRegistry.getModels(alias);
    if (cached.length === 0) continue;
    ai.getProvider(alias).models = cached
      .sort((a, b) => computeTierScore(b.id) - computeTierScore(a.id))
      .map(m => m.id);
  }
}

export function createZhinAgentContext(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    // Generation-scoped 注册表统一挂这个 lifecycle；下方 teardown 统一 dispose。
    const generationLifecycle = new DisposeStack();
    if (!ai.isReady()) {
      logger.warn('AI service not ready, skipping agent creation');
      return;
    }

    const zhinBinding = ai.getBindingRegistry().requireZhinBinding();
    const provider = ai.getProvider(zhinBinding.providerAlias);
    const configService = root.inject('config');
    const appConfig = (configService?.primaryFile
      ? configService.getRaw<{ ai?: AIConfig; assistant?: AssistantConfig; collaboration?: unknown }>(configService.primaryFile)
      : configService?.getPrimary<{ ai?: AIConfig; assistant?: AssistantConfig; collaboration?: unknown }>())
      ?? {};
    const agentConfig = ai.getAgentConfig();
    const semanticMemory = appConfig.ai?.memory?.semantic?.enabled === true;
    const knowledgeDir = appConfig.ai?.knowledge?.baseDir
      ? path.resolve(appConfig.ai.knowledge.baseDir)
      : path.join(process.cwd(), 'knowledge');
    const deferredFromConfig = (agentConfig as ZhinAgentConfig | undefined)?.deferredTools
      ?? appConfig.ai?.agent?.deferredTools;
    let alwaysLoadedTools = deferredFromConfig?.alwaysLoadedTools
      ?? [...DEFAULT_ALWAYS_LOADED_TOOLS];
    if (semanticMemory) {
      for (const name of ['memory_search', 'memory_upsert'] as const) {
        if (!alwaysLoadedTools.includes(name)) {
          alwaysLoadedTools = [...alwaysLoadedTools, name];
        }
      }
    }
    if (!alwaysLoadedTools.includes('knowledge_search')) {
      alwaysLoadedTools = [...alwaysLoadedTools, 'knowledge_search'];
    }
    const zhinAgentCfg: ZhinAgentConfig = {
      ...(agentConfig as ZhinAgentConfig | undefined),
      chatModel: zhinBinding.model,
      deferredTools: {
        ...deferredFromConfig,
        alwaysLoadedTools,
      },
    };
    const agent = new ZhinAgent(provider, zhinAgentCfg);
    refs.zhinAgent = agent;
    provideSessionTreeRuntime({ lifecycle: generationLifecycle }, createSessionTreeRuntimeFromAgent(asPrivate(agent)));
    void provideRemoteAgentRegistry({ lifecycle: generationLifecycle }, appConfig.ai).then((registry) => registry.healthCheckAll());
    provideRemoteTaskPoller({ lifecycle: generationLifecycle }, { intervalMs: 15_000 });
    agent.configure({
      hostPlugin: root,
      providerResolver: (alias) => ai.getProvider(alias),
      activeBinding: zhinBinding,
    });
    const assistantCfg = resolveAssistantConfig(appConfig.assistant);
    const useDb = appConfig.ai?.sessions?.useDatabase !== false;
    const db = root.inject('database' as keyof Plugin.Contexts) as
      | { models?: Map<string, unknown> }
      | undefined;
    // Always initialise the kernel synchronously with a Memory repository. The
    // DB activation path upgrades it in-place via upgradeOrchestrationRepository,
    // preserving registered executors/strategies. This eliminates the startup
    // window where getOrchestrationService() was null (ADR 0027).
    const orchService = createOrchestrationService(new MemoryOrchestrationRepository());
    provideOrchestrationService({ lifecycle: generationLifecycle }, orchService);
    provideOrchestrationRuntime({ lifecycle: generationLifecycle }, createOrchestrationRuntimeFromService(orchService));
    if (!useDb) {
      if (semanticMemory) {
        provideMemoryEntryRepository({ lifecycle: generationLifecycle }, new InMemoryMemoryEntryRepository());
      }
      agent.markMemoryPersistenceReady();
      void wireCollaborationStorage(undefined, appConfig.collaboration);
    } else if (db) {
      void activateAiDatabaseStorage(db, refs, appConfig.ai || {}, appConfig.collaboration)
        .catch((e) => logger.error('AI Session: database setup failed:', e))
        .finally(() => agent.markMemoryPersistenceReady());
    } else {
      // useDb requested but no database plugin present: keep the Memory kernel.
      agent.markMemoryPersistenceReady();
    }

    const orchestrator = root.inject('agent');
    let agentSessionHost: AgentSessionHostPort | null = null;
    if (orchestrator) {
      agent.configure({
        skillRegistry: orchestrator.skills,
        orchestrator,
      });

      agentSessionHost = createAgentSessionHostPort({
        getAgent: () => agent,
        bus: orchestrator.agentStreamBus,
      });
      asPrivate(agent).httpApprovalAdapter = agentSessionHost.httpApprovalAdapter;
      plugin.provide(defineContext({
        name: 'agentSessionHost',
        description: 'HTTP agent session host port (ADR 0041)',
        value: agentSessionHost,
        dispose: (port) => { port?.dispose(); },
      }));

    }

    // Model Registry: discover models and wire to agent
    const dataDir = path.join(process.cwd(), 'data');
    const modelRegistry = new ModelRegistry(dataDir);
    const hadCache = modelRegistry.loadCache();
    applyExplicitModelLists(ai, modelRegistry);
    agent.configure({ modelRegistry });
    ai.setModelRegistry(modelRegistry);
    seedProviderModelsFromRegistry(ai, modelRegistry);
    ai.refreshLlmApiRegistry();
    // Discover models in background (don't block startup)
    (async () => {
      try {
        for (const alias of ai.listProviders()) {
          if (ai.hasExplicitModelList(alias)) continue;
          const p = ai.getProvider(alias);
          const discovered = await modelRegistry.discover(p);
          if (discovered.length > 0) {
            p.models = discovered
              .sort((a, b) => computeTierScore(b.id) - computeTierScore(a.id))
              .map(m => m.id);
          }
          if (hadCache) {
            logger.debug(`ModelRegistry: refreshed ${discovered.length} models from ${alias}`);
          } else {
            logger.debug(formatCompact({ provider: alias, models: discovered.length }));
          }
        }
        modelRegistry.saveCache();
      } catch (e) {
        logger.warn(formatCompact({ error: (e as Error).message }));
      }
    })();

    // Subagent manager for background tasks
    const orchestratorEarly = root.inject('agent');
    agent.initSubagentSystem(() => {
      const zhinTools = [
        ...createBuiltinTools({
          plugin,
          semanticMemory,
          knowledgeDir,
        }),
        createGenerateImageTool(
          (alias) => ai.getProvider(alias),
          (alias) => ai.getImageGenerationDefaults(alias),
        ),
      ];
      return zhinTools.map(item => {
        const t = isZhinTool(item) ? item.toTool() : item;
        return {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          source: 'builtin',
          execute: t.execute as (args: Record<string, any>) => Promise<unknown>,
          tags: t.tags,
          keywords: t.keywords,
        };
      });
    });
    agent.getSubagentSystem()?.configureRouting({
      getProvider: (alias) => ai.getProvider(alias),
      resolveBinding: (name) => ai.getBindingRegistry().getBinding(name),
      getMcpRegistry: () => orchestratorEarly?.mcps ?? null,
      resolveAgentMeta: async (name) => {
        const metas = await discoverWorkspaceAgents(root);
        return metas.find((m) => m.name === name) ?? null;
      },
      getParentContextSnapshot: (origin) => agent.buildParentContextSnapshotForSubagent(origin),
    });
    // Unified task executor — single execution+delivery path for cron/scheduler/subagent
    const resolveAdapter = (platform: string) => {
      const adapter = root.inject(platform) as { sendMessage?: (opts: SendOptions) => Promise<string> } | undefined;
      if (adapter && typeof adapter.sendMessage === 'function') return adapter as { sendMessage: (opts: SendOptions) => Promise<string> };
      return undefined;
    };
    const defaultNotifyCfg = assistantCfg.enabled
      ? {
          notifyOnFailure: resolveAssistantDefaultsConfig(assistantCfg.defaults).notifyOnFailure,
          notify: assistantCfg.defaults?.notify
            ? parseJobNotify(assistantCfg.defaults.notify)
            : undefined,
        }
      : { notify: undefined, notifyOnFailure: false };
    const proactiveOutbound = createProactiveOutboundService({ plugin: root, resolveAdapter });
    const notificationRouter = createNotificationRouter({
      resolveAdapter,
      sendIm: async (notify, content, source) => {
        await proactiveOutbound.send({
          scene: notify.target.scene,
          source: (source ?? 'notification') as import('../outbound/send-proactive.js').ProactiveSendSource,
        }, content);
      },
    });
    const executor = createTaskExecutor({
      agent,
      resolveAdapter,
      dataDir,
      defaultNotify: defaultNotifyCfg.notify,
      router: notificationRouter,
    });

    const composed = composeZhinAgentRuntime(agent, provider, proactiveOutbound);
    const { deliverOutbound } = composed;
    const wiredAgentConfig = {
      ...DEFAULT_CONFIG,
      ...(agentConfig as import('../config/index.js').ZhinAgentConfig | undefined),
    } as Required<import('../config/index.js').ZhinAgentConfig>;
    agent.configure({
      agentCore: composed.agentCore,
      toolSystem: composed.toolSystem,
      contextSystem: composed.contextSystem,
      memorySystem: composed.memorySystem,
      sessionSystem: composed.sessionSystem,
      eventSystem: composed.eventSystem,
      ...(wiredAgentConfig.subagentDirectImDelivery
        ? { subagentSender: deliverOutbound }
        : {}),
      deferredResultSender: deliverOutbound,
    });

    // Register default kernel executors now that the subagent manager and sender
    // are configured. Registration is idempotent and survives the Memory → DB
    // repository upgrade (ADR 0027). five-agent WorkflowStrategy is opt-in.
    registerDefaultExecutors(orchService, { refs });

    let jobEngine: ScheduleJobEngine | null = null;
    let jobWorker: JobWorker | null = null;
    const scheduleFeature = root.inject('schedule') as import('@zhin.js/core').ScheduleFeature | undefined;
    if (!getScheduleEngine()) {
      setScheduleEngine(new ScheduleEngine());
    }
    const store = createScheduleJobStoreFromConfig(dataDir, {
      defaultNotify: defaultNotifyCfg.notify,
    });
    const queueCfg = resolveAssistantQueueConfig(assistantCfg.queue, assistantCfg.enabled);
    if (queueCfg.enabled) {
      provideTaskQueue({ lifecycle: generationLifecycle }, {
        maxConcurrency: queueCfg.maxConcurrency,
        defaultMaxRetries: queueCfg.maxRetries,
        defaultTimeout: queueCfg.defaultTimeoutMs,
        enableDAG: false,
      });
    }
    jobWorker = new JobWorker({
      executor,
      queue: assistantCfg.queue,
      assistantEnabled: assistantCfg.enabled,
    });
    jobEngine = new ScheduleJobEngine({
      store,
      worker: jobWorker,
      notifyOnFailure: defaultNotifyCfg.notifyOnFailure,
      router: notificationRouter,
      defaultNotify: defaultNotifyCfg.notify,
    });

    void (async () => {
      try {
        if (assistantCfg.enabled) {
          const profile = await loadAssistantProfileFile(process.cwd(), assistantCfg.profile);
          if (profile) {
            for (const err of validateAssistantProfile(profile)) {
              logger.warn(formatCompact({ assistant_profile: err }));
            }
          }
          await syncProfileHeartbeatToStore(store, profile);
          await syncProfileRoutinesToStore(store, profile);
          await pruneStaleProfileCronJobs(store, profile);
        }
      } catch (e) {
        logger.warn('Profile sync failed: ' + ((e as Error)?.message || String(e)));
      }
      await jobEngine!.load();
    })().catch((e) => {
      logger.warn('Schedule load failed: ' + ((e as Error)?.message || String(e)));
    });

    if (assistantCfg.enabled) {
      const ingress = new AssistantEventIngress({
        store,
        engine: jobEngine,
        eventsConfig: assistantCfg.events,
      });
      provideAssistantRuntime({ lifecycle: generationLifecycle }, {
        config: assistantCfg,
        store,
        engine: jobEngine,
        ingress,
      });
      logger.debug(formatCompact({
        assistant_runtime: true,
        events: ingress.isEnabled(),
        profile: assistantCfg.profile?.enabled === true,
      }));
    }

    // HEARTBEAT.md 周期检查（与 schedule-jobs 并行）
    if (!assistantCfg.enabled) {
      const scheduler = new Scheduler({
        storePath: path.join(dataDir, 'scheduler-jobs.json'),
        workspace: process.cwd(),
        heartbeatEnabled: true,
        onJob: async (job) => {
          if (!refs.zhinAgent) return;
          const now = Date.now();
          await executor.execute({
            id: `heartbeat-${job.id}`,
            enabled: true,
            schedule: { kind: 'at', atMs: now },
            action: { kind: 'heartbeat', prompt: job.payload.message },
            notify: { channel: 'silent' },
            createdAt: now,
            updatedAt: now,
            state: {},
            source: 'profile',
          });
        },
      });
      setScheduler(scheduler);
      scheduler.start().catch((e) => logger.warn(formatCompact({ error: (e as Error).message })));
    } else {
      setScheduler(null);
    }

    logger.debug('ZhinAgent created');
    return () => {
      // orchestration runtime/service、session tree、assistant、schedule manager
      // 统一经 generation store 反注册（此前 orchestration runtime 漏清，跨热重载泄漏）
      void generationLifecycle.dispose();
      agentSessionHost = null;
      setScheduleEngine(null);
      if (jobEngine) {
        jobEngine.unload();
        jobEngine = null;
      }
      if (jobWorker) {
        jobWorker.stop();
        jobWorker = null;
      }
      const s = getScheduler();
      if (s) {
        s.stop();
        setScheduler(null);
      }
      agent.dispose();
      refs.zhinAgent = null;
    };
  });
}
