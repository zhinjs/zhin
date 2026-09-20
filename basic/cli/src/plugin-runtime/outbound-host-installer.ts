import { formatCompact, getLogger } from '@zhin.js/logger';
import type { EndpointRuntime } from '@zhin.js/core/runtime';
import {
  outboundHostToken,
  type OutboundHost,
  type OutboundSendInput,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const logger = getLogger('OutboundHost');

export interface OutboundRuntimePort {
  readonly endpoints: Pick<
    EndpointRuntime,
    | 'capabilities'
    | 'send'
    | 'addReaction'
    | 'removeReaction'
    | 'recall'
    | 'edit'
    | 'typing'
  >;
  runWithSnapshotView<T>(operation: () => Promise<T>): Promise<T>;
}

export function createOutboundHost(im: OutboundRuntimePort): OutboundHost {
  return {
    runWithView: (operation) => im.runWithSnapshotView(operation),
    capabilities(input) {
      const capabilities = im.endpoints.capabilities(input);
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
        const result = await im.endpoints.send({
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
        return await im.endpoints.addReaction({
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
        await im.endpoints.removeReaction({
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
      await im.endpoints.recall({
        adapter: input.adapter,
        endpointKey: input.endpointKey,
        message: input.message,
      });
    },
    async edit(input) {
      try {
        return await im.endpoints.edit({
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
        await im.endpoints.typing({
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

export function installOutboundHost(im: OutboundRuntimePort): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(outboundHostToken, createOutboundHost(im));
  };
}
