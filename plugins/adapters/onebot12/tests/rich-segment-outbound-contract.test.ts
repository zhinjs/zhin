/**
 * onebot12 Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { OneBot12Adapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('onebot12 rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(OneBot12Adapter, 'onebot12');
  });
});
