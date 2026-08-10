import { describe, expect, it } from 'vitest';
import {
  formatLegacyConversationTarget,
  formatLegacyConversationRef,
  formatLegacyMessageRef,
  nativeConversationId,
  parseLegacyConversationTarget,
  parseLegacyMessageReference,
  isDeliveryReceipt,
  supportsEndpointOperation,
  type DeliveryReceipt,
} from '../src/index.js';

describe('@zhin.js/im-contract', () => {
  it('keeps native ids intact when crossing the legacy target boundary', () => {
    expect(parseLegacyConversationTarget('group:123:456')).toEqual({ kind: 'group', id: '123:456' });
    expect(parseLegacyConversationTarget('direct:alice')).toEqual({ kind: 'private', id: 'alice' });
    expect(formatLegacyConversationTarget({ kind: 'channel', id: 'thread:42' })).toBe('channel:thread:42');
  });

  it('encodes structured references only at the legacy boundary', () => {
    const conversation = {
      endpoint: { id: 'adapter~main', adapter: 'sandbox' },
      kind: 'group' as const,
      id: 'room:42',
      threadId: 'thread-1',
    };
    expect(formatLegacyConversationRef(conversation)).toBe('group:room:42');
    expect(formatLegacyMessageRef({ conversation, id: 'message-9' }))
      .toBe('group:room:42:message-9');
  });

  it('rejects ambiguous or incomplete legacy targets', () => {
    expect(parseLegacyConversationTarget('123')).toBeUndefined();
    expect(parseLegacyConversationTarget('guild:123')).toBeUndefined();
    expect(parseLegacyConversationTarget('group:')).toBeUndefined();
  });

  it('keeps prefixed targets whole when parsing a legacy message reference', () => {
    expect(parseLegacyMessageReference('group:123:456')).toEqual({
      target: 'group:123',
      messageId: '456',
    });
    expect(formatLegacyMessageRef({
      conversation: {
        endpoint: { id: 'ep-1', adapter: 'test' },
        kind: 'channel',
        id: 'abc:def',
      },
      id: 'm-1',
    })).toBe('channel:abc:def:m-1');
    expect(nativeConversationId('group:123')).toBe('123');
    expect(nativeConversationId('opaque:123')).toBe('opaque:123');
  });

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

  it('recognizes structured receipts without confusing legacy endpoint results', () => {
    expect(isDeliveryReceipt({ status: 'sent', legacyMessageId: 'legacy-1' })).toBe(true);
    expect(isDeliveryReceipt({ status: 'unknown' })).toBe(false);
    expect(isDeliveryReceipt({ status: 'failed', legacyMessageId: 1 })).toBe(false);
    expect(isDeliveryReceipt('legacy-1')).toBe(false);
  });
});
