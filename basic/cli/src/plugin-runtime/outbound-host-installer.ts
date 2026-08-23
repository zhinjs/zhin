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
    runWithView: (operation) => im.runWithSnapshotView(operation),
    capabilities(input) {
      const capabilities = im.endpointCapabilities(input);
      const operations = capabilities?.operations;
      if (!operations) return { operations: Object.freeze([]) };
      return {
        operations: Object.freeze(
          (['recall', 'edit', 'reaction', 'typing'] as const)
            .filter((operation) => operations[operation] === true),
        ),
      };
    },
    async send(input: OutboundSendInput): Promise<string | null> {
      try {
        const result = await im.sendEndpointMessage({
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          conversation: input.conversation,
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
          endpointKey: input.endpointKey,
          error: error instanceof Error ? error.message : String(error),
        }));
        // Do NOT re-throw — a failed typing indicator must never fail the
        // AI turn pipeline that triggered it.
        return null;
      }
    },
    async addReaction(input) {
      try {
        return await im.addEndpointReaction({
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          message: input.message,
          emoji: input.emoji,
          sceneType: input.sceneType,
          channelId: input.channelId,
        });
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_add_reaction_failed',
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          error: error instanceof Error ? error.message : String(error),
        }));
        return null;
      }
    },
    async removeReaction(input) {
      try {
        await im.removeEndpointReaction({
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          message: input.message,
          reactionId: input.reactionId,
        });
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_remove_reaction_failed',
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    async recall(input) {
      await im.recallEndpointMessage({
        adapter: input.adapter,
        endpointKey: input.endpointKey,
        message: input.message,
      });
    },
    async edit(input) {
      try {
        return await im.editEndpointMessage({
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          message: input.message,
          content: input.content,
        });
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_edit_failed',
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          error: error instanceof Error ? error.message : String(error),
        }));
        return null;
      }
    },
    async typing(input) {
      try {
        await im.setEndpointTyping({
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          conversation: input.conversation,
          active: input.active,
        });
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_typing_failed',
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
  };
}

export function installOutboundHost(im: ImRuntime): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(outboundHostToken, createOutboundHost(im));
  };
}
