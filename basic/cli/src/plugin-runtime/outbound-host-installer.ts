import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ImRuntime } from '@zhin.js/core/runtime';
import {
  outboundHostToken,
  type OutboundHost,
  type OutboundSendInput,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const logger = getLogger('OutboundHost');

export function createOutboundHost(im: ImRuntime): OutboundHost {
  return {
    async send(input: OutboundSendInput): Promise<string | null> {
      try {
        const result = await im.sendEndpointMessage({
          adapter: input.adapter,
          endpointId: input.endpointId,
          channelType: input.channelType,
          channelId: input.channelId,
          content: input.content,
        });
        return result.messageId || null;
      } catch (error) {
        // activity-feedback typing text is best-effort; the adapter/endpoint
        // may not be resolvable when the AI event carries a capability id
        // instead of the short platform name (sandbox console smoke, etc.).
        logger.debug(formatCompact({
          op: 'outbound_send_failed',
          adapter: input.adapter,
          endpointId: input.endpointId,
          error: error instanceof Error ? error.message : String(error),
        }));
        // Do NOT re-throw — a failed typing indicator must never fail the
        // AI turn pipeline that triggered it.
        return null;
      }
    },
    async addReaction(input) {
      return im.addEndpointReaction({
        adapter: input.adapter,
        endpointId: input.endpointId,
        messageId: input.messageId,
        emoji: input.emoji,
        sceneType: input.sceneType,
        channelId: input.channelId,
      });
    },
    async removeReaction(input) {
      await im.removeEndpointReaction({
        adapter: input.adapter,
        endpointId: input.endpointId,
        messageId: input.messageId,
        reactionId: input.reactionId,
      });
    },
    async recall(input) {
      await im.recallEndpointMessage({
        adapter: input.adapter,
        endpointId: input.endpointId,
        messageId: input.messageId,
      });
    },
  };
}

export function installOutboundHost(im: ImRuntime): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(outboundHostToken, createOutboundHost(im));
  };
}
