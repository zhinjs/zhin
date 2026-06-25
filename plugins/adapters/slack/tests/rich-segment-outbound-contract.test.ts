/**
 * slack Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { SlackAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('slack rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(SlackAdapter, 'slack');
  });
});
