import { describe, expect, it, vi } from 'vitest';
import archive from '../agents/slack/skills/slack-channels/tools/archive_channel/index.js';
import invite from '../agents/slack/skills/slack-channels/tools/invite_to_channel/index.js';
import setPurpose from '../agents/slack/skills/slack-channels/tools/set_purpose/index.js';
import setTopic from '../agents/slack/skills/slack-channels/tools/set_topic/index.js';
import unarchive from '../agents/slack/skills/slack-channels/tools/unarchive/index.js';
import pin from '../agents/slack/skills/slack-messages/tools/pin_message/index.js';
import unpin from '../agents/slack/skills/slack-messages/tools/unpin_message/index.js';

function fixture(kind: 'group' | 'private' = 'group') {
  const client = {
    conversations: { archive: vi.fn(async () => ({})), invite: vi.fn(async () => ({})), setPurpose: vi.fn(async () => ({})),
      setTopic: vi.fn(async () => ({})), unarchive: vi.fn(async () => ({})) },
    pins: { add: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
  };
  const conversation = { endpoint: { adapter: 'slack', id: 'bot' }, kind, id: kind === 'group' ? 'C_CURRENT' : 'D_CURRENT' };
  return { client, context: { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'slack', conversation } } as never };
}

describe('Slack channel tools (M5: zhin roles, current channel)', () => {
  it('use zhin roles instead of never-reported Slack platform permissions', () => {
    for (const tool of [invite, setPurpose, setTopic, pin, unpin]) expect(tool.permissions).toEqual(['admin']);
    expect(archive.permissions).toEqual(['owner']);
    // unarchive names another channel: host-wide, a global owner only (archive acts on the current channel).
    expect(unarchive.permissions).toEqual(['owner@global']);
  });

  it('act on the current channel, ignoring a model-supplied channel', async () => {
    const f = fixture();
    for (const tool of [archive, invite, setPurpose, setTopic, pin, unpin]) {
      expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('channel');
      expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('channel_id');
    }
    await archive.execute({ channel: 'C_OTHER' } as never, f.context);
    await invite.execute({ channel: 'C_OTHER', users: 'U1' } as never, f.context);
    await setPurpose.execute({ channel_id: 'C_OTHER', purpose: 'p' } as never, f.context);
    await setTopic.execute({ channel: 'C_OTHER', topic: 't' } as never, f.context);
    await pin.execute({ channel: 'C_OTHER', timestamp: '1.2' } as never, f.context);
    await unpin.execute({ channel_id: 'C_OTHER', timestamp: '1.2' } as never, f.context);
    expect(f.client.conversations.archive).toHaveBeenCalledWith({ channel: 'C_CURRENT' });
    expect(f.client.conversations.invite).toHaveBeenCalledWith({ channel: 'C_CURRENT', users: 'U1' });
    expect(f.client.conversations.setPurpose).toHaveBeenCalledWith({ channel: 'C_CURRENT', purpose: 'p' });
    expect(f.client.conversations.setTopic).toHaveBeenCalledWith({ channel: 'C_CURRENT', topic: 't' });
    expect(f.client.pins.add).toHaveBeenCalledWith({ channel: 'C_CURRENT', timestamp: '1.2' });
    expect(f.client.pins.remove).toHaveBeenCalledWith({ channel: 'C_CURRENT', timestamp: '1.2' });
  });

  it('allow pins in a direct message but channel administration only in a channel', async () => {
    const f = fixture('private');
    await pin.execute({ timestamp: '1.2' }, f.context);
    expect(f.client.pins.add).toHaveBeenCalledWith({ channel: 'D_CURRENT', timestamp: '1.2' });
    await expect(setTopic.execute({ topic: 't' }, f.context)).rejects.toThrow('Slack channel');
  });
});
