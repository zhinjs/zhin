/**
 * Register AI trigger handler via the core MessageDispatcher inbound pipeline.
 */
import './types.js';
import {
  getPlugin,
  isAtEndpoint,
  mergeAITriggerConfig,
  Message,
  shouldTriggerAI,
  segment,
} from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type { AIServiceRefs } from './shared-refs.js';
import { formatCompactLog, truncatePreview } from '@zhin.js/logger';
import { createInboundTurnPipeline } from '../collaboration/inbound-turn-pipeline.js';
import { isAskUserPendingReply } from '../builtin/ask-user-session.js';

function resolveEndpointAtIds(message: Message, root: Plugin): string[] {
  const ids = new Set<string>([String(message.$endpoint)]);
  try {
    const adapter = root.inject(message.$adapter) as
      | { endpoints?: Map<string, { $config?: Record<string, unknown>; $platformUserId?: string }> }
      | undefined;
    const endpoint = adapter?.endpoints?.get(message.$endpoint);
    const cfg = endpoint?.$config;
    if (cfg?.name) ids.add(String(cfg.name));
    if (cfg?.appid) ids.add(String(cfg.appid));
    if (endpoint?.$platformUserId) ids.add(String(endpoint.$platformUserId));
  } catch {
    // adapter 未就绪时仍用 message.$endpoint
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
            m: Message,
            s: 'ai' | 'command',
            c: unknown,
            options?: { quote?: boolean | string },
          ) => Promise<unknown>;
        }
      | undefined;

    const pipelineHandle = async (message: Message, content: string) => {
      const replyOutbound = async (payload: unknown, options?: { quote?: boolean }) => {
        const quote = options?.quote ?? true;
        if (dispatcherSvc && typeof dispatcherSvc.replyWithPolish === 'function') {
          return dispatcherSvc.replyWithPolish(message, 'ai', payload as never, { quote });
        }
        if (!message.$reply) {
          throw new Error(`Cannot reply: endpoint ${message.$endpoint} has no outbound capability`);
        }
        return quote ? message.$reply(payload as never, true) : message.$reply(payload as never);
      };

      return createInboundTurnPipeline({
        root,
        ai,
        refs,
        triggerConfig,
        peerMode: triggerConfig.peerMode,
        logger,
        replyOutbound,
      })(message, content);
    };

    const dispatcher = root.inject('dispatcher');
    if (!dispatcher || typeof dispatcher.setAIHandler !== 'function') {
      logger.warn(formatCompactLog('AI Handler', { error: 'no_dispatcher' }));
      return;
    }

    dispatcher.setAITriggerMatcher((message: Message) => {
      if (isAskUserPendingReply(message, root)) {
        logger.debug(formatCompactLog('AI Trigger', {
          skip: 'ask_user_pending_reply',
          endpoint: message.$endpoint,
        }));
        return { triggered: false, content: '' };
      }
      const endpointAtIds = resolveEndpointAtIds(message, root);
      const result = shouldTriggerAI(message, triggerConfig, { endpointAtIds });
      logger.debug(formatCompactLog('AI Trigger', {
        adapter: message.$adapter,
        endpoint: message.$endpoint,
        at: isAtEndpoint(message, endpointAtIds),
        triggered: result.triggered,
        preview: truncatePreview(segment.raw(message.$content)),
      }));
      return result;
    });
    dispatcher.setAIHandler(pipelineHandle);
    logger.debug(formatCompactLog('AI Handler', { hook: 'on', pipeline: 'aop' }));
    return () => { logger.debug(formatCompactLog('AI Handler', { hook: 'off' })); };
  });
}
