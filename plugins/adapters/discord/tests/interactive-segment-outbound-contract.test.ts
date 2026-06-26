/**
 * discord interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { DiscordAdapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('discord interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(DiscordAdapter);
  });
});
