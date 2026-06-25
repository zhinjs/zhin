/**
 * onebot11 Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { OneBot11Adapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('onebot11 rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(OneBot11Adapter, 'onebot11');
  });
});
