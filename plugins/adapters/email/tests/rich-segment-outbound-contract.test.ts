/**
 * email Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { EmailAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('email rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(EmailAdapter, 'email');
  });
});
