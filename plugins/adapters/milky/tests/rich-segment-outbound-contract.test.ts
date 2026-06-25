/**
 * milky Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { MilkyAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('milky rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(MilkyAdapter, 'milky');
  });
});
