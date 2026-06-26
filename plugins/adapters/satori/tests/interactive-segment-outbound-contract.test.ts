/**
 * satori interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { SatoriAdapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('satori interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(SatoriAdapter);
  });
});
