/**
 * github interactive segment outbound contract
 */
import { describe, it } from 'vitest';
import { GitHubAdapter } from '../src/adapter.js';
import { assertInteractiveOutboundContract } from '../../../../packages/im/core/tests/helpers/interactive-segment-adapter-contract.js';

describe('github interactive segment outbound contract', () => {
  it('declares interactivePolicy', () => {
    assertInteractiveOutboundContract(GitHubAdapter);
  });
});
