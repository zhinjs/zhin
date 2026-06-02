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

/** 与 ToolContext.scope / Message.$channel.type 一致（群聊 sceneId 通常只是群号，无 group: 前缀） */
function resolveSceneType(payload: AIEventPayload): 'private' | 'group' | 'channel' {
  const scope = payload.scope;
  if (scope === 'group' || scope === 'channel' || scope === 'private') {
    return scope;
  }
  const sceneId = payload.sceneId ?? '';
  if (sceneId.startsWith('group:')) return 'group';
  if (sceneId.startsWith('channel:')) return 'channel';
  if (sceneId.startsWith('private:')) return 'private';
  return 'private';
}

/** sessionId 形如 platform:channelId:userId；群聊 channelId 在 sceneId */
function resolveTypingTargets(payload: AIEventPayload, sceneType: 'private' | 'group' | 'channel') {
  const { sceneId, userId, sessionId } = payload;
  const parts = sessionId.split(':').filter((p) => p.length > 0);
  let resolvedUserId = userId;
  let groupId: string | undefined;

  if (sceneType === 'group' || sceneType === 'channel') {
    groupId = sceneId?.replace(/^(group|channel):/, '') || sceneId;
    if (!groupId && parts.length >= 3) {
      groupId = parts[1];
    }
    if (!resolvedUserId && parts.length >= 3) {
      resolvedUserId = parts[parts.length - 1];
    }
  } else {
    if (sceneId?.startsWith('private:')) {
      resolvedUserId = sceneId.slice('private:'.length);
    } else if (!resolvedUserId && parts.length >= 2) {
      resolvedUserId = parts.length >= 3 ? parts[parts.length - 1] : parts[1];
    }
  }

  return {
    userId: resolvedUserId,
    groupId: sceneType === 'group' || sceneType === 'channel' ? groupId : undefined,
  };
}

function resolveTypingSceneConfig(
  config: Record<string, unknown>,
  sceneType: 'private' | 'group' | 'channel',
): Record<string, unknown> {
  const groupCfg = config.groupConfig as Record<string, unknown> | undefined;
  const privateCfg = config.privateConfig as Record<string, unknown> | undefined;
  if (sceneType === 'group' || sceneType === 'channel') {
    return { ...config, ...groupCfg };
  }
  return { ...config, ...privateCfg };
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
        const sceneType = resolveSceneType(payload);
        const targets = resolveTypingTargets(payload, sceneType);
        const sceneConfig = resolveTypingSceneConfig(config, sceneType);

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
            sceneConfig,
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

        const sceneType = resolveSceneType(payload);
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

        const sceneType = resolveSceneType(payload);
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

        const sceneType = resolveSceneType(payload);
        const targets = resolveTypingTargets(payload, sceneType);
        const indicator = manager.getActiveIndicator({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
          userId: targets.userId,
          groupId: targets.groupId,
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

        const sceneType = resolveSceneType(payload);
        const targets = resolveTypingTargets(payload, sceneType);
        const indicator = manager.getActiveIndicator({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
          userId: targets.userId,
          groupId: targets.groupId,
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

        const sceneType = resolveSceneType(payload);
        const targets = resolveTypingTargets(payload, sceneType);
        const indicator = manager.getActiveIndicator({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
          userId: targets.userId,
          groupId: targets.groupId,
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
