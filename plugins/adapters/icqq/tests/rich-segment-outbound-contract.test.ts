/**
 * icqq Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { IcqqAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('icqq rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(IcqqAdapter, 'icqq');
  });
});
