import { describe, expect, it, vi } from 'vitest';
import addMembers from '../agents/lark/skills/lark-group-admin/tools/add_members/index.js';
import dissolveChat from '../agents/lark/skills/lark-group-admin/tools/dissolve_chat/index.js';
import setManagers from '../agents/lark/skills/lark-group-admin/tools/set_managers/index.js';
import removeManagers from '../agents/lark/skills/lark-group-admin/tools/remove_managers/index.js';
import updateChat from '../agents/lark/skills/lark-group-admin/tools/update_chat/index.js';

function fixture(kind: 'group' | 'private' = 'group') {
  const client = {
    addChatMembers: vi.fn(async () => true), dissolveChat: vi.fn(async () => true), setChatManagers: vi.fn(async () => true),
    removeChatManagers: vi.fn(async () => true), updateChatInfo: vi.fn(async () => true),
  };
  const conversation = { endpoint: { adapter: 'lark', id: 'bot' }, kind, id: 'oc_current' };
  return { client, context: { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'lark', conversation } } as never };
}

describe('Lark group admin tools act on the current group only (platform permits are per conversation)', () => {
  it('have no chat_id input', () => {
    for (const tool of [addMembers, dissolveChat, setManagers, removeManagers, updateChat]) {
      expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('chat_id');
    }
  });

  it('ignore a model-supplied chat_id', async () => {
    const f = fixture();
    await addMembers.execute({ chat_id: 'oc_other', user_ids: 'u1' } as never, f.context);
    await setManagers.execute({ chat_id: 'oc_other', user_ids: 'u1' } as never, f.context);
    await removeManagers.execute({ chat_id: 'oc_other', user_ids: 'u1' } as never, f.context);
    await updateChat.execute({ chat_id: 'oc_other', name: 'n' } as never, f.context);
    await dissolveChat.execute({ chat_id: 'oc_other' } as never, f.context);
    expect(f.client.addChatMembers).toHaveBeenCalledWith('oc_current', ['u1']);
    expect(f.client.setChatManagers).toHaveBeenCalledWith('oc_current', ['u1']);
    expect(f.client.removeChatManagers).toHaveBeenCalledWith('oc_current', ['u1']);
    expect(f.client.updateChatInfo).toHaveBeenCalledWith('oc_current', { name: 'n', description: undefined });
    expect(f.client.dissolveChat).toHaveBeenCalledWith('oc_current');
  });

  it('refuse outside a group', async () => {
    const f = fixture('private');
    await expect(dissolveChat.execute({}, f.context)).rejects.toThrow('Lark group');
    expect(f.client.dissolveChat).not.toHaveBeenCalled();
  });
});
