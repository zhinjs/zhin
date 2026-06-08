import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/zhin-agent/config.js';
import {
  buildDeferredAutoContinueUserMessage,
  DEFERRED_AUTO_CONTINUE_MARKER,
  isDeferredAutoContinueEnabled,
  shouldDeferredAutoContinue,
} from '../../src/zhin-agent/deferred-auto-continue.js';
import type { DeferredWorkerResult } from '../../src/deferred-worker-runner.js';

function makeResult(overrides: Partial<DeferredWorkerResult> = {}): DeferredWorkerResult {
  return {
    summary: JSON.stringify({ status: 'ok', summary: 'exam batch 1 ready' }),
    loadedToolNames: ['web_fetch'],
    iterations: 2,
    status: 'ok',
    toolCalls: [],
    ...overrides,
  };
}

describe('deferred-auto-continue', () => {
  it('buildDeferredAutoContinueUserMessage includes marker and task id', () => {
    const message = buildDeferredAutoContinueUserMessage('abc12345', 'start exam', 'ok');
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    expect(text).toContain(DEFERRED_AUTO_CONTINUE_MARKER);
    expect(text).toContain('abc12345');
    expect(text).toContain('start exam');
  });

  it('shouldDeferredAutoContinue returns true when enabled and persisted ok result', () => {
    const enabled = { ...DEFAULT_CONFIG, deferredAutoContinue: true };
    expect(shouldDeferredAutoContinue(enabled, makeResult(), 0, true)).toBe(true);
    expect(shouldDeferredAutoContinue(DEFAULT_CONFIG, makeResult(), 0, true)).toBe(false);
  });

  it('shouldDeferredAutoContinue rejects error, empty body, max depth, not persisted', () => {
    const config = { ...DEFAULT_CONFIG, deferredAutoContinueMaxDepth: 2 };
    expect(shouldDeferredAutoContinue(config, makeResult({ status: 'error' }), 0, true)).toBe(false);
    expect(shouldDeferredAutoContinue(config, makeResult({ summary: '   ' }), 0, true)).toBe(false);
    expect(shouldDeferredAutoContinue(config, makeResult(), 2, true)).toBe(false);
    expect(shouldDeferredAutoContinue(config, makeResult(), 0, false)).toBe(false);
  });

  it('isDeferredAutoContinueEnabled respects config and env', () => {
    expect(isDeferredAutoContinueEnabled({ ...DEFAULT_CONFIG, deferredAutoContinue: false }, {})).toBe(false);
    expect(isDeferredAutoContinueEnabled(DEFAULT_CONFIG, { ZHIN_DEFERRED_AUTO_CONTINUE: 'false' })).toBe(false);
    expect(isDeferredAutoContinueEnabled({ ...DEFAULT_CONFIG, deferredAutoContinue: false }, { ZHIN_DEFERRED_AUTO_CONTINUE: 'true' })).toBe(true);
  });
});
