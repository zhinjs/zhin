/**
 * wechat-mp Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { WeChatMPAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('wechat-mp rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(WeChatMPAdapter, 'wechat-mp');
  });
});
