/**
 * wecom Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { WecomAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('wecom rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(WecomAdapter, 'wecom');
  });
});
