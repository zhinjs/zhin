import { describe, expect, it, vi } from 'vitest';
import sendNotice from '../agents/napcat/skills/napcat-group-content/tools/send_group_notice/index.js';
import delNotice from '../agents/napcat/skills/napcat-group-content/tools/del_group_notice/index.js';
import setEssence from '../agents/napcat/skills/napcat-group-content/tools/set_essence_msg/index.js';
import deleteEssence from '../agents/napcat/skills/napcat-group-content/tools/delete_essence_msg/index.js';
import setTitle from '../agents/napcat/skills/napcat-group-settings/tools/set_title/index.js';
import setPortrait from '../agents/napcat/skills/napcat-group-settings/tools/set_group_portrait/index.js';

function fixture(kind: 'group' | 'private' = 'group') {
  const client = {
    sendGroupNotice: vi.fn(async () => undefined), deleteGroupNotice: vi.fn(async () => undefined),
    setEssenceMsg: vi.fn(async () => undefined), deleteEssenceMsg: vi.fn(async () => undefined),
    setTitle: vi.fn(async () => undefined), setGroupPortrait: vi.fn(async () => undefined),
    callApi: vi.fn(async (_action: string, params: { message_id: number }) => ({ message_type: 'group', group_id: params.message_id === 1 ? 100 : 999 })),
  };
  const conversation = { endpoint: { adapter: 'napcat', id: 'bot' }, kind, id: '100' };
  return { client, context: { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'napcat', conversation } } as never };
}

describe('NapCat group tools act on the current group only (platform permits are per conversation)', () => {
  it('have no group_id input', () => {
    for (const tool of [sendNotice, delNotice, setTitle, setPortrait]) {
      expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('group_id');
    }
  });

  it('ignore a model-supplied group_id', async () => {
    const f = fixture();
    await sendNotice.execute({ group_id: 999, content: 'c' } as never, f.context);
    await delNotice.execute({ group_id: 999, notice_id: 'n' } as never, f.context);
    await setTitle.execute({ group_id: 999, user_id: 5, title: 't' } as never, f.context);
    await setPortrait.execute({ group_id: 999, file: 'f' } as never, f.context);
    expect(f.client.sendGroupNotice).toHaveBeenCalledWith(100, 'c', undefined);
    expect(f.client.deleteGroupNotice).toHaveBeenCalledWith(100, 'n');
    expect(f.client.setTitle).toHaveBeenCalledWith({ groupId: 100, userId: 5, title: 't' });
    expect(f.client.setGroupPortrait).toHaveBeenCalledWith(100, 'f');
  });

  it('essence tools refuse a message from another group', async () => {
    const f = fixture();
    await expect(setEssence.execute({ message_id: 2 }, f.context)).rejects.toThrow('current group');
    await expect(deleteEssence.execute({ message_id: 2 }, f.context)).rejects.toThrow('current group');
    expect(f.client.setEssenceMsg).not.toHaveBeenCalled();
    expect(f.client.deleteEssenceMsg).not.toHaveBeenCalled();
    await setEssence.execute({ message_id: 1 }, f.context);
    expect(f.client.setEssenceMsg).toHaveBeenCalledWith(1);
  });

  it('refuse outside a group', async () => {
    const f = fixture('private');
    await expect(sendNotice.execute({ content: 'c' }, f.context)).rejects.toThrow('QQ group');
    expect(f.client.sendGroupNotice).not.toHaveBeenCalled();
  });
});
