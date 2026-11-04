import { createDiscordSelfProfile, createDiscordRestSelfProfile } from '../src/self-profile.js';
import { Client, ClientUser } from 'discord.js';
import { EndpointProfileState } from '@zhin.js/adapter';
import { DiscordRestClient } from '../src/endpoint.js';

describe('Discord own account profile', () => {
  it.each([false, true])('retains confirmed profile fields after a native rate limit without code (global=%s)', async global => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'GET'
      ? { id: '123', username: 'Confirmed name', avatar: null }
      : { message: 'You are being rate limited.', retry_after: 0.25, global }), { status: init?.method === 'GET' ? 200 : 429 }));
    const state = new EndpointProfileState({ source: createDiscordRestSelfProfile(new DiscordRestClient('synthetic', fetch as typeof globalThis.fetch), vi.fn()), defaults: {} });
    const signal = new AbortController().signal;
    await state.read({ signal });
    expect(await state.write({ signal, change: { field: 'nickname', value: 'Limited name' } })).toMatchObject({ status: 'rejected' });
    expect(state.peek().values.nickname).toBe('Confirmed name');
    expect(fetch).toHaveBeenCalledTimes(2); // One read and one write, with no automatic retry.
  });

  it.each([
    '<html>proxy limit</html>',
    JSON.stringify({ message: 'proxy limit', retry_after: '1', global: false }),
    JSON.stringify({ message: 'proxy limit', retry_after: 1 }),
  ])('keeps unrecognized 429 responses uncertain', async body => {
    const fetch = vi.fn(async () => new Response(body, { status: 429 }));
    const port = createDiscordRestSelfProfile(new DiscordRestClient('synthetic', fetch), vi.fn());
    expect(await port.write!({ signal: new AbortController().signal, change: { field: 'nickname', value: 'Unknown' } }))
      .toMatchObject({ status: 'unknown' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves confirmed fields when the actual REST client receives a native 400 rejection', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'GET'
      ? { id: '123', username: 'Confirmed name', avatar: null }
      : { code: 50035, message: 'Invalid Form Body' }), { status: init?.method === 'GET' ? 200 : 400 }));
    const state = new EndpointProfileState({ source: createDiscordRestSelfProfile(new DiscordRestClient('synthetic', fetch as typeof globalThis.fetch), vi.fn()), defaults: {} });
    const signal = new AbortController().signal;
    await state.read({ signal });
    expect(await state.write({ signal, change: { field: 'nickname', value: 'Rejected name' } })).toMatchObject({ status: 'rejected' });
    expect(state.peek().values.nickname).toBe('Confirmed name');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([408, 500, 502])('keeps actual HTTP %s uncertain rather than treating it as a platform rejection', async status => {
    const client = new DiscordRestClient('synthetic', (async () => new Response(JSON.stringify({ code: 50035, message: 'Gateway failure' }), { status })) as typeof globalThis.fetch);
    const port = createDiscordRestSelfProfile(client, vi.fn());
    expect(await port.write!({ signal: new AbortController().signal, change: { field: 'nickname', value: 'Unknown' } }))
      .toMatchObject({ status: 'unknown' });
  });

  it('does not call a proxy HTML 400 a native rejection or expose transport details in its message', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('<html>proxy failed</html>', { status: 400 }))
      .mockRejectedValueOnce(new Error('Transport failed at https://synthetic.invalid/?secret=private'));
    const port = createDiscordRestSelfProfile(new DiscordRestClient('synthetic', fetch), vi.fn());
    const signal = new AbortController().signal;
    expect(await port.write!({ signal, change: { field: 'nickname', value: 'One' } })).toMatchObject({ status: 'unknown' });
    const result = await port.write!({ signal, change: { field: 'nickname', value: 'Two' } });
    expect(result.status).toBe('unknown');
    expect(result.message).not.toContain('private');
  });

  it('retains a real HTTP success ACK even when the account response JSON cannot be parsed', async () => {
    const port = createDiscordRestSelfProfile(new DiscordRestClient('synthetic', (async () => new Response('invalid JSON', { status: 200 })) as typeof globalThis.fetch), vi.fn());
    expect(await port.write!({ signal: new AbortController().signal, change: { field: 'nickname', value: 'Accepted' } }))
      .toEqual({ status: 'updated' });
  });
  it('keeps a confirmed REST write ACK when its returned profile cannot be projected', async () => {
    const request = vi.fn(async () => ({ id: '123', username: 'Accepted' }));
    const report = vi.fn(), port = createDiscordRestSelfProfile({ request } as never, report);
    expect(await port.write!({ signal: new AbortController().signal, change: { field: 'nickname', value: 'Accepted' } }))
      .toEqual({ status: 'updated' });
    expect(report).not.toHaveBeenCalled();
    request.mockRejectedValueOnce(new TypeError('Unexpected request implementation error'));
    await expect(port.write!({ signal: new AbortController().signal, change: { field: 'nickname', value: 'No' } }))
      .rejects.toThrow('Unexpected request implementation error');
  });
  it('projects the native current user and preserves a native avatar clear', async () => {
    const user = { id: '123', username: 'Real bot', avatarURL: () => null,
      fetch: vi.fn(async () => user), setUsername: vi.fn(async () => ({ ...user, username: 'New bot' })),
      setAvatar: vi.fn(async () => ({ ...user, avatarURL: () => 'https://cdn.discordapp.com/avatar.png' })) };
    const fetch = vi.fn(async () => user);
    const port = createDiscordSelfProfile({ user, users: { fetch } } as never), signal = new AbortController().signal;
    expect(port.current).toEqual({ nickname: 'Real bot', avatar: null });
    expect(await port.read({ signal })).toEqual({ nickname: 'Real bot', avatar: null });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('123', { force: true, cache: false });
    expect(await port.write!({ signal, change: { field: 'nickname', value: 'New bot' } })).toMatchObject({ status: 'updated', profile: { nickname: 'New bot' } });
    const bytes = Buffer.from('image bytes');
    expect(await port.write!({ signal, change: { field: 'avatar', value: { kind: 'base64', value: bytes.toString('base64'), mime_type: 'image/png' } } })).toEqual({
      status: 'updated', profile: { nickname: 'Real bot', avatar: 'https://cdn.discordapp.com/avatar.png' },
    });
    expect(user.setAvatar).toHaveBeenCalledExactlyOnceWith(bytes);
  });

  it('cancels an admitted SDK mutation as unknown without starting another operation', async () => {
    const user = { username: 'Bot', avatarURL: () => null, setUsername: vi.fn(() => new Promise(() => undefined)) };
    const port = createDiscordSelfProfile({ user } as never), abort = new AbortController();
    const pending = port.write!({ signal: abort.signal, change: { field: 'nickname', value: 'New' } });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ disposition: 'unknown' });
    expect(user.setUsername).toHaveBeenCalledTimes(1);
  });

  it('keeps the actual SDK ClientUser unchanged by a delayed pre-rename fetch', async () => {
    const client = new Client({ intents: [] });
    const before = { id: '100000000000000001', username: 'Before', discriminator: '0', avatar: null, bot: true };
    const user: ClientUser = Reflect.construct(ClientUser, [client, before]);
    Reflect.set(client, 'user', user);
    client.users.cache.set(user.id, user);
    let complete!: (value: typeof before) => void;
    const get = vi.spyOn(client.rest, 'get').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const patch = vi.spyOn(client.rest, 'patch').mockResolvedValue({ ...before, username: 'Confirmed new' });
    try {
      const state = new EndpointProfileState({ source: createDiscordSelfProfile(client), defaults: {} });
      const signal = new AbortController().signal;
      const pending = state.read({ signal });
      await state.write({ signal, change: { field: 'nickname', value: 'Confirmed new' } });
      expect(client.user?.username).toBe('Confirmed new');
      complete(before);
      expect((await pending).values.nickname).toBe('Confirmed new');
      expect(client.user).toBe(user);
      expect(client.users.cache.get(user.id)).toBe(user);
      expect(user.username).toBe('Confirmed new');
    } finally { get.mockRestore(); patch.mockRestore(); await client.destroy(); }
  });

  it('uses authenticated REST for interactions-only mode and returns the confirmed CDN avatar', async () => {
    const request = vi.fn(async () => ({ id: '123', username: 'Bot', avatar: 'a_hash' }));
    const report = vi.fn(), port = createDiscordRestSelfProfile({ request } as never, report), signal = new AbortController().signal;
    expect(await port.read({ signal })).toEqual({ nickname: 'Bot', avatar: 'https://cdn.discordapp.com/avatars/123/a_hash.gif' });
    expect(report).toHaveBeenCalledExactlyOnceWith('123');
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/users/@me', signal });
    expect(await port.write!({ signal, change: { field: 'avatar', value: { kind: 'base64', value: 'aW1hZ2U=', mime_type: 'image/png' } } })).toEqual({
      status: 'updated', profile: { nickname: 'Bot', avatar: 'https://cdn.discordapp.com/avatars/123/a_hash.gif' },
    });
    expect(request).toHaveBeenLastCalledWith({ method: 'PATCH', path: '/users/@me', body: { avatar: 'data:image/png;base64,aW1hZ2U=' }, signal });
  });
});
