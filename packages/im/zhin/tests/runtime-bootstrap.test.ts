import { describe, it, expect } from 'vitest';

describe('runtime bootstrap exports', () => {
  it('exposes bootstrapNode from zhin.js/node', async () => {
    const mod = await import('../src/runtime/node.js');
    expect(typeof mod.bootstrapNode).toBe('function');
  });
});
