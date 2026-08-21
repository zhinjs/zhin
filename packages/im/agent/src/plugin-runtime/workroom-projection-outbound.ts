import type { MessageGateway } from '@zhin.js/core/runtime';
import type {
  WorkroomProjectionDeliveryPort,
  WorkroomProjectionDeliveryResult,
  WorkroomProjectionOutboxItem,
} from '../workroom/projection-outbox.js';

type ProjectionRequester = Parameters<MessageGateway['send']>[0]['requester'];

/**
 * Composition adapter for the canonical IM outbound chain. MessageGateway
 * owns render, before.sendMessage middleware and Endpoint delivery.
 */
export function createWorkroomProjectionMessageGatewayPort(
  gateway: MessageGateway,
  requester: ProjectionRequester,
): WorkroomProjectionDeliveryPort {
  return Object.freeze({
    async send(
      item: WorkroomProjectionOutboxItem,
      body: Uint8Array,
      signal: AbortSignal,
    ): Promise<WorkroomProjectionDeliveryResult> {
      signal.throwIfAborted();
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(body);
      } catch (error) {
        return Object.freeze({ status: 'failed', code: 'governed_body_invalid', retryable: false });
      }
      const receipt = await gateway.send({
        requester,
        conversation: item.conversation,
        content,
      });
      if (receipt.status === 'sent') {
        return Object.freeze({
          status: 'sent',
          ...(receipt.message ? { message: receipt.message } : {}),
        });
      }
      return Object.freeze({
        status: 'failed',
        code: receipt.failure?.code ?? `projection_${receipt.status}`,
        retryable: receipt.status === 'failed' && receipt.failure?.retryable === true,
      });
    },
  });
}
