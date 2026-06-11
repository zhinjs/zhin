/**
 * Create ZhinAgent global brain and wire up sub-systems
 * (follow-up sender, subagent manager, cron engine, scheduler).
 */
import * as path from 'node:path';
import { formatCompact, getPlugin, getScheduler, isZhinTool, Scheduler, setScheduler, type SendOptions } from '@zhin.js/core';
import { deliverSubagentResult } from '../media/deliver-subagent-result.js';
import { ModelRegistry, computeTierScore, InMemoryMemoryEntryRepository } from '@zhin.js/ai';
import { setMemoryEntryRepository } from '../memory-entry-registry.js';
import { ZhinAgent } from '../zhin-agent/index.js';
import { createBuiltinTools } from '../builtin-tools.js';
import { createGenerateImageTool } from '../builtin/generate-image-tool.js';
import { createRunValidationSpecTool } from '../builtin/run-validation-spec-tool.js';
import { createRunSpecDryRunTool } from '../builtin/run-spec-dry-run-tool.js';
import { collectPluginSkillSearchRoots } from '../discovery/utils.js';
import { discoverWorkspaceAgents } from '../discovery/agents.js';

import {
  resolveSkillInstructionMaxChars,
  DEFAULT_CONFIG,
  DEFAULT_HARD_ORCHESTRATOR_TOOLS,
  type ZhinAgentConfig,
} from '../zhin-agent/config.js';
import { PersistentCronEngine, setCronManager } from '../cron-engine.js';
import { createTaskExecutor } from '../task-executor.js';
import {
  AssistantEventIngress,
  AssistantJobEngine,
  JobWorker,
  createAssistantJobStore,
  createNotificationRouter,
  loadAssistantProfileFile,
  syncProfileHeartbeatToStore,
  syncProfileCronRoutinesToStore,
  validateAssistantProfile,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  setAssistantRuntime,
  type AssistantConfig,
} from '../assistant/index.js';
import type { AIConfig, Plugin } from '@zhin.js/core';
import type { AIServiceRefs } from './shared-refs.js';
import { activateAiDatabaseStorage } from './activate-ai-database-storage.js';
import {
  createSessionTreeRuntimeFromAgent,
  setSessionTreeRuntime,
} from '../session-tree-runtime-registry.js';
import { MemoryOrchestrationRepository } from '../orchestrator/orchestration-repository.js';
import { initOrchestrationService } from '../orchestrator/orchestration-service.js';
import {
  createOrchestrationRuntimeFromService,
  setOrchestrationRuntime,
} from '../orchestration-runtime-registry.js';
import { initDelegationProcessor } from '../orchestrator/delegation-processor.js';
import { initRemoteAgentRegistry } from '../orchestrator/remote-agent-registry.js';
import { startRemoteTaskPoller } from '../orchestrator/remote-task-poller.js';
import { initMissionRunner } from '../orchestrator/mission-runner.js';
import type { ToolContext } from '@zhin.js/core';
import { asPrivate } from '../zhin-agent/zhin-agent-private.js';
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
    if (!ai.isReady()) {
      logger.warn(formatCompact( { error: 'ai_not_ready' }));
      return;
    }

    const zhinBinding = ai.getBindingRegistry().requireZhinBinding();
    const provider = ai.getProvider(zhinBinding.providerAlias);
    const configService = root.inject('config');
    const appConfig = (configService?.primaryFile
      ? configService.getRaw<{ ai?: AIConfig; assistant?: AssistantConfig }>(configService.primaryFile)
      : configService?.getPrimary<{ ai?: AIConfig; assistant?: AssistantConfig }>())
      ?? {};
    const agentConfig = ai.getAgentConfig();
    const semanticMemory = appConfig.ai?.memory?.semantic?.enabled === true;
    let orchestratorTools = (agentConfig as ZhinAgentConfig | undefined)?.orchestratorTools
      ?? appConfig.ai?.agent?.orchestratorTools
      ?? [...DEFAULT_HARD_ORCHESTRATOR_TOOLS];
    if (semanticMemory && orchestratorTools) {
      for (const name of ['memory_search', 'memory_upsert'] as const) {
        if (!orchestratorTools.includes(name)) {
          orchestratorTools = [...orchestratorTools, name];
        }
      }
    }
    const zhinAgentCfg: ZhinAgentConfig = {
      ...(agentConfig as ZhinAgentConfig | undefined),
      chatModel: zhinBinding.model,
      orchestratorTools,
    };
    const agent = new ZhinAgent(provider, zhinAgentCfg);
    refs.zhinAgent = agent;
    setSessionTreeRuntime(createSessionTreeRuntimeFromAgent(asPrivate(agent)));
    void initRemoteAgentRegistry(appConfig.ai).healthCheckAll();
    initDelegationProcessor({ zhinAgent: agent });
    startRemoteTaskPoller({ intervalMs: 15_000 });
    agent.setHostPlugin(root);
    agent.setProviderResolver((alias) => ai.getProvider(alias));
    agent.setActiveBinding(zhinBinding);
    const assistantCfg = resolveAssistantConfig(appConfig.assistant);
    const useDb = appConfig.ai?.sessions?.useDatabase !== false;
    const db = root.inject('database' as keyof Plugin.Contexts) as
      | { models?: Map<string, unknown> }
      | undefined;
    if (!useDb) {
      const orchService = initOrchestrationService(new MemoryOrchestrationRepository());
      setOrchestrationRuntime(createOrchestrationRuntimeFromService(orchService));
      if (semanticMemory) {
        setMemoryEntryRepository(new InMemoryMemoryEntryRepository());
      }
      agent.markMemoryPersistenceReady();
    } else if (db) {
      void activateAiDatabaseStorage(db, refs, appConfig.ai || {})
        .catch((e) => logger.error('AI Session: database setup failed:', e))
        .finally(() => agent.markMemoryPersistenceReady());
    } else {
      agent.markMemoryPersistenceReady();
    }

    const orchestrator = root.inject('agent');
    if (orchestrator) {
      agent.setSkillRegistry(orchestrator.skills);
      agent.setOrchestrator(orchestrator);
    }

    // Model Registry: discover models and wire to agent
    const dataDir = path.join(process.cwd(), 'data');
    const modelRegistry = new ModelRegistry(dataDir);
    const hadCache = modelRegistry.loadCache();
    applyExplicitModelLists(ai, modelRegistry);
    agent.setModelRegistry(modelRegistry);
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
    agent.initSubagentManager(() => {
      const modelName = zhinBinding.model || provider.models[0] || '';
      const fullConfig = { ...DEFAULT_CONFIG, ...agentConfig } as Required<import('../zhin-agent/config.js').ZhinAgentConfig>;
      const zhinTools = [
        ...createBuiltinTools({
          plugin,
          semanticMemory,
          skillInstructionMaxChars: resolveSkillInstructionMaxChars(fullConfig, modelName),
          pluginSkillRootsResolver: () => collectPluginSkillSearchRoots(root),
        }),
        // 与 registerBuiltinTools 一致：子 agent 须能 TF-IDF 载入 generate_image
        createGenerateImageTool(
          (alias) => ai.getProvider(alias),
          (alias) => ai.getImageGenerationDefaults(alias),
        ),
        createRunValidationSpecTool(),
        createRunSpecDryRunTool(),
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
    agent.getSubagentManager()?.configureRouting({
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
      ? resolveAssistantDefaultsConfig(assistantCfg.defaults)
      : { notify: undefined, notifyOnFailure: false };
    const notificationRouter = createNotificationRouter({ resolveAdapter });
    const executor = createTaskExecutor({
      agent,
      resolveAdapter,
      defaultNotify: defaultNotifyCfg.notify,
      router: notificationRouter,
    });

    const deliverOutbound = async (
      origin: Parameters<typeof deliverSubagentResult>[0]['origin'],
      delivery: Parameters<typeof deliverSubagentResult>[0]['delivery'],
    ) => {
      const adapter = resolveAdapter(origin.platform);
      if (!adapter) {
        logger.warn(formatCompact( { error: 'adapter_not_found', platform: origin.platform }));
        return;
      }
      await deliverSubagentResult({
        origin,
        delivery,
        send: (opts) => adapter.sendMessage(opts),
      });
    };
    agent.setSubagentSender(deliverOutbound);
    agent.setDeferredResultSender(deliverOutbound);

    const subagentManager = agent.getSubagentManager();
    if (subagentManager) {
      initMissionRunner({
        subagentManager,
        resolveSessionContext: (sessionKey: string): ToolContext => ({
          platform: 'orchestration',
          botId: 'mission-runner',
          sceneId: sessionKey,
          senderId: 'mission-runner',
          scope: 'private',
        }),
        sendImMessage: async (options) => {
          const adapter = resolveAdapter(options.context);
          if (!adapter) throw new Error(`adapter not found: ${options.context}`);
          return adapter.sendMessage(options);
        },
      });
    }

    let jobEngine: import('../cron-engine.js').IPersistentJobEngine | null = null;
    let jobWorker: JobWorker | null = null;
    const cronFeature = root.inject('cron') as import('@zhin.js/core').CronFeature | undefined;
    if (cronFeature && typeof cronFeature.add === 'function') {
      const addCron: import('../cron-engine.js').AddCronFn = (c) => cronFeature.add(c, 'cron-engine');

      if (assistantCfg.enabled) {
        const store = createAssistantJobStore(dataDir, assistantCfg);
        jobWorker = new JobWorker({
          executor,
          queue: assistantCfg.queue,
          assistantEnabled: true,
        });
        const assistantEngine = new AssistantJobEngine({
          store,
          addCron,
          worker: jobWorker,
          notifyOnFailure: defaultNotifyCfg.notifyOnFailure,
          router: notificationRouter,
          defaultNotify: defaultNotifyCfg.notify,
        });
        jobEngine = assistantEngine;

        void store.migrateLegacyIfNeeded()
          .then(() => store.syncSchedulerJobsFromLegacy())
          .then(async () => {
            const profile = await loadAssistantProfileFile(process.cwd(), assistantCfg.profile);
            if (profile) {
              for (const err of validateAssistantProfile(profile)) {
                logger.warn(formatCompact({ assistant_profile: err }));
              }
            }
            await syncProfileHeartbeatToStore(store, profile);
            await syncProfileCronRoutinesToStore(store, profile);
            assistantEngine.load();
          }).catch((e) => {
            logger.warn('Assistant load failed: ' + ((e as Error)?.message || String(e)));
            assistantEngine.load();
          });
        const ingress = new AssistantEventIngress({
          store,
          engine: assistantEngine,
          eventsConfig: assistantCfg.events,
        });
        setAssistantRuntime({
          config: assistantCfg,
          store,
          engine: assistantEngine,
          ingress,
        });
        logger.info(formatCompact({
          assistant_runtime: true,
          legacyDualWrite: assistantCfg.legacyDualWrite,
          events: ingress.isEnabled(),
          profile: assistantCfg.profile?.enabled === true,
        }));
      } else {
        const runner = async (prompt: string, jobId: string, notify?: import('../assistant/types.js').JobNotify) => {
          if (!refs.zhinAgent) return;
          const result = await executor.executeTask({
            prompt,
            notify,
            timeContext: true,
          });
          if (jobEngine) {
            await jobEngine.updateJobStatus(jobId, result.success ? 'ok' : 'error', result.error);
          }
        };
        jobEngine = new PersistentCronEngine({ dataDir, addCron, runner });
        jobEngine.load();
      }

      setCronManager({ cronFeature, engine: jobEngine });
    }

    // Legacy Scheduler：assistant.enabled 时由 JobStore 统一调度
    if (!assistantCfg.enabled) {
      const scheduler = new Scheduler({
        storePath: path.join(dataDir, 'scheduler-jobs.json'),
        workspace: process.cwd(),
        heartbeatEnabled: true,
        onJob: async (job) => {
          if (!refs.zhinAgent) return;
          const target = job.payload.target;
          await executor.executeTask({
            prompt: job.payload.message,
            notify: job.payload.deliver && target
              ? { channel: 'im', platform: target, sceneId: job.payload.to }
              : { channel: 'silent' },
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
      setCronManager(null);
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
