import { describe, it, expect } from 'vitest';
import { createWarnOnce, resetWarnOnceForTests } from '../src/warn-once.js';
import { formatContentChainLog, CONTENT_CHAIN_STAGE } from '../src/content-chain-stages.js';

describe('createWarnOnce', () => {
  it('warns only once per key', () => {
    resetWarnOnceForTests('test-key');
    const warnOnce = createWarnOnce('test-key');
    const calls: string[] = [];
    const warn = (msg: string) => calls.push(msg);
    warnOnce(warn, 'a');
    warnOnce(warn, 'b');
    expect(calls).toEqual(['a']);
  });
});

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
