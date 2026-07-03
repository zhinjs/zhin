/**
 * milky AI outbound contract
 */
import { describe, it } from 'vitest';
import { MilkyAdapter } from '../src/adapter.js';
import { assertAiOutboundContract } from '../../../../packages/im/core/tests/helpers/ai-outbound-adapter-contract.js';

describe('milky ai outbound contract', () => {
  it('declares aiOutboundCapabilities and extensions', () => {
    assertAiOutboundContract(MilkyAdapter, 'milky');
  });
});
