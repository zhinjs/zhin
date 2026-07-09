/**
 * 群/频道共享 session：未 @ 机器人的消息写入 ContextRepository，供后续 @ 时带入上下文。
 * AI 回复仍仅由 shouldTriggerAI（群/频道下主要为 @）触发。
 */
import {
  getPlugin,
  isActionMessage,
  mergeAITriggerConfig,
  resolveSenderRoles,
  extractTextContent,
} from '@zhin.js/core';
import type { Message } from '@zhin.js/core';
import { formatCompactLog } from '@zhin.js/logger';
import { findCellForInbound } from '../collaboration/collaboration-config.js';
import { getCollaborationSceneService } from '../collaboration/scene-service.js';
import { recordPassiveGroupMessage } from '../zhin-agent/passive-group-session.js';
import { asPrivate } from '../zhin-agent/zhin-agent-private.js';
import type { AIServiceRefs } from './shared-refs.js';

function isBotSelfMessage(message: Message): boolean {
  const senderId = String(message.$sender?.id ?? '');
  const endpointId = String(message.$endpoint ?? '');
  return senderId !== '' && endpointId !== '' && senderId === endpointId;
}

export function registerGroupSessionPassive(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { root, logger } = plugin;

  plugin.useContext('ai', (ai) => {
    const dispatcher = root.inject('dispatcher') as
      | { setGroupPassiveContextHandler?: (h: ((m: Message) => Promise<void>) | null) => void }
      | undefined;

    if (!dispatcher?.setGroupPassiveContextHandler) {
      logger.debug(formatCompactLog('GroupSessionPassive', { skip: 'no_dispatcher' }));
      return;
    }

    dispatcher.setGroupPassiveContextHandler(async (message) => {
      if (!refs.zhinAgent || isBotSelfMessage(message) || isActionMessage(message)) return;

      const triggerConfig = mergeAITriggerConfig(ai.getTriggerConfig());
      const adapterInstance = root.inject(message.$adapter) as
        | { endpoints?: Map<string, { $config?: Record<string, unknown> }> }
        | undefined;
      const endpointConfig = adapterInstance?.endpoints?.get(message.$endpoint)?.$config;

      const { scope, roles } = resolveSenderRoles(message, triggerConfig, endpointConfig);
      void scope;
      void roles;
      const rawText = extractTextContent(message).trim();
      if (!rawText) return;

      const endpointId = String(message.$endpoint ?? '');
      const channelScope = message.$channel?.type;
      const sceneId = message.$channel?.id ?? '';
      let cell =
        (channelScope === 'group' || channelScope === 'channel') && sceneId !== ''
          ? findCellForInbound(
            getCollaborationSceneService().listScenes(),
            String(message.$adapter),
            String(sceneId),
            endpointId,
          )
          : undefined;
      if (cell) {
        cell = (await getCollaborationSceneService().getSceneFresh(cell.id)) ?? cell;
      }

      const agent = asPrivate(refs.zhinAgent);
      await recordPassiveGroupMessage(agent, message, rawText, cell);
    });

    logger.debug(formatCompactLog('GroupSessionPassive', { hook: 'on' }));
    return () => {
      dispatcher.setGroupPassiveContextHandler?.(null);
      logger.debug(formatCompactLog('GroupSessionPassive', { hook: 'off' }));
    };
  });
}
