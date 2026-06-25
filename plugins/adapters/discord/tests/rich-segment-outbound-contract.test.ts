/**
 * discord Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { DiscordAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('discord rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(DiscordAdapter, 'discord');
  });
});
