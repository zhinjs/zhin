/**
 * github Rich Segment outbound contract
 */
import { describe, it } from 'vitest';
import { GitHubAdapter } from '../src/adapter.js';
import { assertRichSegmentOutboundContract } from '../../../../packages/im/core/tests/helpers/rich-segment-adapter-contract.js';

describe('github rich segment outbound contract', () => {
  it('declares outboundRichSegmentPolicy and sendMessage', () => {
    assertRichSegmentOutboundContract(GitHubAdapter, 'github');
  });
});
