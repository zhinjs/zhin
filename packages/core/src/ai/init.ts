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
  useContext('ai' as any, (ai: AIService) => {
    if (!ai.isReady()) {
      logger.warn('AI Service not ready, ZhinAgent not created');
      return;
    }

    const provider = ai.getProvider();
    const agent = new ZhinAgent(provider);
    zhinAgentInstance = agent;

    const skillRegistry = root.inject('skill' as any) as
      | SkillFeature
      | undefined;
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

    logger.debug('ZhinAgent created');
    return () => {
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
}
