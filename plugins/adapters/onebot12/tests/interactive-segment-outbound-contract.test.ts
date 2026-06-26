/**
 * onebot12 interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { OneBot12Adapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('onebot12 interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(OneBot12Adapter);
  });
});
