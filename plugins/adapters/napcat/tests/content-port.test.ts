import { describe, expect, it, vi } from 'vitest';
import { createNapCatContentPort } from '../src/onebot-get-msg.js';

describe('NapCat EndpointContentPort', () => {
  it('resolves message and merged-forward content without model roles', async () => {
    const call = vi.fn(async (action: string) => action === 'get_msg'
      ? { time: 10, sender: { user_id: 7, nickname: 'Alice' }, message: [{ type: 'text', data: { text: 'quoted' } }] }
      : { messages: [{ time: 11, sender: { user_id: 8, nickname: 'Bob' }, content: [{ type: 'text', data: { text: 'forwarded' } }] }] });
    const port = createNapCatContentPort(call);
    const conversation = { endpoint: { id: 'main', adapter: 'napcat' }, kind: 'group' as const, id: 'g1' };
    const context = { signal: new AbortController().signal, maxDepth: 2, maxEntries: 50, maxChars: 12_000 };
    await expect(port.resolve({ kind: 'message', message: { conversation, id: 'm1' } }, context)).resolves.toMatchObject({
      status: 'resolved', value: { actor: { id: '7', displayName: 'Alice' } },
    });
    const forward = await port.resolve({ kind: 'forward', conversation, forwardId: 'f1' }, context);
    expect(forward).toMatchObject({ status: 'resolved', value: [{ actor: { id: '8', displayName: 'Bob' } }] });
    expect(JSON.stringify(forward)).not.toContain('"role"');
  });
});
