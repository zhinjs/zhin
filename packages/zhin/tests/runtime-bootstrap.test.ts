import { describe, it, expect } from 'vitest';

describe('runtime bootstrap exports', () => {
  it('exposes bootstrapNode from zhin.js/node', async () => {
    const mod = await import('../src/runtime/node.js');
    expect(typeof mod.bootstrapNode).toBe('function');
  });

  it('exposes bootstrapEdgeCore and bootstrapDeno', async () => {
    const edge = await import('../src/runtime/edge-core.js');
    const deno = await import('../src/runtime/deno.js');
    expect(typeof edge.bootstrapEdgeCore).toBe('function');
    expect(typeof deno.bootstrapDeno).toBe('function');
  });

  it('exposes thin runtime aliases for vercel and cloudflare', async () => {
    const vercel = await import('../src/runtime/vercel.js');
    const cf = await import('../src/runtime/cloudflare.js');
    expect(typeof vercel.bootstrapVercel).toBe('function');
    expect(typeof cf.bootstrapCloudflare).toBe('function');
  });
});
