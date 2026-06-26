/**
 * telegram interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { TelegramAdapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('telegram interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(TelegramAdapter);
  });
});
