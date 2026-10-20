import { formatCompact, getLogger } from '@zhin.js/logger';
import type { EndpointRuntime } from '@zhin.js/core/runtime';
import {
  outboundHostToken,
  outboundRootHostToken,
  PluginOutboundHost,
  rootPluginId,
  type OutboundEndpointInput,
  type OutboundManagementOperation,
  type OutboundMuteGroupMemberInput,
  type OutboundRootHost,
  type OutboundSendInput,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const logger = getLogger('OutboundHost');

export interface OutboundRuntimePort {
  readonly endpoints: Pick<
    EndpointRuntime,
    | 'capabilities'
    | 'send'
    | 'sendTarget'
    | 'addReaction'
    | 'removeReaction'
    | 'recall'
    | 'edit'
    | 'typing'
  > & Partial<Pick<EndpointRuntime, 'get' | 'withManagement'>>;
  runWithSnapshotView<T>(operation: () => Promise<T>): Promise<T>;
}

const outboundManagementOperations: readonly OutboundManagementOperation[] = ['muteGroupMember'];

function declaredManagement(
  im: OutboundRuntimePort,
  input: OutboundEndpointInput,
): readonly OutboundManagementOperation[] {
  const detail = im.endpoints.get?.(input.adapter, input.endpointKey);
  const implemented = detail?.managementCapabilities ?? [];
  return Object.freeze(outboundManagementOperations.filter(
    (operation) => implemented.includes(operation),
  ));
}

export function createOutboundHost(im: OutboundRuntimePort): OutboundRootHost {
  return {
    async sendTarget(target, content, requester) {
      try {
        const result = await im.endpoints.sendTarget(target, content, requester);
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
    runWithView: (operation) => im.runWithSnapshotView(operation),
    capabilities(input) {
      const capabilities = im.endpoints.capabilities(input);
      const operations = capabilities?.operations;
      const management = declaredManagement(im, input);
      const declared = operations
        ? Object.freeze(
          (['recall', 'edit', 'reaction', 'typing'] as const)
            .filter((operation) => operations[operation] === true),
        )
        : Object.freeze([]);
      if (management.length === 0) return { operations: declared };
      return { operations: declared, management };
    },
    async muteGroupMember(input: OutboundMuteGroupMemberInput) {
      const withManagement = im.endpoints.withManagement;
      if (!withManagement) {
        throw new Error('Endpoint management is not available in this runtime');
      }
      const muted = await withManagement.call(
        im.endpoints,
        input.adapter,
        input.endpointKey,
        async (management) => {
          if (typeof management.muteGroupMember !== 'function') return false;
          await management.muteGroupMember(input.groupId, input.userId, input.durationSeconds);
          return true;
        },
      );
      if (muted !== true) {
        throw new Error(`Endpoint ${input.adapter}/${input.endpointKey} does not support muteGroupMember`);
      }
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
  return ({ resources, admission }) => {
    const host = createOutboundHost(im);
    resources.provide(outboundRootHostToken, host);
    resources.provide(outboundHostToken, new PluginOutboundHost(rootPluginId(), host, admission));
  };
}
