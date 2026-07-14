/**
 * Create ZhinAgent global brain and wire up sub-systems
 * (follow-up sender, subagent manager, cron engine, scheduler).
 */
import * as path from 'node:path';
import { formatCompact, getPlugin, getScheduler, isZhinTool, Scheduler, setScheduler, type SendOptions, type Plugin, createSyntheticMessage, type Message, defineContext } from '@zhin.js/core';
import { createProactiveOutboundService } from '../outbound/send-proactive.js';
import { composeZhinAgentRuntime } from './compose-zhin-agent-runtime.js';
import { ModelRegistry, computeTierScore, InMemoryMemoryEntryRepository, type AIConfig } from '@zhin.js/ai';
import { setMemoryEntryRepository } from '../memory-entry-registry.js';
import { ZhinAgent } from '../zhin-agent/index.js';
import { createBuiltinTools } from '../builtin-tools.js';
import { createGenerateImageTool } from '../builtin/generate-image-tool.js';
import { collectPluginSkillSearchRoots } from '../discovery/utils.js';
import { discoverWorkspaceAgents } from '../discovery/agents.js';
import {
  resolveSkillInstructionMaxChars,
  DEFAULT_CONFIG,
  DEFAULT_HARD_ORCHESTRATOR_TOOLS,
  DEFAULT_ALWAYS_LOADED_TOOLS,
  type ZhinAgentConfig,
} from '../config/index.js';
import { setScheduleManager } from '../schedule-manager.js';
import { ScheduleEngine, getScheduleEngine, setScheduleEngine } from '@zhin.js/kernel';
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
  setAssistantRuntime,
  type AssistantConfig,
} from '../assistant/index.js';
import type { AIServiceRefs } from './shared-refs.js';
import { activateAiDatabaseStorage } from './activate-ai-database-storage.js';
import { wireCollaborationStorage } from '../collaboration/wire-collaboration-storage.js';
import {
  createSessionTreeRuntimeFromAgent,
  setSessionTreeRuntime,
} from '../session-tree-runtime-registry.js';
import { createAgentSessionHostPort, type AgentSessionHostPort } from '../session/agent-session-host-port.js';
import { getAgentRuntimeRegistry } from '../collaboration/runtime-registry.js';
import { MemoryOrchestrationRepository } from '../orchestrator/orchestration-repository.js';
import { initOrchestrationService } from '../orchestrator/orchestration-service.js';
import {
  createOrchestrationRuntimeFromService,
  setOrchestrationRuntime,
} from '../orchestration-runtime-registry.js';
import { registerDefaultExecutors } from '../orchestrator/bootstrap-executors.js';
import { initRemoteAgentRegistry } from '../orchestrator/remote-agent-registry.js';
import { startRemoteTaskPoller } from '../orchestrator/remote-task-poller.js';
import { asPrivate } from '../internal/as-private.js';
import type { AIService } from '../service.js';
import { createExecPolicyHook } from '../security/exec-policy-hook.js';
import { createFilePolicyHook } from '../security/file-policy-hook.js';
import { createDangerousToolPolicyHook } from '../security/dangerous-tool-policy-hook.js';
import { bootstrapEndpointRuntimes, markAllRuntimesPersistenceReady } from '../collaboration/bootstrap-agent-runtimes.js';
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
    if (!ai.isReady()) {
      logger.warn(formatCompact( { error: 'ai_not_ready' }));
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
    bootstrapEndpointRuntimes({
      refs,
      plugin,
      ai,
      primaryAgent: agent,
      agentConfig: zhinAgentCfg,
    });
    setSessionTreeRuntime(createSessionTreeRuntimeFromAgent(asPrivate(agent)));
    void initRemoteAgentRegistry(appConfig.ai).then((registry) => registry.healthCheckAll());
    startRemoteTaskPoller({ intervalMs: 15_000 });
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
    const orchService = initOrchestrationService(new MemoryOrchestrationRepository());
    setOrchestrationRuntime(createOrchestrationRuntimeFromService(orchService));
    if (!useDb) {
      if (semanticMemory) {
        setMemoryEntryRepository(new InMemoryMemoryEntryRepository());
      }
      markAllRuntimesPersistenceReady(agent);
      void wireCollaborationStorage(undefined, appConfig.collaboration);
    } else if (db) {
      void activateAiDatabaseStorage(db, refs, appConfig.ai || {}, appConfig.collaboration)
        .catch((e) => logger.error('AI Session: database setup failed:', e))
        .finally(() => markAllRuntimesPersistenceReady(agent));
    } else {
      // useDb requested but no database plugin present: keep the Memory kernel.
      markAllRuntimesPersistenceReady(agent);
    }

    const orchestrator = root.inject('agent');
    let agentSessionHost: AgentSessionHostPort | null = null;
    if (orchestrator) {
      agent.configure({
        skillRegistry: orchestrator.skills,
        orchestrator,
      });

      agentSessionHost = createAgentSessionHostPort({
        getAgent: () => getAgentRuntimeRegistry().getDefault(),
        bus: orchestrator.agentStreamBus,
      });
      asPrivate(agent).httpApprovalAdapter = agentSessionHost.httpApprovalAdapter;
      plugin.provide(defineContext({
        name: 'agentSessionHost',
        description: 'HTTP agent session host port (ADR 0041)',
        value: agentSessionHost,
        dispose: (port) => { port?.dispose(); },
      }));

      // Register security policy hooks (highest priority)
      const fullAgentConfig = asPrivate(agent).config;
      orchestrator.hooks.addPreToolUseHook(
        createExecPolicyHook(fullAgentConfig),
      );
      orchestrator.hooks.addPreToolUseHook(createFilePolicyHook());
      orchestrator.hooks.addPreToolUseHook(createDangerousToolPolicyHook());
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
      const modelName = zhinBinding.model || provider.models[0] || '';
      const fullConfig = { ...DEFAULT_CONFIG, ...agentConfig } as Required<import('../config/index.js').ZhinAgentConfig>;
      const zhinTools = [
        ...createBuiltinTools({
          plugin,
          semanticMemory,
          knowledgeDir,
          skillInstructionMaxChars: resolveSkillInstructionMaxChars(fullConfig, modelName),
          pluginSkillRootsResolver: () => collectPluginSkillSearchRoots(root),
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
      sendIm: async (notify, content) => {
        await proactiveOutbound.send({
          scene: notify.target.scene,
          source: 'notification',
        }, content);
      },
    });
    const executor = createTaskExecutor({
      agent,
      resolveAdapter,
      defaultNotify: defaultNotifyCfg.notify,
      router: notificationRouter,
      proactiveOutbound,
      deliverIm: async (notify, content) => {
        await proactiveOutbound.send({
          scene: notify.target.scene,
          source: 'scheduled',
        }, content);
      },
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
      jobEngine!.load();
    })().catch((e) => {
      logger.warn('Schedule load failed: ' + ((e as Error)?.message || String(e)));
      jobEngine?.load();
    });

    if (assistantCfg.enabled) {
      const ingress = new AssistantEventIngress({
        store,
        engine: jobEngine,
        eventsConfig: assistantCfg.events,
      });
      setAssistantRuntime({
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

    if (scheduleFeature) {
      setScheduleManager({
        scheduleFeature,
        engine: jobEngine,
        previewTask: (opts) => executor.executeTask({
          ...opts,
          preview: true,
          timeContext: false,
        }),
      });
    }

    // HEARTBEAT.md 周期检查（与 schedule-jobs 并行）
    if (!assistantCfg.enabled) {
      const scheduler = new Scheduler({
        storePath: path.join(dataDir, 'scheduler-jobs.json'),
        workspace: process.cwd(),
        heartbeatEnabled: true,
        onJob: async (job) => {
          if (!refs.zhinAgent) return;
          await executor.executeTask({
            prompt: job.payload.message,
            notify: { channel: 'silent' },
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
      setSessionTreeRuntime(null);
      agentSessionHost = null;
      setScheduleManager(null);
      setScheduleEngine(null);
      setAssistantRuntime(null);
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
