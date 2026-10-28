import { publishQunNotice, QUN_NOTICE_ENDPOINT } from '../src/group-notice.js';

const client = { bkn: 123, getCookies: vi.fn(() => 'uin=o1; skey=s') };
const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response);

describe('publishQunNotice', () => {
  it('posts to the group notice web API with the session cookie and bkn', async () => {
    const fetchImpl = reply({ ec: 0 });
    await publishQunNotice(client, 1048877509, '周六活动', fetchImpl);
    const [url, init] = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe(`${QUN_NOTICE_ENDPOINT}?bkn=123`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).cookie).toBe('uin=o1; skey=s');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('qid')).toBe('1048877509');
    expect(form.get('text')).toBe('周六活动');
    expect(form.get('bkn')).toBe('123');
  });

  it('fails instead of reporting success when QQ rejects it', async () => {
    await expect(publishQunNotice(client, 1, 'x', reply({ ec: 4, em: 'no permission' }))).rejects.toThrow('no permission');
    await expect(publishQunNotice(client, 1, 'x', reply({}, false))).rejects.toThrow('HTTP 500');
    await expect(publishQunNotice(client, 1, 'x', reply('not json'))).rejects.toThrow();
  });

  it('fails without a qun.qq.com cookie', async () => {
    await expect(publishQunNotice({ bkn: 1, getCookies: () => undefined }, 1, 'x', reply({ ec: 0 }))).rejects.toThrow('cookie');
  });
});
