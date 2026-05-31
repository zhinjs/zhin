/**
 * Typing Indicator AI Event Binder
 *
 * Automatically binds AI and ZhinAgent's lifecycle events to
 * appropriate TypingIndicators of corresponding platform bots.
 */

import { getPlugin } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import { subscribeAIEvents } from '../ai-event-subscriber.js';
import { enableTypingIndicatorForBot } from '../typing-indicator/adapter-integration.js';
import type { AIServiceRefs } from './shared-refs.js';

function resolveSceneType(sceneId?: string): 'private' | 'group' | 'channel' {
  if (!sceneId) return 'private';
  if (sceneId.startsWith('group:')) return 'group';
  if (sceneId.startsWith('channel:')) return 'channel';
  if (sceneId.startsWith('private:')) return 'private';
  return 'private';
}

export function registerTypingIndicator(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { root, logger } = plugin;

  // 绑定并订阅全局 AI 事件
  const dispose = subscribeAIEvents(root, {
    onProcessingStart: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId } = payload;
      if (!platform || !botId) return;

      try {
        const adapter = root.inject(platform as any) as any;
        const bot = adapter?.bots?.get(botId);
        if (!bot) {
          logger.debug(`[TypingIndicator] Bot not found for platform: ${platform}, botId: ${botId}`);
          return;
        }

        // 获取此 bot 的独有配置
        const botConfig = bot.$config || {};
        const config = botConfig.typingIndicator || {};

        // 如果配置中明确指明禁用，则不为其开启
        if (config.enabled === false) {
          return;
        }

        // 自动幂等初始化此 bot 的 TypingIndicatorManager
        const manager = enableTypingIndicatorForBot(bot, platform, config);
        const sceneType = resolveSceneType(sceneId);

        logger.debug(`[TypingIndicator] Auto starting indicator on event: processing.start for session: ${sessionId}`);
        await manager.start(
          {
            platform,
            botId,
            sessionId,
            messageId,
            sceneType,
          },
          config,
        );
      } catch (error) {
        logger.error('[TypingIndicator] Error handling processing.start event:', error);
      }
    },

    onProcessingFinish: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId } = payload;
      if (!platform || !botId) return;

      try {
        const adapter = root.inject(platform as any) as any;
        const bot = adapter?.bots?.get(botId);
        if (!bot) return;

        const manager = bot.$typingIndicator;
        if (!manager) return;

        const sceneType = resolveSceneType(sceneId);
        logger.debug(`[TypingIndicator] Auto stopping indicator on event: processing.finish for session: ${sessionId}`);
        await manager.stop({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
        });
      } catch (error) {
        logger.error('[TypingIndicator] Error handling processing.finish event:', error);
      }
    },

    onProcessingError: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId } = payload;
      if (!platform || !botId) return;

      try {
        const adapter = root.inject(platform as any) as any;
        const bot = adapter?.bots?.get(botId);
        if (!bot) return;

        const manager = bot.$typingIndicator;
        if (!manager) return;

        const sceneType = resolveSceneType(sceneId);
        logger.debug(`[TypingIndicator] Auto stopping indicator on event: processing.error for session: ${sessionId}`);
        await manager.stop({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
        });
      } catch (error) {
        logger.error('[TypingIndicator] Error handling processing.error event:', error);
      }
    },

    onThinking: async (payload) => {
      const { platform, botId, sessionId, messageId, sceneId, thinking } = payload;
      if (!platform || !botId || !thinking) return;

      try {
        const adapter = root.inject(platform as any) as any;
        const bot = adapter?.bots?.get(botId);
        if (!bot) return;

        const manager = bot.$typingIndicator;
        if (!manager) return;

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
        const adapter = root.inject(platform as any) as any;
        const bot = adapter?.bots?.get(botId);
        if (!bot) return;

        const manager = bot.$typingIndicator;
        if (!manager) return;

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
        const adapter = root.inject(platform as any) as any;
        const bot = adapter?.bots?.get(botId);
        if (!bot) return;

        const manager = bot.$typingIndicator;
        if (!manager) return;

        const sceneType = resolveSceneType(sceneId);
        const indicator = manager.getActiveIndicator({
          platform,
          botId,
          sessionId,
          messageId,
          sceneType,
        });

        if (indicator && typeof indicator.update === 'function') {
          const botConfig = bot.$config || {};
          const config = botConfig.typingIndicator || {};
          const msg = config.message || '正在处理中...';
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
