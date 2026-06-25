/**
 * satori Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { SatoriAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('satori rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(SatoriAdapter, 'satori');
  });
});
