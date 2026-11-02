import { createOnebot11SelfProfile } from '../onebot11/src/self-profile.js';
import { createOnebot12SelfProfile } from '../onebot12/src/self-profile.js';
import { createMilkySelfProfile } from '../milky/src/self-profile.js';
import { createSatoriSelfProfile } from '../satori/src/self-profile.js';
import { createLineSelfProfile } from '../line/src/self-profile.js';
import { createKookSelfProfile } from '../kook/src/self-profile.js';
import { createSlackSelfProfile } from '../slack/src/self-profile.js';
import { createQqSelfProfile } from '../qq/src/self-profile.js';
import { createLarkSelfProfile } from '../lark/src/self-profile.js';
import { createBilibiliSelfProfile } from '../bilibili/src/self-profile.js';
import { createGithubSelfProfile } from '../github/src/self-profile.js';
import { createWecomSelfProfile } from '../wecom/src/self-profile.js';

const signal = new AbortController().signal;

describe('read-only native self profile ports', () => {
  it('reads OneBot11 and Milky through error-checked native actions, never config instance aliases', async () => {
    const report = vi.fn();
    const onebot = createOnebot11SelfProfile({ call: vi.fn(async () => ({ user_id: 123, nickname: 'OneBot self' })), reportAccount: report });
    const milky = createMilkySelfProfile({ call: vi.fn(async () => ({ uin: 456, nickname: 'Milky self' })), reportAccount: report });
    expect(await onebot.read({ signal })).toEqual({ nickname: 'OneBot self' });
    expect(await milky.read({ signal })).toEqual({ nickname: 'Milky self' });
    expect(report.mock.calls).toEqual([['123'], ['456']]);
    expect(onebot.write).toBeUndefined(); expect(milky.write).toBeUndefined();
  });

  it('reads OneBot11 own age/sex and preserves the known login name when extended lookup fails', async () => {
    const call = vi.fn(async ({ action }: { action: string }) => action === 'get_login_info'
      ? { user_id: 123, nickname: 'Login self' }
      : { user_id: 123, nickname: 'Current self', sex: 'female', age: 28 });
    const port = createOnebot11SelfProfile({ call, reportAccount: vi.fn() });
    expect(await port.read({ signal })).toEqual({ nickname: 'Current self', gender: 'female', age: 28 });
    expect(call).toHaveBeenLastCalledWith({ action: 'get_stranger_info', params: { user_id: 123, no_cache: true }, signal });
    call.mockImplementation(async ({ action }) => {
      if (action === 'get_login_info') return { user_id: 123, nickname: 'Confirmed self' };
      throw new Error('unsupported action');
    });
    await expect(port.read({ signal, refresh: true })).rejects.toThrow('unsupported action');
    expect(port.current).toEqual({ nickname: 'Confirmed self' });
  });

  it('rejects another selected OneBot12 or Satori account instead of adopting it', async () => {
    const report = vi.fn();
    const onebot = createOnebot12SelfProfile({ call: async () => ({ user_id: 'other', user_name: 'Other' }), accountId: 'mine', reportAccount: report });
    const satori = createSatoriSelfProfile({ call: async () => ({ platform: 'other', user: { id: 'mine', name: 'Other' } }), platform: 'telegram', accountId: 'mine', reportAccount: report });
    await expect(onebot.read({ signal })).rejects.toThrow('another account');
    await expect(satori.read({ signal })).rejects.toThrow('another account');
    expect(report).not.toHaveBeenCalled();
  });

  it('uses the selected Satori login and returns only its public name/avatar', async () => {
    const call = vi.fn(async () => ({ platform: 'telegram', user: { id: 'mine', name: 'Current', avatar: 'https://example.com/avatar.png', phone: 'private' } }));
    const report = vi.fn(), port = createSatoriSelfProfile({ call, platform: 'telegram', accountId: 'mine', reportAccount: report });
    expect(await port.read({ signal })).toEqual({ nickname: 'Current', avatar: 'https://example.com/avatar.png' });
    expect(call).toHaveBeenCalledExactlyOnceWith({ resource: 'login', method: 'get', signal });
    expect(report).toHaveBeenCalledExactlyOnceWith('mine');
  });

  it('reads LINE, KOOK, QQ and Lark from their actual authenticated bot-info responses', async () => {
    const report = vi.fn();
    const line = createLineSelfProfile({ client: { request: async () => ({ userId: 'line-id', displayName: 'LINE', pictureUrl: 'https://example.com/line.png' }) } as never, reportAccount: report });
    const kook = createKookSelfProfile({ client: { getSelfInfo: async () => ({ id: 'kook-id', username: 'KOOK', avatar: 'https://example.com/kook.png' }) } as never, reportAccount: report });
    const qq = createQqSelfProfile({ client: { getSelfInfo: async () => ({ id: 'qq-id', username: 'QQ', avatar: 'https://example.com/qq.png' }) }, reportAccount: report });
    const lark = createLarkSelfProfile({ client: { config: { apiBaseUrl: 'https://open.feishu.cn/open-apis' }, request: async () => ({ code: 0, bot: { open_id: 'lark-id', app_name: 'Lark', avatar_url: 'https://example.com/lark.png' } }) } as never, reportAccount: report });
    expect(await line.read({ signal })).toEqual({ nickname: 'LINE', avatar: 'https://example.com/line.png' });
    expect(await kook.read({ signal })).toEqual({ nickname: 'KOOK', avatar: 'https://example.com/kook.png' });
    expect(await qq.read({ signal })).toEqual({ nickname: 'QQ', avatar: 'https://example.com/qq.png' });
    expect(await lark.read({ signal })).toEqual({ nickname: 'Lark', avatar: 'https://example.com/lark.png' });
    expect(report.mock.calls).toEqual([['line-id'], ['kook-id'], ['qq-id'], ['lark-id']]);
  });

  it('reads Slack with current native user id and does not expose user-token-only writes', async () => {
    const info = vi.fn(async () => ({ ok: true, user: { id: 'U1', name: 'bot', profile: { display_name: 'Slack bot', image_512: 'https://example.com/slack.png', email: 'private@example.com' } } }));
    const port = createSlackSelfProfile({ client: { users: { info } } as never, accountId: () => 'U1' });
    expect(await port.read({ signal })).toEqual({ nickname: 'Slack bot', avatar: 'https://example.com/slack.png' });
    expect(info).toHaveBeenCalledExactlyOnceWith({ user: 'U1' });
    expect(port.writableFields).toEqual([]); expect(port.write).toBeUndefined();
  });

  it('reads the authenticated Bilibili account rather than the subscribed content author', async () => {
    const getNav = vi.fn(async () => ({ mid: '100', uname: 'Self' })), report = vi.fn();
    const port = createBilibiliSelfProfile({ client: { getNav }, reportAccount: report });
    expect(await port.read({ signal })).toEqual({ nickname: 'Self' });
    expect(report).toHaveBeenCalledExactlyOnceWith('100');
    getNav.mockResolvedValueOnce(undefined as never);
    await expect(port.read({ signal })).rejects.toThrow('not logged in');
  });

  it('uses the actual GitHub App bot user and preserves empty/null public profile fields', async () => {
    const request = vi.fn(async () => ({ ok: true, status: 200, data: { id: 10, login: 'app[bot]', name: null, bio: '', avatar_url: 'https://example.com/github.png', email: 'private@example.com' } }));
    const report = vi.fn(), port = createGithubSelfProfile({ client: {
      getBotIdentity: async () => ({ userId: 10, login: 'app[bot]', email: 'private', slug: 'app' }), request,
    } as never, reportAccount: report });
    expect(await port.read({ signal })).toEqual({ nickname: 'app[bot]', bio: '', avatar: 'https://example.com/github.png' });
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/users/app%5Bbot%5D', signal });
    request.mockResolvedValueOnce({ ok: true, status: 200, data: { id: 11, login: 'other' } } as never);
    await expect(port.read({ signal })).rejects.toThrow('another account');
  });

  it('treats WeCom as an application profile and does not impersonate a member account id', async () => {
    const getApplicationInfo = vi.fn(async () => ({ errcode: 0, name: 'Application', description: '', square_logo_url: 'https://example.com/wecom.png', agentid: 100, allow_userinfos: { user: ['private'] } }));
    const port = createWecomSelfProfile({ getApplicationInfo });
    expect(await port.read({ signal })).toEqual({ nickname: 'Application', bio: '', avatar: 'https://example.com/wecom.png' });
    expect(getApplicationInfo).toHaveBeenCalledExactlyOnceWith({ signal });
    expect(port.write).toBeUndefined();
  });
});
