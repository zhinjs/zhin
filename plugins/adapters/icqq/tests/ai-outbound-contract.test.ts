/**
 * icqq AI outbound contract
 */
import { describe, it } from 'vitest';
import { IcqqAdapter } from '../src/adapter.js';
import { assertAiOutboundContract } from '../../../../packages/im/core/tests/helpers/ai-outbound-adapter-contract.js';

describe('icqq ai outbound contract', () => {
  it('declares aiOutboundCapabilities and extensions', () => {
    assertAiOutboundContract(IcqqAdapter, 'icqq');
  });
});
