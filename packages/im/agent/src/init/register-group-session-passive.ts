/**
 * 群/频道共享 session：未 @ 机器人的消息写入 ConversationMemory，供后续 @ 时带入上下文。
 * AI 回复仍仅由 shouldTriggerAI（群/频道下主要为 @）触发。
 */
import {
  getPlugin,
  mergeAITriggerConfig,
  resolveSenderRoles,
  resolveIMSessionIdFromMessage,
  extractTextContent,
} from '@zhin.js/core';
import type { Message } from '@zhin.js/core';
import { formatCompactLog } from '@zhin.js/logger';
import { prepareUserContentForSession } from '../zhin-agent/session-io.js';
import { asPrivate } from '../zhin-agent/zhin-agent-private.js';
import type { AIServiceRefs } from './shared-refs.js';

function isBotSelfMessage(message: Message<any>): boolean {
  const senderId = String(message.$sender?.id ?? '');
  const botId = String(message.$bot ?? '');
  return senderId !== '' && botId !== '' && senderId === botId;
}

export function registerGroupSessionPassive(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { root, logger } = plugin;

  plugin.useContext('ai', (ai) => {
    const dispatcher = root.inject('dispatcher') as
      | { setGroupPassiveContextHandler?: (h: ((m: Message<any>) => Promise<void>) | null) => void }
      | undefined;

    if (!dispatcher?.setGroupPassiveContextHandler) {
      logger.debug(formatCompactLog('GroupSessionPassive', { skip: 'no_dispatcher' }));
      return;
    }

    dispatcher.setGroupPassiveContextHandler(async (message) => {
      if (!refs.zhinAgent || isBotSelfMessage(message)) return;

      const triggerConfig = mergeAITriggerConfig(ai.getTriggerConfig());
      const adapterInstance = root.inject(message.$adapter) as
        | { bots?: Map<string, { $config?: Record<string, unknown> }> }
        | undefined;
      const botConfig = adapterInstance?.bots?.get(message.$bot)?.$config;

      const { scope, roles } = resolveSenderRoles(message, triggerConfig, botConfig);
      const rawText = extractTextContent(message).trim();
      if (!rawText) return;

      const sessionId = resolveIMSessionIdFromMessage(message);
      const sceneId = message.$channel?.id || message.$sender.id;
      const { content } = prepareUserContentForSession(
        {
          scope,
          senderId: message.$sender.id,
          roles,
          message,
        },
        rawText,
      );

      const agent = asPrivate(refs.zhinAgent);
      await agent.memory.appendPassiveGroupUserMessage(sessionId, content, {
        senderId: message.$sender.id,
        senderRoles: roles,
      });
      await agent.sessions.addMessage(sessionId, { role: 'user', content });
    });

    logger.debug(formatCompactLog('GroupSessionPassive', { hook: 'on' }));
    return () => {
      dispatcher.setGroupPassiveContextHandler?.(null);
      logger.debug(formatCompactLog('GroupSessionPassive', { hook: 'off' }));
    };
  });
}
