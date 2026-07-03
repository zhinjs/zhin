/**
 * onebot11 AI outbound contract
 */
import { describe, it } from 'vitest';
import { OneBot11Adapter } from '../src/adapter.js';
import { assertAiOutboundContract } from '../../../../packages/im/core/tests/helpers/ai-outbound-adapter-contract.js';

describe('onebot11 ai outbound contract', () => {
  it('declares aiOutboundCapabilities and extensions', () => {
    assertAiOutboundContract(OneBot11Adapter, 'onebot11');
  });
});
