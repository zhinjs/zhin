/**
 * dingtalk Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { DingTalkAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('dingtalk rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(DingTalkAdapter, 'dingtalk');
  });
});
