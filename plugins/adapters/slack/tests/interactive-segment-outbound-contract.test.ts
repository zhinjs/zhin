/**
 * slack interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { SlackAdapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('slack interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(SlackAdapter);
  });
});
