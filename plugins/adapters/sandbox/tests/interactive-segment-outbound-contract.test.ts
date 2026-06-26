/**
 * sandbox interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { SandboxWsHostAdapter } from '../src/sandbox-ws.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('sandbox interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(SandboxWsHostAdapter);
  });
});
