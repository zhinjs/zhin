/**
 * Register AI trigger handler via the core MessageDispatcher inbound pipeline.
 */
import './types.js';
import { getPlugin, Message, shouldTriggerAI, inferSenderPermissions, parseRichMediaContent, mergeAITriggerConfig } from '@zhin.js/core';
import type { Tool, ToolContext } from '@zhin.js/core';
import type { ContentPart } from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';
import type { AIServiceRefs } from './shared-refs.js';
import { extractMediaParts } from './message-media.js';
import { renderOutput } from './output-renderer.js';
import { canAccessTool } from '../orchestrator/tool-selection.js';

export function registerAITrigger(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    const rawConfig = ai.getTriggerConfig();
    const triggerConfig = mergeAITriggerConfig(rawConfig);
    if (!triggerConfig.enabled) {
      logger.info('AI Trigger is disabled');
      return;
    }

    const dispatcherSvc = root.inject('dispatcher') as
      | { replyWithPolish?: (m: Message<any>, s: 'ai' | 'command', c: unknown) => Promise<unknown> }
      | undefined;

    const handleAIMessage = async (
      message: Message<any>,
      content: string,
    ) => {
      const replyOutbound = async (payload: unknown) => {
        if (dispatcherSvc && typeof dispatcherSvc.replyWithPolish === 'function') {
          return dispatcherSvc.replyWithPolish(message, 'ai', payload as any);
        }
        return message.$reply(payload as any);
      };

      const t0 = performance.now();
      if (!ai.isReady()) return;
      if (triggerConfig.thinkingMessage)
        await replyOutbound(triggerConfig.thinkingMessage);

      const permissions = inferSenderPermissions(message, triggerConfig);

      // 从 bot 配置中查找 owner（bots[].owner）
      const adapterInstance = root.inject(message.$adapter) as
        | { bots?: Map<string, { $config?: Record<string, any> }> }
        | undefined;
      const botConfig = adapterInstance?.bots?.get(message.$bot)?.$config as Record<string, any> | undefined;
      const botOwner: string | undefined = botConfig?.owner;

      // 用 bot 级别 owner 覆盖权限判断
      const isOwner = botOwner ? String(message.$sender.id) === String(botOwner) : permissions.isOwner;
      const permissionLevel = isOwner ? 'owner' as const : permissions.permissionLevel;

      const toolContext: ToolContext = {
        platform: message.$adapter,
        botId: message.$bot,
        sceneId: message.$channel?.id || message.$sender.id,
        senderId: message.$sender.id,
        message,
        scope: permissions.scope,
        senderPermissionLevel: permissionLevel,
        isGroupAdmin: permissions.isGroupAdmin,
        isGroupOwner: permissions.isGroupOwner,
        isBotAdmin: isOwner || permissions.isBotAdmin,
        isOwner,
      };

      const tCollect = performance.now();
      const toolService = root.inject('tool');
      let externalTools: Tool[] = [...ai.getResidentToolsAsTools()];
      if (toolService) {
        externalTools.push(...toolService.getAll());
        externalTools = toolService.filterByContext(externalTools, toolContext);
      } else {
        externalTools = externalTools.filter(t => canAccessTool(t, toolContext));
      }
      logger.debug(`[AI Handler] 工具收集: ${externalTools.length} 个, ${(performance.now() - tCollect).toFixed(0)}ms`);

      try {
        // 每轮 LLM 调用在 Agent 内部已有 turnTimeout（来自 triggerConfig.timeout），
        // 这里不再设置全局超时，避免多轮工具调用被不合理地截断。

        if (!refs.zhinAgent) {
          throw new Error('ZhinAgent is not initialized');
        }
        const mediaParts = extractMediaParts(message);
        let elements: OutputElement[];
        let firstChunkMs = 0;
        const onChunk: (chunk: string, full: string) => void = (_chunk, _full) => {
          if (!firstChunkMs) {
            firstChunkMs = performance.now() - t0;
            logger.debug(`[AI Handler] 首 token: ${firstChunkMs.toFixed(0)}ms`);
          }
        };
        if (mediaParts.length > 0) {
          const parts: ContentPart[] = [];
          if (content) parts.push({ type: 'text', text: content });
          parts.push(...mediaParts);
          elements = await refs.zhinAgent.processMultimodal(parts, toolContext, onChunk);
        } else {
          elements = await refs.zhinAgent.process(content, toolContext, externalTools, onChunk);
        }
        const responseText = renderOutput(elements);

        if (responseText) await replyOutbound(parseRichMediaContent(responseText));
        logger.info(`[AI Handler] 总耗时: ${(performance.now() - t0).toFixed(0)}ms`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[AI Handler] 失败 (${(performance.now() - t0).toFixed(0)}ms): ${msg}`);
        await replyOutbound(triggerConfig.errorTemplate.replace('{error}', msg));
      }
    };

    const dispatcher = root.inject('dispatcher');

    if (!dispatcher || typeof dispatcher.setAIHandler !== 'function') {
      logger.warn('AI Trigger skipped: MessageDispatcher is not available');
      return;
    }

    dispatcher.setAITriggerMatcher((message: Message<any>) =>
      shouldTriggerAI(message, triggerConfig),
    );
    dispatcher.setAIHandler(handleAIMessage);
    logger.debug('AI Handler registered via MessageDispatcher');
    return () => { logger.info('AI Handler unregistered'); };
  });
}
