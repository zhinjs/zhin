import { formatCompact, getLogger } from '@zhin.js/logger';
import type { EndpointRuntime, SendContent } from '@zhin.js/core/runtime';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import {
  outboundHostToken,
  outboundRootHostToken,
  PluginOutboundHost,
  rootPluginId,
  type OutboundRootHost,
  type OutboundSendInput,
  type Locale,
  type CapturedOutboundOperation,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const logger = getLogger('OutboundHost');

export interface OutboundRuntimePort {
  readonly endpoints: Pick<
    EndpointRuntime,
    | 'captureOperation'
    | 'capabilities'
    | 'send'
    | 'sendTarget'
    | 'addReaction'
    | 'removeReaction'
    | 'recall'
    | 'edit'
    | 'typing'
  >;
  runWithSnapshotView<T>(operation: () => Promise<T>): Promise<T>;
}

export function createOutboundHost(im: OutboundRuntimePort): OutboundRootHost {
  return {
    async sendTarget(target, content, requester, options) {
      try {
        const result = options
          ? await im.endpoints.sendTarget(target, content, requester, options)
          : await im.endpoints.sendTarget(target, content, requester);
        return result.messageId || null;
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_send_failed',
          adapter: target.endpoint.adapter,
          endpointKey: target.endpoint.id,
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }
    },
    captureOperation(input, requester) {
      const captured = im.endpoints.captureOperation({ ...input, requester });
      const control = captured.control;
      return Object.freeze<CapturedOutboundOperation>({
        target: captured.target, signal: captured.signal,
        send: async (content: unknown, options?: Readonly<{ locale?: Locale; signal?: AbortSignal }>) => {
          const receipt = await captured.send(content as SendContent, options);
          if (receipt.status !== 'sent') {
            throw new EndpointDeliveryError(
              receipt.failure?.code ?? 'outbound_failed', receipt.failure?.message ?? 'Delivery was not confirmed.',
              receipt.failure?.deliveryUnknown ? 'unknown' : receipt.status === 'rejected' ? 'rejected' : 'not_sent');
          }
          return receipt.message?.id ?? null;
        },
        ...(control?.recall ? { recall: message => control.recall!({ message }) } : {}),
        ...(control?.edit ? { edit: (message, content) => control.edit!({ message, content }) } : {}),
        ...(control?.addReaction ? { addReaction: (message, emoji, hint) => control.addReaction!({ message, emoji, hint }) } : {}),
        ...(control?.removeReaction ? { removeReaction: (message, reactionId) => control.removeReaction!({ message, reactionId }) } : {}),
        ...(control?.typing ? { typing: (conversation, active) => control.typing!({ conversation, active }) } : {}),
        release: captured.release,
      });
    },
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
          ...(input.locale ? { locale: input.locale } : {}),
        });
        return result.messageId || null;
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_send_failed',
          adapter: input.adapter,
          endpointKey: input.endpointKey,
          error: error instanceof Error ? error.message : String(error),
        }));
        // Business callers must distinguish failed delivery from a successful
        // send without a platform message id. Optional activity feedback owns
        // its best-effort handling at the call site.
        throw error;
      }
    },
    async addReaction(input) {
      try {
        return await im.endpoints.addReaction({
          message: input.message,
          emoji: input.emoji,
          sceneType: input.sceneType,
          channelId: input.channelId,
        });
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_add_reaction_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
        return null;
      }
    },
    async removeReaction(input) {
      try {
        await im.endpoints.removeReaction({
          message: input.message,
          reactionId: input.reactionId,
        });
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_remove_reaction_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    async recall(input) {
      await im.endpoints.recall({
        message: input.message,
      });
    },
    async edit(input) {
      try {
        return await im.endpoints.edit({
          message: input.message,
          content: input.content,
        });
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_edit_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
        return null;
      }
    },
    async typing(input) {
      try {
        await im.endpoints.typing({
          conversation: input.conversation,
          active: input.active,
        });
      } catch (error) {
        logger.debug(formatCompact({
          op: 'outbound_typing_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
  };
}

export function installOutboundHost(im: OutboundRuntimePort): RootResourceInstaller {
  return ({ resources, admission }) => {
    const host = createOutboundHost(im);
    resources.provide(outboundRootHostToken, host);
    resources.provide(outboundHostToken, new PluginOutboundHost(rootPluginId(), host, admission));
  };
}
