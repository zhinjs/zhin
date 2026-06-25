/**
 * weixin-ilink Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { WeixinIlinkAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('weixin-ilink rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(WeixinIlinkAdapter, 'weixin-ilink');
  });
});
