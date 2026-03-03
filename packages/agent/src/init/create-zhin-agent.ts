/**
 * Create ZhinAgent global brain and wire up sub-systems
 * (follow-up sender, subagent manager, cron engine, scheduler).
 */
import * as path from 'path';
import { getPlugin, Scheduler, getScheduler, setScheduler } from '@zhin.js/core';
import { ZhinAgent } from '../zhin-agent/index.js';
import { createBuiltinTools } from '../builtin-tools.js';
import { resolveSkillInstructionMaxChars, DEFAULT_CONFIG } from '../zhin-agent/config.js';
import { PersistentCronEngine, setCronManager } from '../cron-engine.js';
import type { AIServiceRefs } from './shared-refs.js';

export function createZhinAgentContext(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    if (!ai.isReady()) {
      logger.warn('AI Service not ready, ZhinAgent not created');
      return;
    }

    const provider = ai.getProvider();
    const agentConfig = ai.getAgentConfig();
    const agent = new ZhinAgent(provider, agentConfig);
    refs.zhinAgent = agent;

    const skillRegistry = root.inject('skill');
    if (skillRegistry) agent.setSkillRegistry(skillRegistry);

    // Follow-up reminder sender
    agent.setFollowUpSender(async (record) => {
      const adapter = root.inject(record.platform as any) as any;
      if (!adapter || typeof adapter.sendMessage !== 'function') {
        logger.warn(`[跟进提醒] 找不到适配器: ${record.platform}`);
        return;
      }
      await adapter.sendMessage({
        context: record.platform,
        bot: record.bot_id,
        id: record.scene_id,
        type: record.scene_type as any,
        content: `⏰ 定时提醒：${record.message}`,
      });
    });

    // Subagent manager for background tasks
    agent.initSubagentManager(() => {
      const modelName = provider.models[0] || '';
      const fullConfig = { ...DEFAULT_CONFIG, ...agentConfig } as Required<import('../zhin-agent/config.js').ZhinAgentConfig>;
      const zhinTools = createBuiltinTools({ skillInstructionMaxChars: resolveSkillInstructionMaxChars(fullConfig, modelName) });
      return zhinTools.map(zt => {
        const t = zt.toTool();
        return {
          name: t.name,
          description: t.description,
          parameters: t.parameters as any,
          execute: t.execute as (args: Record<string, any>) => Promise<any>,
          tags: t.tags,
          keywords: t.keywords,
        };
      });
    });
    agent.setSubagentSender(async (origin, content) => {
      const adapter = root.inject(origin.platform as any) as any;
      if (!adapter || typeof adapter.sendMessage !== 'function') {
        logger.warn(`[子任务] 找不到适配器: ${origin.platform}`);
        return;
      }
      await adapter.sendMessage({
        context: origin.platform,
        bot: origin.botId,
        id: origin.sceneId,
        type: origin.sceneType as any,
        content,
      });
    });

    // Persistent cron engine
    let cronEngine: PersistentCronEngine | null = null;
    const cronFeature = root.inject('cron' as any);
    if (cronFeature && typeof cronFeature.add === 'function') {
      const dataDir = path.join(process.cwd(), 'data');
      const addCron = (c: any) => cronFeature.add(c, 'cron-engine');
      const runner = async (prompt: string) => {
        if (!refs.zhinAgent) return;
        await refs.zhinAgent.process(prompt, {
          platform: 'cron',
          senderId: 'system',
          sceneId: 'cron',
        });
      };
      cronEngine = new PersistentCronEngine({ dataDir, addCron, runner });
      cronEngine.load();
      setCronManager({ cronFeature, engine: cronEngine });
    }

    // Unified scheduler (at/every/cron + Heartbeat)
    const dataDir = path.join(process.cwd(), 'data');
    const scheduler = new Scheduler({
      storePath: path.join(dataDir, 'scheduler-jobs.json'),
      workspace: process.cwd(),
      onJob: async (job) => {
        if (!refs.zhinAgent) return;
        await refs.zhinAgent.process(job.payload.message, {
          platform: 'cron',
          senderId: 'system',
          sceneId: 'scheduler',
        });
      },
      heartbeatEnabled: true,
      heartbeatIntervalMs: 30 * 60 * 1000,
    });
    setScheduler(scheduler);
    scheduler.start().catch((e) => logger.warn('Scheduler start failed: ' + (e as Error).message));

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
