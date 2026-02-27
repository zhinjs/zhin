/**
 * AI 模块初始化
 *
 * 将 AI 服务注册到 Zhin 插件系统中：
 *   - AIService context
 *   - ZhinAgent 全局大脑
 *   - AI 触发处理器 (via MessageDispatcher)
 *   - 数据库会话/上下文持久化
 *   - 消息记录中间件
 *   - AI 管理工具
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@zhin.js/logger';
import { getPlugin, type Plugin } from '../plugin.js';
import { Message } from '../message.js';
import type { Tool, ToolContext } from '../types.js';
import type { AITriggerConfig } from '../built/ai-trigger.js';
import { ZhinTool, ToolFeature } from '../built/tool.js';
import {
  shouldTriggerAI,
  inferSenderPermissions,
  parseRichMediaContent,
  mergeAITriggerConfig,
} from '../built/ai-trigger.js';
import type { MessageDispatcherService } from '../built/dispatcher.js';
import type { SkillFeature } from '../built/skill.js';
import { AIService } from './service.js';
import { ZhinAgent } from './zhin-agent.js';
import { createBuiltinTools, discoverWorkspaceSkills, loadSoulPersona, loadAlwaysSkillsContent, buildSkillsSummaryXML } from './builtin-tools.js';
import { resolveSkillInstructionMaxChars, DEFAULT_CONFIG } from './zhin-agent-config.js';
import { loadBootstrapFiles, buildContextFiles, buildBootstrapContextSection, loadToolsGuide } from './bootstrap.js';
import { triggerAIHook, createAIHookEvent } from './hooks.js';
import { SessionManager, createDatabaseSessionManager } from './session.js';
import { AI_SESSION_MODEL } from './session.js';
import {
  createContextManager,
  CHAT_MESSAGE_MODEL,
  CONTEXT_SUMMARY_MODEL,
  type MessageRecord,
} from './context-manager.js';
import { AI_MESSAGE_MODEL, AI_SUMMARY_MODEL } from './conversation-memory.js';
import { AI_USER_PROFILE_MODEL } from './user-profile.js';
import { AI_FOLLOWUP_MODEL } from './follow-up.js';
import { PersistentCronEngine, setCronManager, createCronTools } from './cron-engine.js';
import { Scheduler, getScheduler, setScheduler } from '../scheduler/index.js';
import { renderToPlainText, type OutputElement } from './output.js';
import type { AIConfig, ContentPart } from './types.js';

// ============================================================================
// 类型扩展
// ============================================================================

declare module '../plugin.js' {
  namespace Plugin {
    interface Contexts {
      ai: AIService;
    }
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 从消息中提取图片 URL（支持 XML 标签格式和 raw 对象格式）
 */
function extractImageUrls(message: Message<any>): string[] {
  const urls: string[] = [];
  const raw = typeof message.$raw === 'string' ? message.$raw : JSON.stringify(message.$raw || '');

  // 匹配 <image url="..." /> 格式
  const xmlMatches = raw.match(/<image[^>]+url="([^"]+)"/g);
  if (xmlMatches) {
    for (const m of xmlMatches) {
      const urlMatch = m.match(/url="([^"]+)"/);
      if (urlMatch) urls.push(urlMatch[1]);
    }
  }

  // 匹配 [CQ:image,url=...] 格式 (OneBot)
  const cqMatches = raw.match(/\[CQ:image[^\]]*url=([^\],]+)/g);
  if (cqMatches) {
    for (const m of cqMatches) {
      const urlMatch = m.match(/url=([^\],]+)/);
      if (urlMatch) urls.push(urlMatch[1]);
    }
  }

  return urls;
}

// ============================================================================
// 初始化函数
// ============================================================================

/**
 * 初始化 AI 模块
 *
 * 在 setup.ts 中调用：
 * ```ts
 * import { initAIModule } from '@zhin.js/core';
 * initAIModule();
 * ```
 */
export function initAIModule(): void {
  const plugin = getPlugin();
  const { provide, useContext, root, logger } = plugin;
  // ── 工具服务 ──
  provide(new ToolFeature());

  // ── 数据库模型定义 ──
  // provide(defineDatabaseService) 之后 defineModel 即可用，直接在顶层定义
  const defineModel = (plugin as any).defineModel as
    | ((name: string, def: any) => void)
    | undefined;
  if (typeof defineModel === 'function') {
    defineModel('chat_messages', CHAT_MESSAGE_MODEL);
    defineModel('context_summaries', CONTEXT_SUMMARY_MODEL);
    defineModel('ai_sessions', AI_SESSION_MODEL);
    defineModel('ai_messages', AI_MESSAGE_MODEL);
    defineModel('ai_summaries', AI_SUMMARY_MODEL);
    defineModel('ai_user_profiles', AI_USER_PROFILE_MODEL);
    defineModel('ai_followups', AI_FOLLOWUP_MODEL);
    logger.debug('AI database models registered (7 tables)');
  } else {
    logger.debug('defineModel not available, AI will use in-memory storage');
  }

  // ── AI 服务实例 ──
  let aiServiceInstance: AIService | null = null;
  let zhinAgentInstance: ZhinAgent | null = null;

  provide({
    name: 'ai' as any,
    description: 'AI Service - Multi-model LLM integration',
    async mounted(p: Plugin) {
      const configService = root.inject('config');
      const appConfig =
        configService?.getPrimary<{ ai?: AIConfig }>() || {};
      const config = appConfig.ai || {};

      if (config.enabled === false) {
        logger.info('AI Service is disabled');
        return null as any;
      }

      const service = new AIService(config);
      aiServiceInstance = service;
      service.setPlugin(root);

      const providers = service.listProviders();
      if (providers.length === 0) {
        logger.warn(
          'No AI providers configured. Please add API keys in zhin.config (yml/json/toml)',
        );
      } else {
        logger.info(
          `AI Service started with providers: ${providers.join(', ')}`,
        );
      }

      return service;
    },
    async dispose(service: AIService | null) {
      if (service) {
        service.dispose();
        aiServiceInstance = null;
        logger.info('AI Service stopped');
      }
    },
  });

  // ── ZhinAgent 全局大脑 ──
  useContext('ai', (ai) => {
    if (!ai.isReady()) {
      logger.warn('AI Service not ready, ZhinAgent not created');
      return;
    }

    const provider = ai.getProvider();
    const agentConfig = ai.getAgentConfig();
    const agent = new ZhinAgent(provider, agentConfig);
    zhinAgentInstance = agent;

    const skillRegistry = root.inject('skill');
    if (skillRegistry) agent.setSkillRegistry(skillRegistry);

    // 注入跟进提醒的发送回调（不依赖数据库，内存模式也能发）
    agent.setFollowUpSender(async (record) => {
      const adapter = root.inject(record.platform as any) as any;
      if (!adapter || typeof adapter.sendMessage !== 'function') {
        logger.warn(`[跟进提醒] 找不到适配器: ${record.platform}`);
        return;
      }
      const content = `⏰ 定时提醒：${record.message}`;
      await adapter.sendMessage({
        context: record.platform,
        bot: record.bot_id,
        id: record.scene_id,
        type: record.scene_type as any,
        content,
      });
    });

    // 子任务管理器：让 AI 可以 spawn 后台子 agent 异步执行复杂任务
    agent.initSubagentManager(() => {
      const modelName = provider.models[0] || '';
      const fullConfig = { ...DEFAULT_CONFIG, ...agentConfig } as Required<import('./zhin-agent-config.js').ZhinAgentConfig>;
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

    // 持久化定时任务引擎：加载 data/cron-jobs.json，到点用 prompt 调用 Agent；并暴露给 AI 管理（list/add/remove/pause/resume）
    let cronEngine: PersistentCronEngine | null = null;
    const cronFeature = root.inject('cron' as any);
    if (cronFeature && typeof cronFeature.add === 'function') {
      const dataDir = path.join(process.cwd(), 'data');
      const addCron = (c: any) => cronFeature.add(c, 'cron-engine');
      const runner = async (prompt: string) => {
        if (!zhinAgentInstance) return;
        await zhinAgentInstance.process(prompt, {
          platform: 'cron',
          senderId: 'system',
          sceneId: 'cron',
        });
      };
      cronEngine = new PersistentCronEngine({ dataDir, addCron, runner });
      cronEngine.load();
      setCronManager({ cronFeature, engine: cronEngine });
    }

    // 统一调度器（at/every/cron + Heartbeat），持久化到 data/scheduler-jobs.json
    const dataDir = path.join(process.cwd(), 'data');
    const workspace = process.cwd();
    const scheduler = new Scheduler({
      storePath: path.join(dataDir, 'scheduler-jobs.json'),
      workspace,
      onJob: async (job) => {
        if (!zhinAgentInstance) return;
        await zhinAgentInstance.process(job.payload.message, {
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
      zhinAgentInstance = null;
    };
  });

  // ── AI 触发处理器 ──
  useContext('ai' as any, (ai: AIService) => {
    const rawConfig = ai.getTriggerConfig();
    const triggerConfig = mergeAITriggerConfig(rawConfig);
    if (!triggerConfig.enabled) {
      logger.info('AI Trigger is disabled');
      return;
    }

    const renderOutput = (elements: OutputElement[]): string => {
      const parts: string[] = [];
      for (const el of elements) {
        switch (el.type) {
          case 'text':
            if (el.content) parts.push(el.content);
            break;
          case 'image':
            parts.push(`<image url="${el.url}"/>`);
            break;
          case 'audio':
            parts.push(`<audio url="${el.url}"/>`);
            break;
          case 'video':
            parts.push(`<video url="${el.url}"/>`);
            break;
          case 'card': {
            const cp = [`📋 ${el.title}`];
            if (el.description) cp.push(el.description);
            if (el.fields?.length)
              for (const f of el.fields) cp.push(`  ${f.label}: ${f.value}`);
            if (el.imageUrl) cp.push(`<image url="${el.imageUrl}"/>`);
            parts.push(cp.join('\n'));
            break;
          }
          case 'file':
            parts.push(`📎 ${el.name}: ${el.url}`);
            break;
        }
      }
      return parts.join('\n') || '';
    };

    const handleAIMessage = async (
      message: Message<any>,
      content: string,
    ) => {
      const t0 = performance.now();
      if (!ai.isReady()) return;
      if (triggerConfig.thinkingMessage)
        await message.$reply(triggerConfig.thinkingMessage);

      const permissions = inferSenderPermissions(message, triggerConfig);
      const toolContext: ToolContext = {
        platform: message.$adapter,
        botId: message.$bot,
        sceneId: message.$channel?.id || message.$sender.id,
        senderId: message.$sender.id,
        message,
        scope: permissions.scope,
        senderPermissionLevel: permissions.permissionLevel,
        isGroupAdmin: permissions.isGroupAdmin,
        isGroupOwner: permissions.isGroupOwner,
        isBotAdmin: permissions.isBotAdmin,
        isOwner: permissions.isOwner,
      };

      const tCollect = performance.now();
      const toolService = root.inject('tool');
      let externalTools: Tool[] = [];
      if (toolService) {
        externalTools = toolService.collectAll(root);
        externalTools = toolService.filterByContext(externalTools, toolContext);
      }
      logger.debug(`[AI Handler] 工具收集: ${externalTools.length} 个, ${(performance.now() - tCollect).toFixed(0)}ms`);

      try {
        const timeout = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('AI 响应超时')), triggerConfig.timeout),
        );

        let responseText: string;
        if (zhinAgentInstance) {
          // 检查消息是否包含图片（多模态路由）
          const imageUrls = extractImageUrls(message);
          let elements: OutputElement[];
          if (imageUrls.length > 0) {
            const parts: ContentPart[] = [];
            if (content) parts.push({ type: 'text', text: content });
            for (const url of imageUrls) {
              parts.push({ type: 'image_url', image_url: { url } });
            }
            elements = await Promise.race([
              zhinAgentInstance.processMultimodal(parts, toolContext),
              timeout,
            ]);
          } else {
            elements = await Promise.race([
              zhinAgentInstance.process(content, toolContext, externalTools),
              timeout,
            ]);
          }
          responseText = renderOutput(elements);
        } else {
          const response = await Promise.race([
            ai.process(content, toolContext, externalTools),
            timeout,
          ]);
          responseText = typeof response === 'string' ? response : '';
        }

        if (responseText) await message.$reply(parseRichMediaContent(responseText));
        logger.info(`[AI Handler] 总耗时: ${(performance.now() - t0).toFixed(0)}ms`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[AI Handler] 失败 (${(performance.now() - t0).toFixed(0)}ms): ${msg}`);
        await message.$reply(triggerConfig.errorTemplate.replace('{error}', msg));
      }
    };

    const dispatcher = root.inject('dispatcher' as any) as
      | MessageDispatcherService
      | undefined;

    if (dispatcher && typeof dispatcher.setAIHandler === 'function') {
      dispatcher.setAITriggerMatcher((message: Message<any>) =>
        shouldTriggerAI(message, triggerConfig),
      );
      dispatcher.setAIHandler(handleAIMessage);
      logger.debug('AI Handler registered via MessageDispatcher');
      return () => { logger.info('AI Handler unregistered'); };
    }

    // 回退中间件
    const aiMw = async (
      message: Message<any>,
      next: () => Promise<void>,
    ) => {
      const { triggered, content } = shouldTriggerAI(message, triggerConfig);
      if (!triggered) return await next();
      await handleAIMessage(message, content);
      await next();
    };
    const dispose = root.addMiddleware(aiMw);
    logger.debug('AI Trigger middleware registered (fallback mode)');
    return () => { dispose(); };
  });

  // ── 数据库集成（db 就绪后升级各组件到数据库存储）──
  useContext('database' as any, (db: any) => {
    setTimeout(() => {
      if (!aiServiceInstance) return;
      const configService = root.inject('config');
      const appConfig =
        configService?.getPrimary<{ ai?: AIConfig }>() || {};
      const config = appConfig.ai || {};

      if (config.sessions?.useDatabase === false) return;

      try {
        const model = db.models.get('ai_sessions');
        if (!model) return;

        const dbSession = createDatabaseSessionManager(
          model,
          aiServiceInstance.getSessionConfig(),
        );
        aiServiceInstance.setSessionManager(dbSession);
        if (zhinAgentInstance) zhinAgentInstance.setSessionManager(dbSession);

        const ctxCfg = aiServiceInstance.getContextConfig();
        if (ctxCfg.enabled !== false) {
          const msgModel = db.models.get('chat_messages');
          const sumModel = db.models.get('context_summaries');
          if (msgModel && sumModel) {
            const ctxMgr = createContextManager(msgModel, sumModel, ctxCfg);
            aiServiceInstance.setContextManager(ctxMgr);
            if (zhinAgentInstance) zhinAgentInstance.setContextManager(ctxMgr);
          }
        }

        // ConversationMemory 升级到数据库
        if (zhinAgentInstance) {
          const aiMsgModel = db.models.get('ai_messages');
          const aiSumModel = db.models.get('ai_summaries');
          if (aiMsgModel && aiSumModel) {
            zhinAgentInstance.upgradeMemoryToDatabase(aiMsgModel, aiSumModel);
          }

          // UserProfile 升级到数据库
          const profileModel = db.models.get('ai_user_profiles');
          if (profileModel) {
            zhinAgentInstance.upgradeProfilesToDatabase(profileModel);
          }

          // FollowUp 升级到数据库 + 恢复未完成任务
          const followUpModel = db.models.get('ai_followups');
          if (followUpModel) {
            zhinAgentInstance.upgradeFollowUpsToDatabase(followUpModel);

            // 从数据库恢复未完成的跟进任务
            zhinAgentInstance.restoreFollowUps().catch(e => {
              logger.warn('FollowUp restore failed:', e);
            });
          }
        }

        logger.debug('AI database storage activated (session, memory, profile, followup)');
      } catch (e) {
        logger.error('AI Session: database setup failed:', e);
      }
    }, 100);
  });

  // ── 消息记录中间件 ──
  root.addMiddleware(async (message: Message, next: () => Promise<void>) => {
    await next();
    if (aiServiceInstance?.contextManager) {
      const record: MessageRecord = {
        platform: message.$adapter,
        scene_id: message.$channel?.id || message.$sender.id,
        scene_type: message.$channel?.type || 'private',
        scene_name: (message.$channel as any)?.name || '',
        sender_id: message.$sender.id,
        sender_name: message.$sender.name || message.$sender.id,
        message:
          typeof message.$raw === 'string'
            ? message.$raw
            : JSON.stringify(message.$raw),
        time: message.$timestamp || Date.now(),
      };
      aiServiceInstance.contextManager.recordMessage(record).catch(() => {});
    }
  });

  // ── AI 管理工具 ──
  useContext('ai' as any, 'tool' as any, (ai: AIService | undefined, toolService: any) => {
    if (!ai || !toolService) return;

    const listModelsTool = new ZhinTool('ai.models')
      .desc('列出所有可用的 AI 模型')
      .keyword('模型', '可用模型', 'ai模型', 'model', 'models')
      .tag('ai', 'management')
      .execute(async () => {
        const models = await ai.listModels();
        return { providers: models.map(({ provider, models: ml }) => ({ name: provider, models: ml.slice(0, 10), total: ml.length })) };
      })
      .action(async () => {
        const models = await ai.listModels();
        let r = '🤖 可用模型:\n';
        for (const { provider, models: ml } of models) {
          r += `\n【${provider}】\n` + ml.slice(0, 5).map(m => `  • ${m}`).join('\n');
          if (ml.length > 5) r += `\n  ... 还有 ${ml.length - 5} 个`;
        }
        return r;
      });

    const clearSessionTool = new ZhinTool('ai.clear')
      .desc('清除当前对话的历史记录')
      .keyword('清除', '清空', '重置', 'clear', 'reset')
      .tag('ai', 'session')
      .execute(async (_args, context) => {
        if (!context?.message) return { success: false, error: '无消息上下文' };
        const msg = context.message as Message;
        const sid = SessionManager.generateId(msg.$adapter, msg.$sender.id, msg.$channel?.id);
        await ai.sessions.reset(sid);
        return { success: true, message: '对话历史已清除' };
      })
      .action(async (message: Message) => {
        const sid = SessionManager.generateId(message.$adapter, message.$sender.id, message.$channel?.id);
        await ai.sessions.reset(sid);
        return '✅ 对话历史已清除';
      });

    const healthCheckTool = new ZhinTool('ai.health')
      .desc('检查 AI 服务的健康状态')
      .keyword('健康', '状态', '检查', 'health', 'status')
      .tag('ai', 'management')
      .execute(async () => {
        const h = await ai.healthCheck();
        return { providers: Object.entries(h).map(([n, ok]) => ({ name: n, healthy: ok })) };
      })
      .action(async () => {
        const h = await ai.healthCheck();
        return ['🏥 AI 服务健康状态:'].concat(
          Object.entries(h).map(([p, ok]) => `  ${ok ? '✅' : '❌'} ${p}`),
        ).join('\n');
      });

    const tools = [listModelsTool, clearSessionTool, healthCheckTool];
    const disposers: (() => void)[] = [];
    for (const tool of tools) disposers.push(toolService.addTool(tool, root.name));
    logger.debug(`Registered ${tools.length} AI management tools`);
    return () => disposers.forEach(d => d());
  });

  // ── 内置系统工具（文件/Shell/网络/计划/记忆/技能） ──
  useContext('ai', 'tool', (ai, toolService) => {
    if (!ai || !toolService) return;

    const provider = ai.getProvider();
    const agentCfg = ai.getAgentConfig();
    const fullCfg = { ...DEFAULT_CONFIG, ...agentCfg } as Required<import('./zhin-agent-config.js').ZhinAgentConfig>;
    const modelName = provider.models[0] || '';
    const builtinTools = createBuiltinTools({ skillInstructionMaxChars: resolveSkillInstructionMaxChars(fullCfg, modelName) });
    const disposers: (() => void)[] = [];
    for (const tool of builtinTools) disposers.push(toolService.addTool(tool, root.name));
    const cronTools = createCronTools();
    for (const tool of cronTools) disposers.push(toolService.addTool(tool, root.name));
    logger.info(`Registered ${builtinTools.length} built-in + ${cronTools.length} cron tools`);

    let skillWatchers: fs.FSWatcher[] = [];
    let skillReloadDebounce: ReturnType<typeof setTimeout> | null = null;

    async function syncWorkspaceSkills(): Promise<number> {
      const skillFeature = root.inject?.('skill') as SkillFeature | undefined;
      if (!skillFeature) return 0;
      // 先移除当前插件注册的所有工作区技能（增量更新）
      const existing = skillFeature.getByPlugin(root.name);
      for (const s of existing) skillFeature.remove(s);
      const skills = await discoverWorkspaceSkills();
      if (skills.length === 0) return 0;
      const allRegisteredTools = toolService.getAll();
      const toolNameIndex = new Map<string, Tool>();
      for (const t of allRegisteredTools) {
        toolNameIndex.set(t.name, t);
        const parts = t.name.split('_');
        if (parts.length === 2) toolNameIndex.set(`${parts[1]}_${parts[0]}`, t);
      }
      for (const s of skills) {
        const associatedTools: Tool[] = [];
        const toolNames = s.toolNames || [];
        for (const toolName of toolNames) {
          let tool = toolService.get(toolName) || toolNameIndex.get(toolName);
          if (tool) associatedTools.push(tool);
        }
        skillFeature.add({
          name: s.name,
          description: s.description,
          tools: associatedTools,
          keywords: s.keywords || [],
          tags: s.tags || [],
          pluginName: root.name,
        }, root.name);
      }
      return skills.length;
    }

    // 异步发现工作区技能 + 加载引导文件（不阻塞注册流程）
    (async () => {
      // ── 第一步：发现和注册工作区技能 ──
      try {
        const count = await syncWorkspaceSkills();
        const skillFeature = root.inject?.('skill') as SkillFeature | undefined;
        if (count > 0 && skillFeature) {
          logger.info(`✅ Registered ${count} workspace skills`);
        }
      } catch (e: any) {
        logger.warn(`Failed to discover workspace skills: ${e.message}`);
      }

      // ── 第二步：加载引导文件 ──
      const loadedFiles: string[] = [];
      try {
        // 使用项目根目录或当前工作目录作为工作区目录
        const workspaceDir = process.cwd();
        const bootstrapFiles = await loadBootstrapFiles(workspaceDir);
        const contextFiles = buildContextFiles(bootstrapFiles);
        
        logger.debug(`Bootstrap files loaded (cwd: ${workspaceDir}): ${bootstrapFiles.map(f => f.name + (f.missing ? ' (missing)' : '')).join(', ')}`);

        // SOUL.md → 注入到 agent persona
        const soulFile = contextFiles.find(f => f.path === 'SOUL.md');
        if (soulFile && zhinAgentInstance) {
          logger.info('Loaded SOUL.md persona → agent prompt');
          loadedFiles.push('SOUL.md');
        }

        // TOOLS.md → 记录已加载
        const toolsFile = contextFiles.find(f => f.path === 'TOOLS.md');
        if (toolsFile) {
          logger.info('Loaded TOOLS.md tool guidance → agent prompt');
          loadedFiles.push('TOOLS.md');
        }

        // AGENTS.md → 记录已加载
        const agentsFile = contextFiles.find(f => f.path === 'AGENTS.md');
        if (agentsFile) {
          logger.info('Loaded AGENTS.md memory → agent prompt');
          loadedFiles.push('AGENTS.md');
        }

        // 注入引导上下文到 ZhinAgent
        if (zhinAgentInstance && contextFiles.length > 0) {
          const contextSection = buildBootstrapContextSection(contextFiles);
          zhinAgentInstance.setBootstrapContext(contextSection);
        }
      } catch (e: any) {
        logger.debug(`Bootstrap files not loaded: ${e.message}`);
      }

      // ── 第三步：常驻技能正文 + 技能 XML 摘要注入 Agent ──
      try {
        const skillsForContext = await discoverWorkspaceSkills();
        const alwaysContent = await loadAlwaysSkillsContent(skillsForContext);
        const skillsXml = buildSkillsSummaryXML(skillsForContext);
        if (zhinAgentInstance) {
          zhinAgentInstance.setActiveSkillsContext(alwaysContent);
          zhinAgentInstance.setSkillsSummaryXML(skillsXml);
        }
      } catch (e: any) {
        logger.debug(`Skills context not set: ${e.message}`);
      }

      // 触发 agent:bootstrap Hook
      const skillFeature2 = (root as any).inject?.('skill') as SkillFeature | undefined;
      await triggerAIHook(createAIHookEvent('agent', 'bootstrap', undefined, {
        workspaceDir: process.cwd(),
        toolCount: builtinTools.length,
        skillCount: skillFeature2?.size ?? 0,
        bootstrapFiles: loadedFiles,
      }));

      // ── 技能目录热重载：监听 workspace + local 技能目录，防抖后重新发现并更新 ──
      const workspaceSkillDir = path.join(process.cwd(), 'skills');
      const localSkillDir = path.join(os.homedir(), '.zhin', 'skills');
      const onSkillDirChange = () => {
        if (skillReloadDebounce) clearTimeout(skillReloadDebounce);
        skillReloadDebounce = setTimeout(async () => {
          skillReloadDebounce = null;
          try {
            const count = await syncWorkspaceSkills();
            const skillsForContext = await discoverWorkspaceSkills();
            const alwaysContent = await loadAlwaysSkillsContent(skillsForContext);
            const skillsXml = buildSkillsSummaryXML(skillsForContext);
            if (zhinAgentInstance) {
              zhinAgentInstance.setActiveSkillsContext(alwaysContent);
              zhinAgentInstance.setSkillsSummaryXML(skillsXml);
            }
            await triggerAIHook(createAIHookEvent('agent', 'skills-reloaded', undefined, { skillCount: count }));
            if (count >= 0) logger.info(`[技能热重载] 已更新，当前工作区技能数: ${count}`);
          } catch (e: any) {
            logger.warn(`[技能热重载] 失败: ${e.message}`);
          }
        }, 400);
      };
      for (const dir of [workspaceSkillDir, localSkillDir]) {
        if (fs.existsSync(dir)) {
          try {
            const w = fs.watch(dir, { recursive: true }, onSkillDirChange);
            skillWatchers.push(w);
            logger.debug(`[技能热重载] 监听目录: ${dir}`);
          } catch (e: any) {
            logger.debug(`[技能热重载] 无法监听 ${dir}: ${e.message}`);
          }
        }
      }
    })();

    return () => {
      disposers.forEach(d => d());
      skillWatchers.forEach(w => w.close());
      skillWatchers = [];
      if (skillReloadDebounce) clearTimeout(skillReloadDebounce);
    };
  });
}
