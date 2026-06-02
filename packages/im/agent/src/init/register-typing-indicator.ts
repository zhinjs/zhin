/**
 * Typing Indicator AI Event Binder
 *
 * 订阅 root 上的 AI 生命周期事件，驱动各平台 Bot 已有的 Typing Indicator。
 * 平台适配器（如 ICQQ）应在 Bot 连接时自行挂载 `$typingIndicator`；
 * 仅对未挂载的 Bot 才用通用 enableTypingIndicatorForBot 兜底。
 */

import { getPlugin } from '@zhin.js/core';
import type { Adapter, Plugin } from '@zhin.js/core';
import { subscribeAIEvents } from '../ai-event-subscriber.js';
import {
  enableTypingIndicatorForBot,
  type BotTypingIndicatorManager,
  type BotWithTypingIndicator,
} from '../typing-indicator/adapter-integration.js';
import type { TypingIndicatorManager } from '../typing-indicator/index.js';
import type { AIServiceRefs } from './shared-refs.js';
import type { AIEventPayload } from '../ai-event-subscriber.js';

function resolveSceneType(sceneId?: string): 'private' | 'group' | 'channel' {
  if (!sceneId) return 'private';
  if (sceneId.startsWith('group:')) return 'group';
  if (sceneId.startsWith('channel:')) return 'channel';
  if (sceneId.startsWith('private:')) return 'private';
  return 'private';
}

/** 从事件 payload 解析 ICQQ 等平台 start/stop 需要的 userId / groupId */
function resolveTypingTargets(payload: AIEventPayload, sceneType: 'private' | 'group' | 'channel') {
  const { sceneId, userId, sessionId } = payload;
  let groupId: string | undefined;
  let resolvedUserId = userId;

  if (sceneId?.startsWith('group:')) {
    groupId = sceneId.slice('group:'.length);
  } else if (sceneId?.startsWith('private:') && !resolvedUserId) {
    resolvedUserId = sceneId.slice('private:'.length);
  }

  if (!groupId && sessionId.startsWith('group:')) {
    groupId = sessionId.slice('group:'.length);
  }
  if (!resolvedUserId && sessionId.startsWith('private:')) {
    resolvedUserId = sessionId.slice('private:'.length);
  }

  return {
    userId: resolvedUserId,
    groupId: sceneType === 'group' ? groupId : undefined,
  };
}

function isGenericTypingManager(manager: BotTypingIndicatorManager): manager is TypingIndicatorManager {
  return typeof (manager as TypingIndicatorManager).getActiveIndicator === 'function';
}

function resolveTypingManager(
  bot: BotWithTypingIndicator,
  platform: string,
  config: Record<string, unknown>,
  adapter: Adapter,
): BotTypingIndicatorManager {
  if (bot.$typingIndicator) {
    return bot.$typingIndicator;
  }
  return enableTypingIndicatorForBot(bot, platform, config, adapter);
}

export function registerTypingIndicator(_refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { root, logger } = plugin;

  const dispose = subscribeAIEvents(root, {
    onProcessingStart: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId } = payload;
      if (!platform || !botId) return;

      try {
        const adapter = root.injectAdapter(platform);
        const bot = adapter?.bots?.get(botId) as BotWithTypingIndicator | undefined;
        if (!bot) {
          logger.debug(`[TypingIndicator] Bot not found for platform: ${platform}, botId: ${botId}`);
          return;
        }

        const botConfig = (bot.$config || {}) as Record<string, unknown>;
        const config = (botConfig.typingIndicator || {}) as Record<string, unknown>;
        if (config.enabled === false) {
          return;
        }

        const manager = resolveTypingManager(bot, platform, config, adapter!);
        const sceneType = resolveSceneType(sceneId);
        const targets = resolveTypingTargets(payload, sceneType);

        logger.debug(
          `[TypingIndicator] Auto starting indicator on event: processing.start for session: ${sessionId}`,
        );

        if (isGenericTypingManager(manager)) {
          await manager.start(
            {
              platform,
              botId,
              sessionId,
              messageId,
              sceneType,
              userId: targets.userId,
              groupId: targets.groupId,
            },
            config,
          );
        } else {
          await manager.start({
            messageId,
            sessionId,
            userId: targets.userId,
            groupId: targets.groupId,
            sceneType: sceneType === 'channel' ? 'group' : sceneType,
          });
        }
      } catch (error) {
        logger.error('[TypingIndicator] Error handling processing.start event:', error);
      }
    },

    onProcessingFinish: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId } = payload;
      if (!platform || !botId) return;

      try {
        const adapter = root.injectAdapter(platform);
        const bot = adapter?.bots?.get(botId) as BotWithTypingIndicator | undefined;
        if (!bot?.$typingIndicator) return;

        const sceneType = resolveSceneType(sceneId);
        const targets = resolveTypingTargets(payload, sceneType);
        const manager = bot.$typingIndicator;

        logger.debug(
          `[TypingIndicator] Auto stopping indicator on event: processing.finish for session: ${sessionId}`,
        );

        if (isGenericTypingManager(manager)) {
          await manager.stop({
            platform,
            botId,
            sessionId,
            messageId,
            sceneType,
            userId: targets.userId,
            groupId: targets.groupId,
          });
        } else {
          await manager.stop({
            sessionId,
            userId: targets.userId,
            groupId: targets.groupId,
          });
        }
      } catch (error) {
        logger.error('[TypingIndicator] Error handling processing.finish event:', error);
      }
    },

    onProcessingError: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId } = payload;
      if (!platform || !botId) return;

      try {
        const adapter = root.injectAdapter(platform);
        const bot = adapter?.bots?.get(botId) as BotWithTypingIndicator | undefined;
        if (!bot?.$typingIndicator) return;

        const sceneType = resolveSceneType(sceneId);
        const targets = resolveTypingTargets(payload, sceneType);
        const manager = bot.$typingIndicator;

        logger.debug(
          `[TypingIndicator] Auto stopping indicator on event: processing.error for session: ${sessionId}`,
        );

        if (isGenericTypingManager(manager)) {
          await manager.stop({
            platform,
            botId,
            sessionId,
            messageId,
            sceneType,
            userId: targets.userId,
            groupId: targets.groupId,
          });
        } else {
          await manager.stop({
            sessionId,
            userId: targets.userId,
            groupId: targets.groupId,
          });
        }
      } catch (error) {
        logger.error('[TypingIndicator] Error handling processing.error event:', error);
      }
    },

    onThinking: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId, thinking } = payload;
      if (!platform || !botId || !thinking) return;

      try {
        const adapter = root.injectAdapter(platform);
        const bot = adapter?.bots?.get(botId) as BotWithTypingIndicator | undefined;
        const manager = bot?.$typingIndicator;
        if (!manager || !isGenericTypingManager(manager)) return;

        const sceneType = resolveSceneType(sceneId);
        const indicator = manager.getActiveIndicator({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
        });

        if (indicator && typeof indicator.update === 'function') {
          await indicator.update(thinking);
        }
      } catch (error) {
        logger.error('[TypingIndicator] Error handling thinking event:', error);
      }
    },

    onSubagentStart: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId, label } = payload;
      if (!platform || !botId) return;

      try {
        const adapter = root.injectAdapter(platform);
        const bot = adapter?.bots?.get(botId) as BotWithTypingIndicator | undefined;
        const manager = bot?.$typingIndicator;
        if (!manager || !isGenericTypingManager(manager)) return;

        const sceneType = resolveSceneType(sceneId);
        const indicator = manager.getActiveIndicator({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
        });

        if (indicator && typeof indicator.update === 'function') {
          const updateText = label ? `🔍 子任务执行里: ${label}...` : '🔍 正在调度和思考子代理处理...';
          await indicator.update(updateText);
        }
      } catch (error) {
        logger.error('[TypingIndicator] Error handling subagent.start event:', error);
      }
    },

    onSubagentFinish: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId } = payload;
      if (!platform || !botId) return;

      try {
        const adapter = root.injectAdapter(platform);
        const bot = adapter?.bots?.get(botId) as BotWithTypingIndicator | undefined;
        const manager = bot?.$typingIndicator;
        if (!manager || !isGenericTypingManager(manager)) return;

        const sceneType = resolveSceneType(sceneId);
        const indicator = manager.getActiveIndicator({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
        });

        if (indicator && typeof indicator.update === 'function') {
          const botConfig = (bot?.$config || {}) as Record<string, unknown>;
          const config = (botConfig.typingIndicator || {}) as Record<string, unknown>;
          const msg = String(config.message || '正在处理中...');
          await indicator.update(msg);
        }
      } catch (error) {
        logger.error('[TypingIndicator] Error handling subagent.finish event:', error);
      }
    },
  });

  plugin.on('dispose', () => {
    logger.debug('[TypingIndicator] Disposing AI Event TypingIndicator Binder');
    dispose();
  });
}
