import { describe, expect, it, vi } from 'vitest';
import getGroupMembers from '../agents/line/skills/line-group-directory/tools/get_group_members/index.js';

function context(kind: 'group' | 'private', id: string) {
  const client = { getGroupMemberIds: vi.fn(async () => ({ memberIds: ['U1'] })) };
  const conversation = { endpoint: { adapter: 'line', id: 'bot' }, kind, id };
  return { client, context: { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'line', conversation } } as never };
}

describe('line_get_group_members', () => {
  it('reads the current group only, ignoring a model-supplied groupId', async () => {
    expect((getGroupMembers.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('groupId');
    const f = context('group', 'Gcurrent');
    await getGroupMembers.execute({ groupId: 'Gother' } as never, f.context);
    expect(f.client.getGroupMemberIds).toHaveBeenCalledWith('Gcurrent');
  });

  it('refuses outside a group', async () => {
    const f = context('private', 'U1');
    await expect(getGroupMembers.execute({}, f.context)).rejects.toThrow('current LINE group');
    expect(f.client.getGroupMemberIds).not.toHaveBeenCalled();
  });
});
