/**
 * lark interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { LarkAdapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('lark interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(LarkAdapter);
  });
});
