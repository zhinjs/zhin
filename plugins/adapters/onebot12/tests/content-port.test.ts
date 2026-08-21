import { describe, expect, it, vi } from 'vitest';
import { createOneBot12ContentPort } from '../src/content-port.js';

describe('OneBot12 EndpointContentPort', () => {
  it('resolves a scoped message and rejects non-standard forward lookup explicitly', async () => {
    const call = vi.fn(async () => ({ message: { user_id: 'u1', time: 10, message: [{ type: 'text', data: { text: 'quoted' } }] } }));
    const port = createOneBot12ContentPort(call);
    const conversation = { endpoint: { id: 'main', adapter: 'onebot12' }, kind: 'group' as const, id: 'g1' };
    const context = { signal: new AbortController().signal, maxDepth: 2, maxEntries: 50, maxChars: 12_000 };
    await expect(port.resolve({ kind: 'message', message: { conversation, id: 'm1' } }, context)).resolves.toMatchObject({
      status: 'resolved', value: { actor: { id: 'u1' }, segments: [{ type: 'text', data: { text: 'quoted' } }] },
    });
    await expect(port.resolve({ kind: 'forward', conversation, forwardId: 'f1' }, context)).resolves.toEqual({
      status: 'unsupported', code: 'onebot12_forward_lookup_not_standardized',
    });
  });
});
