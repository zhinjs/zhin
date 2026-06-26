/**
 * wecom interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { WecomAdapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('wecom interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(WecomAdapter);
  });
});
