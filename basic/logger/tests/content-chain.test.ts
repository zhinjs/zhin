import { describe, it, expect } from 'vitest';
import { formatContentChainLog, CONTENT_CHAIN_STAGE } from '../src/content-chain-stages.js';

describe('formatContentChainLog', () => {
  it('includes stage and kind', () => {
    expect(formatContentChainLog({
      stage: CONTENT_CHAIN_STAGE.RICH_SEGMENT,
      kind: 'html',
      mode: 'image',
      fallback: false,
    })).toContain('stage: rich_segment');
  });
});
