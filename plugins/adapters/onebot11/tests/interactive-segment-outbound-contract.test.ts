/**
 * onebot11 interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { OneBot11Adapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('onebot11 interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(OneBot11Adapter);
  });
});
