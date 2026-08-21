import { describe, expect, it } from 'vitest';
import {
  isDeliveryReceipt,
  supportsEndpointOperation,
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
});
