/**
 * Register AI trigger handler via the core MessageDispatcher inbound pipeline.
 */
import './types.js';
import { getPlugin, inferSenderPermissions, isAtBot, mergeAITriggerConfig, Message, parseRichMediaContent, segment, shouldTriggerAI } from '@zhin.js/core';
import type { Plugin, Tool, ToolContext } from '@zhin.js/core';
import type { ContentPart } from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';
import type { AIServiceRefs } from './shared-refs.js';
import { extractMediaParts } from './message-media.js';
import { renderOutput } from './output-renderer.js';
import { canAccessTool } from '../orchestrator/tool-selection.js';
import { formatCompactLog, truncatePreview } from '@zhin.js/logger';
import { formatAiHandlerCompleteLog } from '../zhin-agent/turn-metrics.js';
import {
  formatSubagentProcessingMessage,
  SUBAGENT_GOAL_NOTIFY_EXTRA_KEY,
} from '../subagent-goal-notify.js';

function resolveBotAtIds(message: Message<any>, root: Plugin): string[] {
  const ids = new Set<string>([String(message.$bot)]);
  try {
    const adapter = root.inject(message.$adapter) as
      | { bots?: Map<string, { $config?: Record<string, unknown>; $platformUserId?: string }> }
      | undefined;
    const bot = adapter?.bots?.get(message.$bot);
    const cfg = bot?.$config;
    if (cfg?.name) ids.add(String(cfg.name));
    if (cfg?.appid) ids.add(String(cfg.appid));
    if (bot?.$platformUserId) ids.add(String(bot.$platformUserId));
  } catch {
    // adapter 未就绪时仍用 message.$bot
  }
  return [...ids];
}

export function registerAITrigger(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    const rawConfig = ai.getTriggerConfig();
    const triggerConfig = mergeAITriggerConfig(rawConfig);
    if (!triggerConfig.enabled) {
      logger.info(formatCompactLog('AI Handler', { disabled: true }));
      return;
    }

    const dispatcherSvc = root.inject('dispatcher') as
      | {
          replyWithPolish?: (
            m: Message<any>,
            s: 'ai' | 'command',
            c: unknown,
            options?: { quote?: boolean | string },
          ) => Promise<unknown>;
        }
      | undefined;

    const handleAIMessage = async (
      message: Message<any>,
      content: string,
    ) => {
      const replyOptions = { quote: true as const };

      const replyOutbound = async (payload: unknown) => {
        if (dispatcherSvc && typeof dispatcherSvc.replyWithPolish === 'function') {
          return dispatcherSvc.replyWithPolish(message, 'ai', payload as any, replyOptions);
        }
        return message.$reply(payload as any, true);
      };

      const t0 = performance.now();
      if (!ai.isReady()) {
        logger.warn(formatCompactLog('AI Handler', { skip: 'not_ready', bot: message.$bot }));
        return;
      }
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
        extra: {
          [SUBAGENT_GOAL_NOTIFY_EXTRA_KEY]: async (goal: string) => {
            await replyOutbound(formatSubagentProcessingMessage(goal));
          },
        },
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
      logger.debug(formatCompactLog('AI Handler', {
        tools: externalTools.length,
        collect_ms: Math.round(performance.now() - tCollect),
      }));

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
            logger.debug(formatCompactLog('AI Handler', { first_token_ms: Math.round(firstChunkMs) }));
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
        const totalMs = performance.now() - t0;
        const turnMetrics = refs.zhinAgent.getLastTurnMetrics();
        if (turnMetrics) {
          logger.info(formatAiHandlerCompleteLog(turnMetrics, totalMs));
        } else {
          logger.info(formatCompactLog('AI Handler', { total_ms: Math.round(totalMs), usage: 'n/a' }));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(formatCompactLog('AI Handler', {
          total_ms: Math.round(performance.now() - t0),
          ok: false,
          error: truncatePreview(msg),
        }));
        await replyOutbound(triggerConfig.errorTemplate.replace('{error}', msg));
      }
    };

    const dispatcher = root.inject('dispatcher');

    if (!dispatcher || typeof dispatcher.setAIHandler !== 'function') {
      logger.warn(formatCompactLog('AI Handler', { error: 'no_dispatcher' }));
      return;
    }

    dispatcher.setAITriggerMatcher((message: Message<any>) => {
      const botAtIds = resolveBotAtIds(message, root);
      const result = shouldTriggerAI(message, triggerConfig, { botAtIds });
      logger.debug(formatCompactLog('AI Trigger', {
        adapter: message.$adapter,
        bot: message.$bot,
        at: isAtBot(message, botAtIds),
        triggered: result.triggered,
        preview: truncatePreview(segment.raw(message.$content)),
      }));
      return result;
    });
    dispatcher.setAIHandler(handleAIMessage);
    logger.debug(formatCompactLog('AI Handler', { hook: 'on' }));
    return () => { logger.debug(formatCompactLog('AI Handler', { hook: 'off' })); };
  });
}
