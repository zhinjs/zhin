import { describe, expect, it, vi } from 'vitest';
import { createOneBot11ContentPort } from '../src/content-port.js';

const conversation = {
  endpoint: { id: 'main', adapter: 'onebot11' },
  kind: 'group' as const,
  id: '100',
};

describe('OneBot11 EndpointContentPort', () => {
  it('resolves messages and forwards with neutral actors', async () => {
    const call = vi.fn(async ({ action }: { action: string }) => action === 'get_msg'
      ? { time: 10, sender: { user_id: 7, nickname: 'Alice' }, message: [{ type: 'text', data: { text: 'quoted' } }] }
      : { messages: [{ time: 11, sender: { user_id: 8, nickname: 'Bob' }, content: [{ type: 'text', data: { text: 'forwarded' } }] }] });
    const port = createOneBot11ContentPort(call);
    const context = { signal: new AbortController().signal, maxDepth: 2, maxEntries: 50, maxChars: 12_000 };
    await expect(port.resolve({ kind: 'message', message: { conversation, id: 'm1' } }, context)).resolves.toMatchObject({
      status: 'resolved', value: { actor: { id: '7', displayName: 'Alice' }, segments: [{ type: 'text', data: { text: 'quoted' } }] },
    });
    const forward = await port.resolve({ kind: 'forward', conversation, forwardId: 'f1' }, context);
    expect(forward).toMatchObject({ status: 'resolved', value: [{ actor: { id: '8', displayName: 'Bob' } }] });
    expect(JSON.stringify(forward)).not.toContain('"role"');
    expect(call).toHaveBeenCalledWith({ action: 'get_forward_msg', params: { id: 'f1' }, signal: context.signal });
  });
  it('quoted and forwarded media whose platform `file` looks like a local path stay opaque refs (#1250)', async () => {
    const local = [{ type: 'image', data: { file: '/root/bot/.env' } }, { type: 'file', data: { file: './.zhin/gateway.db' } }];
    const call = vi.fn(async ({ action }: { action: string }) => action === 'get_msg'
      ? { time: 10, sender: { user_id: 7 }, message: local }
      : { messages: [{ time: 11, sender: { user_id: 8 }, content: local }] });
    const port = createOneBot11ContentPort(call);
    const conversation = { endpoint: { id: 'main', adapter: 'onebot11' }, kind: 'group' as const, id: 'g1' };
    const context = { signal: new AbortController().signal, maxDepth: 2, maxEntries: 50, maxChars: 12_000 };
    const quoted = await port.resolve({ kind: 'message', message: { conversation, id: 'm1' } }, context);
    const forward = await port.resolve({ kind: 'forward', conversation, forwardId: 'f1' }, context);
    for (const resolved of [quoted, forward]) {
      expect(JSON.stringify(resolved)).not.toContain('"kind":"path"');
      expect(JSON.stringify(resolved)).toContain('"kind":"file"');
    }
  });
});
