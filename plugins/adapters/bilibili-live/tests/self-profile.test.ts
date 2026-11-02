import { BilibiliLiveClient } from '../src/client.js';
import { resolveBilibiliLiveConfig } from '../src/protocol.js';

describe('Bilibili Live public self profile', () => {
  it('retains a newer confirmed anonymous state over an older pending login response', async () => {
    let complete!: (body: unknown) => void;
    let first = true;
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => {
      if (first) { first = false; return new Promise(resolve => { complete = resolve; }); }
      return { code: -101, data: { isLogin: false } };
    } }));
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100' }), fetch);
    const signal = new AbortController().signal;
    const earlier = client.readSelfProfile(signal);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await expect(client.readSelfProfile(signal)).rejects.toThrow('not logged in');
    complete({ code: 0, data: { isLogin: true, mid: 1, uname: 'Earlier login' } });
    await earlier;
    expect(client.currentSelfProfile).toEqual({});
    expect(client.selfUid).toBeUndefined();
  });
  it.each(['rejected', 'cancelled', 'network'] as const)('publishes the last valid pending nav when a newer request is %s', async failure => {
    let complete!: (body: unknown) => void;
    let calls = 0;
    const abort = new AbortController();
    const fetch = vi.fn(async () => {
      if (++calls === 2 && failure === 'network') throw new Error('Network unavailable');
      const first = calls === 1;
      return { ok: true, status: 200, json: async () => {
        if (first) return new Promise(resolve => { complete = resolve; });
        if (failure === 'cancelled') abort.abort();
        return { code: failure === 'rejected' ? -412 : 0, data: { isLogin: true, mid: 2, uname: 'Must not publish' } };
      } };
    });
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100' }), fetch);
    const earlier = client.readSelfProfile(new AbortController().signal);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await expect(client.readSelfProfile(abort.signal)).rejects.toThrow();
    complete({ code: 0, data: { isLogin: true, mid: 1, uname: 'Last valid name' } });
    await earlier;
    expect(client.currentSelfProfile).toEqual({ nickname: 'Last valid name' });
    expect(client.selfUid).toBe('1');
  });
  it('keeps startup unsigned fallback when nav returns a business error without WBI keys', async () => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes('/nav')
      ? { code: -412, message: 'nav unavailable' }
      : { code: 0, data: { token: 'synthetic', host_list: [] } } }));
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100', buvid3: 'visitor' }), fetch);
    expect(await client.getDanmuServer('100')).toMatchObject({ token: 'synthetic' });
    expect(new URL(fetch.mock.calls[1][0]).searchParams.has('w_rid')).toBe(false);
    expect(client.currentSelfProfile).toEqual({});
  });

  it('keeps each read snapshot separate and never publishes an older nav response over the newer account', async () => {
    let complete!: (body: unknown) => void;
    let first = true;
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => {
      if (first) { first = false; return new Promise(resolve => { complete = resolve; }); }
      return { code: 0, data: { isLogin: true, mid: 2, uname: 'New account' } };
    } }));
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100' }), fetch);
    const signal = new AbortController().signal;
    const earlier = client.readSelfProfile(signal);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(await client.readSelfProfile(signal)).toEqual({ nickname: 'New account' });
    complete({ code: 0, data: { isLogin: true, mid: 1, uname: 'Old account' } });
    expect(await earlier).toEqual({ nickname: 'Old account' });
    expect(client.currentSelfProfile).toEqual({ nickname: 'New account' });
    expect(client.selfUid).toBe('2');
  });

  it('never exposes a mutable empty native snapshot', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: -101, data: { isLogin: false } }) }));
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100' }), fetch);
    expect(Object.isFrozen(client.currentSelfProfile)).toBe(true);
    await expect(client.readSelfProfile(new AbortController().signal)).rejects.toThrow('not logged in');
    expect(Object.isFrozen(client.currentSelfProfile)).toBe(true);
  });
  it('retains only logged-in native nav name/avatar and omits Cookie/WBI details', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: {
      isLogin: true, mid: 123, uname: 'Live self', face: 'https://example.com/live.png',
      wbi_img: { img_url: 'https://example.com/private-key.png', sub_url: 'https://example.com/private-sub.png' },
    } }) }));
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100', sessdata: 'synthetic' }), fetch);
    expect(client.currentSelfProfile).toEqual({});
    expect(await client.readSelfProfile(new AbortController().signal)).toEqual({ nickname: 'Live self', avatar: 'https://example.com/live.png' });
    expect(client.currentSelfProfile).toEqual({ nickname: 'Live self', avatar: 'https://example.com/live.png' });
    expect(client.selfUid).toBe('123');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not accept a cancelled nav response as a new self profile', async () => {
    const abort = new AbortController();
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => {
      abort.abort(); return { code: 0, data: { isLogin: true, mid: 999, uname: 'Late' } };
    } }));
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100', sessdata: 'synthetic' }), fetch);
    await expect(client.readSelfProfile(abort.signal)).rejects.toThrow();
    expect(client.currentSelfProfile).toEqual({}); expect(client.selfUid).toBeUndefined();
  });

  it.each([-412, 1, undefined])('does not adopt logged-in data from an unsuccessful nav code %s', async code => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code, message: 'native nav failure',
      data: { isLogin: true, mid: 123, uname: 'Must not become self' },
    }) }));
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100', sessdata: 'synthetic' }), fetch);
    await expect(client.readSelfProfile(new AbortController().signal)).rejects.toMatchObject({ code: code ?? -1 });
    expect(client.currentSelfProfile).toEqual({}); expect(client.selfUid).toBeUndefined();
  });

  it('retains anonymous -101 WBI key acquisition without publishing a logged-in profile', async () => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes('/nav')
      ? { code: -101, data: { isLogin: false, wbi_img: {
        img_url: 'https://example.com/7cd084941338484aae1ad9425b84077c.png',
        sub_url: 'https://example.com/4932caff0ff746eab6f01bf08b70ac45.png',
      } } }
      : { code: 0, data: { token: 'synthetic-token', host_list: [{ host: 'live.invalid', wss_port: 443 }] } },
    }));
    const client = new BilibiliLiveClient(resolveBilibiliLiveConfig({ id: 'live', roomId: '100', buvid3: 'synthetic-visitor' }), fetch);
    expect(await client.getDanmuServer('100')).toEqual({ url: 'wss://live.invalid:443/sub', token: 'synthetic-token' });
    expect(new URL(fetch.mock.calls[1][0]).searchParams.has('w_rid')).toBe(true);
    expect(client.currentSelfProfile).toEqual({}); expect(client.selfUid).toBeUndefined();
  });
});
