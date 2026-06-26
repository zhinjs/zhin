/**
 * milky interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { MilkyAdapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('milky interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(MilkyAdapter);
  });
});
