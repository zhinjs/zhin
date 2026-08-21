import { describe, expect, it } from 'vitest';
import {
  MemoryConversationEventStore,
  isDeliveryReceipt,
  supportsEndpointOperation,
  type ConversationEvent,
  type DeliveryReceipt,
} from '../src/index.js';

describe('@zhin.js/im-contract', () => {
  it('makes endpoint operations declarative', () => {
    const capabilities = {
      inbound: true,
      outbound: true,
      operations: { recall: true },
    } as const;

    expect(supportsEndpointOperation(capabilities, 'send')).toBe(true);
    expect(supportsEndpointOperation(capabilities, 'recall')).toBe(true);
    expect(supportsEndpointOperation(capabilities, 'edit')).toBe(false);
  });

  it('keeps delivery receipts structured and serializable', () => {
    const receipt: DeliveryReceipt = {
      status: 'sent',
      message: {
        id: 'm-1',
        conversation: {
          endpoint: { id: 'adapter~main', adapter: 'sandbox' },
          kind: 'private',
          id: 'u-1',
        },
      },
    };

    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
  });

  it('recognizes structured receipts without confusing endpoint-native results', () => {
    expect(isDeliveryReceipt({ status: 'sent' })).toBe(true);
    expect(isDeliveryReceipt({ status: 'unknown' })).toBe(false);
    expect(isDeliveryReceipt('native-1')).toBe(false);
  });

  it('stores conversation facts idempotently and resolves messages by canonical reference', async () => {
    const store = new MemoryConversationEventStore();
    const conversation = {
      endpoint: { id: 'adapter~main', adapter: 'icqq' },
      kind: 'group' as const,
      id: 'group-1',
    };
    const event: ConversationEvent = {
      eventId: 'message:m-1',
      conversation,
      timestamp: 100,
      type: 'message.created',
      message: {
        ref: { conversation, id: 'm-1' },
        actor: { id: 'u-1', displayName: 'Alice' },
        segments: [{ type: 'text', data: { text: 'hello' } }],
        timestamp: 100,
      },
    };

    expect(await store.append(event)).toEqual({ appended: true, sequence: 1 });
    expect(await store.append(event)).toEqual({ appended: false, sequence: 1 });
    expect(await store.getMessage(event.message.ref)).toEqual(event.message);
    expect(await store.listAfter(conversation, 0, 10)).toEqual([
      expect.objectContaining({ sequence: 1, event }),
    ]);
  });

  it('keeps forwarded speakers neutral instead of assigning model roles', () => {
    const entry = {
      actor: { id: 'u-1', displayName: 'Alice' },
      segments: [{ type: 'text', data: { text: 'forwarded' } }],
      timestamp: 100,
    };
    expect(entry).not.toHaveProperty('role');
  });
});
