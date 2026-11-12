import { describe, expect, it, vi } from 'vitest';
import setTitle from '../agents/onebot11/skills/onebot11/tools/set_title/index.js';

function fixture(kind: 'group' | 'private' = 'group') {
  const client = { call: vi.fn(async () => ({ status: 'ok' })) };
  const conversation = { endpoint: { adapter: 'onebot11', id: 'bot' }, kind, id: '100' };
  return { client, context: { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'onebot11', conversation } } as never };
}

describe('OneBot11 set_title acts on the current group only (platform permits are per conversation)', () => {
  it('has no group_id input and ignores a model-supplied one', async () => {
    expect((setTitle.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('group_id');
    const f = fixture();
    await setTitle.execute({ group_id: 999, user_id: 5, title: 't' } as never, f.context);
    expect(f.client.call).toHaveBeenCalledWith('set_group_special_title', { group_id: 100, user_id: 5, special_title: 't', duration: -1 });
  });

  it('refuses outside a group', async () => {
    const f = fixture('private');
    await expect(setTitle.execute({ user_id: 5, title: 't' }, f.context)).rejects.toThrow('QQ group');
    expect(f.client.call).not.toHaveBeenCalled();
  });
});
