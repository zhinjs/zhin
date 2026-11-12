import { describe, expect, it, vi } from 'vitest';
import addReaction from '../agents/slack/skills/slack-messages/tools/add_reaction/index.js';
import removeReaction from '../agents/slack/skills/slack-messages/tools/remove_reaction/index.js';
import editMessage from '../agents/slack/skills/slack-messages/tools/edit_message/index.js';

function fixture(kind: 'group' | 'private' = 'group') {
  const client = {
    reactions: { add: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
    chat: { update: vi.fn(async () => ({ ok: true })) },
  };
  const conversation = { endpoint: { adapter: 'slack', id: 'bot' }, kind, id: kind === 'group' ? 'C_CURRENT' : 'D_CURRENT' };
  return { client, context: { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'slack', conversation } } as never };
}

describe('Slack message tools act on the current channel or DM only', () => {
  it('have no channel input', () => {
    for (const tool of [addReaction, removeReaction, editMessage]) {
      const shape = (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
      expect(shape).not.toHaveProperty('channel');
      expect(shape).not.toHaveProperty('channel_id');
    }
  });

  it.each(['group', 'private'] as const)('ignore a model-supplied channel (%s)', async (kind) => {
    const f = fixture(kind);
    const current = kind === 'group' ? 'C_CURRENT' : 'D_CURRENT';
    await addReaction.execute({ channel: 'C_OTHER', timestamp: '1.2', emoji: ':thumbsup:' } as never, f.context);
    await removeReaction.execute({ channel_id: 'C_OTHER', timestamp: '1.2', name: 'thumbsup' } as never, f.context);
    await editMessage.execute({ channel: 'C_OTHER', message_ts: '1.2', text: 'new' } as never, f.context);
    expect(f.client.reactions.add).toHaveBeenCalledWith(expect.objectContaining({ channel: current, timestamp: '1.2' }));
    expect(f.client.reactions.remove).toHaveBeenCalledWith(expect.objectContaining({ channel: current, timestamp: '1.2' }));
    expect(f.client.chat.update).toHaveBeenCalledWith(expect.objectContaining({ channel: current, ts: '1.2' }));
  });
});
