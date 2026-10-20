import { describe, expect, it } from 'vitest';
import { BiliApiError, BiliClient, parseDynamic, parseRoomId, parseUid, type FetchLike } from '../src/api.js';
import { mixinKey, signWbi, wbiKeyFromUrl } from '../src/wbi.js';

const IMG = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png';
const SUB = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Call { url: string; init?: RequestInit }

function router(routes: Record<string, (call: Call) => Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      for (const [needle, handler] of Object.entries(routes)) if (url.includes(needle)) return handler({ url, init });
      throw new Error(`unexpected request ${url}`);
    },
  };
}

const baseRoutes = {
  '/x/frontend/finger/spi': () => json({ code: 0, data: { b_3: 'B3', b_4: 'B4/x' } }),
  '/x/web-interface/nav': () => json({ code: -101, message: '账号未登录', data: { isLogin: false, wbi_img: { img_url: IMG, sub_url: SUB } } }),
};

describe('wbi signing', () => {
  it('matches the public reference vector', () => {
    const key = mixinKey(wbiKeyFromUrl(IMG), wbiKeyFromUrl(SUB));
    expect(key).toBe('ea1db124af3c7062474693fa704f4ff8');
    expect(signWbi({ foo: '114', bar: '514', zab: 1919810 }, key, 1702204169))
      .toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
  });

  it('strips reserved characters and encodes values', () => {
    const query = signWbi({ keyword: "a b!'()*" }, 'k'.repeat(32), 1);
    expect(query.startsWith('keyword=a%20b&wts=1&w_rid=')).toBe(true);
  });
});

describe('input parsing', () => {
  it('accepts uid forms', () => {
    expect(parseUid('672328094')).toBe('672328094');
    expect(parseUid('UID:123')).toBe('123');
    expect(parseUid('https://space.bilibili.com/456/dynamic')).toBe('456');
    expect(parseUid('abc')).toBeUndefined();
  });
  it('accepts room forms', () => {
    expect(parseRoomId('22637261')).toBe('22637261');
    expect(parseRoomId('https://live.bilibili.com/h5/789?x=1')).toBe('789');
    expect(parseRoomId('room')).toBeUndefined();
  });
});

describe('BiliClient', () => {
  it('signs the space dynamic request with buvid cookie and parses items', async () => {
    const { fetch, calls } = router({
      ...baseRoutes,
      '/web-dynamic/v1/feed/space': () => json({
        code: 0,
        data: {
          items: [
            {
              id_str: '1', type: 'DYNAMIC_TYPE_DRAW',
              modules: {
                module_author: { name: '嘉然', pub_ts: '100' },
                module_tag: { text: '置顶' },
                module_dynamic: { major: { type: 'MAJOR_TYPE_OPUS', opus: { summary: { text: '置顶内容' } } } },
              },
            },
            {
              id_str: '2', type: 'DYNAMIC_TYPE_AV',
              modules: {
                module_author: { name: '嘉然', pub_ts: 200 },
                module_dynamic: { major: { archive: { title: '新视频', jump_url: '//www.bilibili.com/video/BV1xx' } } },
              },
            },
            { id_str: '3', type: 'DYNAMIC_TYPE_LIVE_RCMD', modules: {} },
          ],
        },
      }),
    });
    const client = new BiliClient({ fetch, now: () => 1702204169_000 });
    const items = await client.getDynamics('672328094');
    expect(items.map((item) => item.id)).toEqual(['1', '2']);
    expect(items[0]).toMatchObject({ pinned: true, pubTs: 100, summary: '置顶内容' });
    expect(items[1]).toMatchObject({ summary: '投稿了视频：新视频', url: 'https://www.bilibili.com/video/BV1xx' });

    const feed = calls.find((call) => call.url.includes('feed/space'))!;
    expect(feed.url).toMatch(/host_mid=672328094/u);
    expect(feed.url).toMatch(/wts=1702204169/u);
    expect(feed.url).toMatch(/w_rid=[0-9a-f]{32}$/u);
    expect(feed.url).toMatch(/dm_img_list=%5B%5D/u);
    const headers = feed.init?.headers as Record<string, string>;
    expect(headers.cookie).toBe('buvid3=B3; buvid4=B4%2Fx');
    expect(headers.referer).toBe('https://space.bilibili.com/672328094/dynamic');
  });

  it('uses a configured cookie instead of fetching a device id', async () => {
    const { fetch, calls } = router({
      '/room/v1/Room/get_status_info_by_uids': () => json({ code: 0, data: [] }),
    });
    const client = new BiliClient({ fetch, cookie: 'SESSDATA=secret' });
    expect((await client.getLiveStatus(['1'])).size).toBe(0);
    expect(calls).toHaveLength(1);
    expect((calls[0]!.init?.headers as Record<string, string>).cookie).toBe('SESSDATA=secret');
  });

  it('parses batched live status', async () => {
    const { fetch, calls } = router({
      ...baseRoutes,
      '/room/v1/Room/get_status_info_by_uids': () => json({
        code: 0,
        data: { 672328094: { uid: 672328094, uname: '嘉然', room_id: 22637261, title: 't', live_status: 1, live_time: 1700000000, area_v2_name: '虚拟日常' } },
      }),
    });
    const info = (await new BiliClient({ fetch }).getLiveStatus(['672328094'])).get('672328094');
    expect(info).toMatchObject({ uname: '嘉然', roomId: '22637261', liveStatus: 1, liveTime: 1700000000, url: 'https://live.bilibili.com/22637261' });
    const post = calls.find((call) => call.url.includes('get_status_info_by_uids'))!;
    expect(post.init?.method).toBe('POST');
    expect(JSON.parse(String(post.init?.body))).toEqual({ uids: [672328094] });
  });

  it('classifies risk control, not found and payload changes', async () => {
    const risk = router({ ...baseRoutes, 'feed/space': () => json({ code: -352, message: '风控校验失败' }) });
    await expect(new BiliClient({ fetch: risk.fetch }).getDynamics('1')).rejects.toMatchObject({ kind: 'risk', code: -352 });

    const http412 = router({ ...baseRoutes, 'feed/space': () => new Response('<html>', { status: 412 }) });
    await expect(new BiliClient({ fetch: http412.fetch }).getDynamics('1')).rejects.toMatchObject({ kind: 'risk' });

    const missing = router({ ...baseRoutes, '/x/web-interface/card': () => json({ code: -404, message: '啥都木有' }) });
    await expect(new BiliClient({ fetch: missing.fetch }).getUserCard('1')).rejects.toMatchObject({ kind: 'not_found' });

    const changed = router({ ...baseRoutes, 'feed/space': () => json({ code: 0, data: { list: [] } }) });
    const error = await new BiliClient({ fetch: changed.fetch }).getDynamics('1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BiliApiError);
    expect((error as BiliApiError).kind).toBe('shape');
  });

  it('refetches the WBI key after a risk-control reset', async () => {
    let feedCalls = 0;
    const { fetch, calls } = router({
      ...baseRoutes,
      'feed/space': () => (++feedCalls === 1 ? json({ code: -352, message: 'risk' }) : json({ code: 0, data: { items: [] } })),
    });
    const client = new BiliClient({ fetch });
    await expect(client.getDynamics('1')).rejects.toBeInstanceOf(BiliApiError);
    await expect(client.getDynamics('1')).resolves.toEqual([]);
    expect(calls.filter((call) => call.url.includes('/nav')).length).toBe(2);
  });

  it('reports network timeouts as network errors', async () => {
    const client = new BiliClient({
      fetch: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); },
      cookie: 'x=1',
      timeout: 1000,
    });
    await expect(client.getRoomInfo('1')).rejects.toMatchObject({ kind: 'network', message: '请求超时（1000ms）' });
  });

  it('skips malformed dynamic entries', () => {
    expect(parseDynamic(null)).toBeUndefined();
    expect(parseDynamic({ type: 'DYNAMIC_TYPE_WORD' })).toBeUndefined();
    expect(parseDynamic({ id_str: '9', type: 'DYNAMIC_TYPE_FORWARD', modules: { module_dynamic: { desc: { text: '好' } } } }))
      .toMatchObject({ summary: '转发了动态：好', pubTs: 0, url: 'https://t.bilibili.com/9' });
  });
});
