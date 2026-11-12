import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import react from '../agents/discord/skills/discord/tools/react/index.js';
import sendEmbed from '../agents/discord/skills/discord/tools/send_embed/index.js';
import forumPost from '../agents/discord/skills/discord-guild/tools/forum_post/index.js';

type Conversation = { kind: 'channel' | 'private'; id: string; threadId?: string; parent?: { kind: 'channel'; id: string } };

function fixture(conversation: Conversation, channelType: number = ChannelType.GuildText) {
  const reactFn = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ id: 'm2' }));
  const create = vi.fn(async () => ({ id: 'post2' }));
  const channel = {
    type: channelType,
    isTextBased: () => true,
    isSendable: () => true,
    messages: { fetch: vi.fn(async () => ({ react: reactFn })) },
    send,
    availableTags: [{ id: 'tag1', name: 'help' }],
    threads: { create },
  };
  const channels = { fetch: vi.fn(async () => channel) };
  const context = {
    locale: 'en', signal: new AbortController().signal,
    $client: { channels, guilds: { fetch: vi.fn() } },
    origin: { kind: 'im', platform: 'discord', conversation: { endpoint: { adapter: 'discord', id: 'bot' }, ...conversation } },
    principal: { subjectId: 'requester', roles: [] },
  } as never;
  return { channels, reactFn, send, create, context };
}

const guildChannel: Conversation = { kind: 'channel', id: 'c1', parent: { kind: 'channel', id: 'g1' } };

describe('Discord channel tools act on the current conversation only', () => {
  it('have no channel_id input', () => {
    for (const tool of [react, sendEmbed, forumPost]) {
      expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('channel_id');
    }
  });

  it('react / send_embed ignore a model-supplied channel_id', async () => {
    const f = fixture(guildChannel);
    await react.execute({ channel_id: 'other', message_id: 'm1', emoji: '👍' } as never, f.context);
    await sendEmbed.execute({ channel_id: 'other', title: 'hi' } as never, f.context);
    expect(f.channels.fetch.mock.calls).toEqual([['c1'], ['c1']]);
    expect(f.reactFn).toHaveBeenCalledWith('👍');
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('react / send_embed use the thread inside a thread, and the DM channel in a DM', async () => {
    const thread = fixture({ ...guildChannel, threadId: 't1' });
    await react.execute({ message_id: 'm1', emoji: '👍' }, thread.context);
    await sendEmbed.execute({ title: 'hi' }, thread.context);
    expect(thread.channels.fetch.mock.calls).toEqual([['t1'], ['t1']]);
    const dm = fixture({ kind: 'private', id: 'dm1' });
    await sendEmbed.execute({ title: 'hi' }, dm.context);
    expect(dm.channels.fetch).toHaveBeenCalledWith('dm1');
  });

  it('forum_post posts into the forum of the current post, ignoring a model-supplied channel_id', async () => {
    const f = fixture({ ...guildChannel, id: 'forum1', threadId: 'post1' }, ChannelType.GuildForum);
    expect(await forumPost.execute({ channel_id: 'other', name: 'Q', content: 'body', tags: 'help' } as never, f.context))
      .toMatchObject({ success: true, thread_id: 'post2' });
    expect(f.channels.fetch).toHaveBeenCalledWith('forum1');
    expect(f.create).toHaveBeenCalledWith({ name: 'Q', message: { content: 'body' }, appliedTags: ['tag1'] });
  });

  it('forum_post refuses outside a forum and outside a server', async () => {
    const text = fixture(guildChannel);
    await expect(forumPost.execute({ name: 'Q', content: 'body' }, text.context)).rejects.toThrow('not a forum channel');
    const dm = fixture({ kind: 'private', id: 'dm1' }, ChannelType.GuildForum);
    await expect(forumPost.execute({ name: 'Q', content: 'body' }, dm.context)).rejects.toThrow('server channel');
    expect(text.create).not.toHaveBeenCalled();
    expect(dm.create).not.toHaveBeenCalled();
  });
});
