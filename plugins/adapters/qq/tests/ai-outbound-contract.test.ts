/**
 * qq AI outbound contract
 */
import { describe, it } from 'vitest';
import { QQAdapter } from '../src/adapter.js';
import { assertAiOutboundContract } from '../../../../packages/im/core/tests/helpers/ai-outbound-adapter-contract.js';

describe('qq ai outbound contract', () => {
  it('declares aiOutboundCapabilities and extensions', () => {
    assertAiOutboundContract(QQAdapter, 'qq');
  });
});
