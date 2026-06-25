/**
 * telegram Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { TelegramAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('telegram rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(TelegramAdapter, 'telegram');
  });
});
