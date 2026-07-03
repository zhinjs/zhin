/**
 * napcat AI outbound contract
 */
import { describe, it } from 'vitest';
import { NapCatAdapter } from '../src/adapter.js';
import { assertAiOutboundContract } from '../../../../packages/im/core/tests/helpers/ai-outbound-adapter-contract.js';

describe('napcat ai outbound contract', () => {
  it('declares aiOutboundCapabilities and extensions', () => {
    assertAiOutboundContract(NapCatAdapter, 'napcat');
  });
});
