/**
 * kook Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { KookAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('kook rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(KookAdapter, 'kook');
  });
});
