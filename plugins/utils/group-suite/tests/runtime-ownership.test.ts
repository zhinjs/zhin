import { describe, expect, it } from 'vitest';
import { addKeyword, listKeywords } from '../src/keyword-store.js';
import { createInMemoryGroupSuiteDb } from '../src/memory-store.js';
import { createGroupSuiteRuntime, resolveGroupSuiteRuntime } from '../src/runtime-state.js';
import { recordMessage } from '../src/stats-lib.js';

describe('group-suite owner-scoped runtime', () => {
  it('isolates ephemeral state between plugin instances', () => {
    const left = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    const right = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());

    addKeyword('hello', 'left', left.keywords);
    recordMessage({ sender: 'u1', target: 'g1', metadata: { type: 'group' } }, left);

    expect(listKeywords(left.keywords)).toEqual([['hello', 'left']]);
    expect(listKeywords(right.keywords)).toEqual([]);
    expect(left.statsBuffer.size).toBe(1);
    expect(right.statsBuffer.size).toBe(0);
  });

  it('resolves the runtime from the capability owner resource', () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    const resolved = resolveGroupSuiteRuntime({
      owner: { id: 'root/group-suite' },
      use: () => runtime,
    });

    expect(resolved).toBe(runtime);
  });
});
