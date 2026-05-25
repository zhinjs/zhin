/**
 * Create ZhinAgent global brain and wire up sub-systems
 * (follow-up sender, subagent manager, cron engine, scheduler).
 */
import * as path from 'node:path';
import { formatCompact, getPlugin, getScheduler, isZhinTool, Scheduler, setScheduler, type MessageType, type SendOptions } from '@zhin.js/core';
import { ModelRegistry, computeTierScore } from '@zhin.js/ai';
import { ZhinAgent } from '../zhin-agent/index.js';
import { createBuiltinTools } from '../builtin-tools.js';
import { collectPluginSkillSearchRoots } from '../discovery/utils.js';
import { resolveSkillInstructionMaxChars, DEFAULT_CONFIG } from '../zhin-agent/config.js';
import { PersistentCronEngine, setCronManager } from '../cron-engine.js';
import { createTaskExecutor } from '../task-executor.js';
import type { AIServiceRefs } from './shared-refs.js';

export function createZhinAgentContext(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    if (!ai.isReady()) {
      logger.warn(formatCompact( { error: 'ai_not_ready' }));
      return;
    }

    const provider = ai.getProvider();
    const agentConfig = ai.getAgentConfig();
    const agent = new ZhinAgent(provider, agentConfig);
    refs.zhinAgent = agent;
    agent.setHostPlugin(root);

    const orchestrator = root.inject('agent');
    if (orchestrator) {
      agent.setSkillRegistry(orchestrator.skills);
      agent.setOrchestrator(orchestrator);
    }

    // Model Registry: discover models and wire to agent
    const dataDir = path.join(process.cwd(), 'data');
    const modelRegistry = new ModelRegistry(dataDir);
    const hadCache = modelRegistry.loadCache();
    agent.setModelRegistry(modelRegistry);
    ai.setModelRegistry(modelRegistry);
    // Discover models in background (don't block startup)
    (async () => {
      try {
        const discovered = await modelRegistry.discover(provider);
        modelRegistry.saveCache();
        if (discovered.length > 0) {
          provider.models = discovered
            .sort((a, b) => computeTierScore(b.id) - computeTierScore(a.id))
            .map(m => m.id);
        }
        if (hadCache) {
          logger.debug(`ModelRegistry: refreshed ${discovered.length} models from ${provider.name}`);
        } else {
          logger.debug(formatCompact( { provider: provider.name, models: discovered.length }));
        }
      } catch (e) {
        logger.warn(formatCompact( { provider: provider.name, error: (e as Error).message }));
      }
    })();

    // Subagent manager for background tasks
    agent.initSubagentManager(() => {
      const modelName = provider.models[0] || '';
      const fullConfig = { ...DEFAULT_CONFIG, ...agentConfig } as Required<import('../zhin-agent/config.js').ZhinAgentConfig>;
      const zhinTools = createBuiltinTools({
        plugin,
        skillInstructionMaxChars: resolveSkillInstructionMaxChars(fullConfig, modelName),
        pluginSkillRootsResolver: () => collectPluginSkillSearchRoots(root),
      });
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
    // Unified task executor — single execution+delivery path for cron/scheduler/subagent
    const resolveAdapter = (platform: string) => {
      const adapter = root.inject(platform) as { sendMessage?: (opts: SendOptions) => Promise<string> } | undefined;
      if (adapter && typeof adapter.sendMessage === 'function') return adapter as { sendMessage: (opts: SendOptions) => Promise<string> };
      return undefined;
    };
    const executor = createTaskExecutor({ agent, resolveAdapter });

    agent.setSubagentSender(async (origin, content) => {
      const adapter = resolveAdapter(origin.platform);
      if (!adapter) {
        logger.warn(formatCompact( { error: 'adapter_not_found', platform: origin.platform }));
        return;
      }
      await adapter.sendMessage({
        context: origin.platform,
        bot: origin.botId,
        id: origin.sceneId,
        type: origin.sceneType as MessageType,
        content,
      });
    });

    // Persistent cron engine
    let cronEngine: PersistentCronEngine | null = null;
    const cronFeature = root.inject('cron') as import('@zhin.js/core').CronFeature | undefined;
    if (cronFeature && typeof cronFeature.add === 'function') {
      const addCron: import('../cron-engine.js').AddCronFn = (c) => cronFeature.add(c, 'cron-engine');
      const runner = async (prompt: string, jobId: string, jobContext?: import('../cron-engine.js').CronJobContext) => {
        if (!refs.zhinAgent) return;
        const result = await executor.executeTask({
          prompt,
          context: jobContext || {},
          timeContext: true,
        });
        if (cronEngine) {
          await cronEngine.updateJobStatus(jobId, result.success ? 'ok' : 'error', result.error);
        }
      };
      cronEngine = new PersistentCronEngine({ dataDir, addCron, runner });
      cronEngine.load();
      setCronManager({ cronFeature, engine: cronEngine });
    }

    // Unified scheduler (at/every/cron)
    const scheduler = new Scheduler({
      storePath: path.join(dataDir, 'scheduler-jobs.json'),
      workspace: process.cwd(),
      onJob: async (job) => {
        if (!refs.zhinAgent) return;
        await executor.executeTask({
          prompt: job.payload.message,
          context: {
            platform: 'cron',
            senderId: 'system',
            sceneId: job.payload.target || 'scheduler',
          },
        });
      },
    });
    setScheduler(scheduler);
    scheduler.start().catch((e) => logger.warn(formatCompact( { error: (e as Error).message })));

    logger.debug('ZhinAgent created');
    return () => {
      setCronManager(null);
      if (cronEngine) {
        cronEngine.unload();
        cronEngine = null;
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
