import { createNapcatSelfProfile } from '../src/self-profile.js';
import { NapcatClient } from '../src/client.js';
import type { callNapCatHttpAction } from '../src/protocol.js';

function fixture() {
  const requestApi = vi.fn(async ({ action }: { action: string }) => {
    if (action === 'get_login_info') return { user_id: 123, nickname: 'Self' };
    if (action === 'get_stranger_info') return { user_id: 123, nickname: 'Self now', sex: 'male', age: 27,
      long_nick: '', mail: 'not-for-agent@example.com' };
    return null;
  });
  return { requestApi, port: createNapcatSelfProfile({ requestApi }), signal: new AbortController().signal };
}

describe('NapCat own account profile', () => {
  it('uses the current login identity and projects only known profile fields', async () => {
    const { requestApi, port, signal } = fixture();
    expect(await port.read({ signal })).toEqual({ nickname: 'Self now', gender: 'male', age: 27, signature: '' });
    expect(requestApi).toHaveBeenNthCalledWith(2, { action: 'get_stranger_info', params: { user_id: '123', no_cache: true }, signal });
  });

  it('rejects another account response and preserves failed lookup errors', async () => {
    const { requestApi, port, signal } = fixture();
    requestApi.mockResolvedValueOnce({ user_id: 123, nickname: 'Self' }).mockResolvedValueOnce({ user_id: 456, nickname: 'Other' });
    await expect(port.read({ signal })).rejects.toThrow('another account');
    requestApi.mockRejectedValueOnce(new Error('platform rejected'));
    await expect(port.read({ signal })).rejects.toThrow('platform rejected');
  });

  it('maps one-field writes to actions without silently clearing other profile fields', async () => {
    const { requestApi, port, signal } = fixture();
    expect(await port.write!({ signal, change: { field: 'nickname', value: 'New' } })).toEqual({ status: 'updated', profile: { nickname: 'New' } });
    expect(requestApi).toHaveBeenLastCalledWith({ action: 'set_qq_profile', params: { nickname: 'New' }, signal });
    await port.write!({ signal, change: { field: 'gender', value: 'female' } });
    expect(requestApi).toHaveBeenLastCalledWith({ action: 'set_qq_profile', params: { nickname: 'Self', sex: 2 }, signal });
    await port.write!({ signal, change: { field: 'signature', value: '' } });
    expect(requestApi).toHaveBeenLastCalledWith({ action: 'set_self_longnick', params: { longNick: '' }, signal });
    expect(await port.write!({ signal, change: { field: 'bio', value: 'No native field' } })).toMatchObject({ status: 'rejected' });
  });

  it('does not report an inner native profile error as success', async () => {
    const { requestApi, port, signal } = fixture();
    requestApi.mockResolvedValueOnce({ result: 42, errMsg: 'blocked' } as never);
    expect(await port.write!({ signal, change: { field: 'nickname', value: 'No' } })).toEqual({ status: 'rejected', message: 'blocked' });
  });

  it('does not claim an uploaded source URL as the resulting platform avatar', async () => {
    const { requestApi, port, signal } = fixture();
    expect(await port.write!({ signal, change: { field: 'avatar', value: { kind: 'url', value: 'https://example.com/avatar.jpg' } } })).toEqual({ status: 'updated' });
    expect(requestApi).toHaveBeenLastCalledWith({ action: 'set_qq_avatar', params: { file: 'https://example.com/avatar.jpg' }, signal });
  });

  it('observes legacy SDK profile actions without changing their atomic payload or exposing other users', async () => {
    const httpAction = vi.fn(async (_config: unknown, action: string, params: Record<string, unknown>) => ({ status: 'ok', retcode: 0,
      data: action === 'get_login_info' ? { user_id: 123, nickname: 'Original' }
        : action === 'get_stranger_info' ? { user_id: params.user_id, nickname: 'Other user', age: 70, long_nick: 'Other signature' } : null,
    }));
    const client = new NapcatClient({ config: { context: 'napcat', id: 'instance-name', connection: 'http', http_url: 'http://synthetic.invalid', post_path: '/test' },
      httpAction: httpAction as typeof callNapCatHttpAction });
    const port = createNapcatSelfProfile(client);
    await client.callApi('get_login_info');
    expect(port.current).toEqual({ nickname: 'Original' });
    httpAction.mockClear();
    await client.setQQProfile({ nickname: 'New', company: 'Company', email: 'private@example.com', college: 'College', personalNote: 'New signature' });
    expect(httpAction).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'set_qq_profile', {
      nickname: 'New', company: 'Company', email: 'private@example.com', college: 'College', personal_note: 'New signature',
    });
    expect(port.current).toEqual({ nickname: 'New', signature: 'New signature' });
    await client.callApi('get_stranger_info', { user_id: 999, no_cache: true });
    expect(port.current).toEqual({ nickname: 'New', signature: 'New signature' });
    await client.setSelfLongnick('');
    expect(port.current).toEqual({ nickname: 'New', signature: '' });
    await client.setQQAvatar('base64://aW1hZ2U=');
    expect(port.current).toEqual({ nickname: 'New', signature: '' });
    expect(JSON.stringify(port.current)).not.toContain('base64');
  });

  it('does not observe rejected or cancelled native self changes as successful platform facts', async () => {
    const abort = new AbortController();
    const httpAction = vi.fn(async () => ({ status: 'ok', retcode: 0, data: { result: 42, errMsg: 'rejected' } }));
    const client = new NapcatClient({ config: { context: 'napcat', id: 'instance-name', connection: 'http', http_url: 'http://synthetic.invalid', post_path: '/test' },
      httpAction: httpAction as typeof callNapCatHttpAction });
    await client.setQQProfile({ nickname: 'Rejected' });
    expect(client.currentSelfProfile).toEqual({});
    httpAction.mockImplementationOnce(async () => { abort.abort(); return { status: 'ok', retcode: 0, data: null } as never; });
    await expect(client.requestApi({ action: 'set_self_longnick', params: { longNick: 'Cancelled' }, signal: abort.signal })).rejects.toMatchObject({ disposition: 'unknown' });
    expect(client.currentSelfProfile).toEqual({});
  });

  it.each(['get_login_info', 'get_stranger_info'])('does not let an earlier %s response undo a newer legacy SDK profile write', async action => {
    let complete!: (value: unknown) => void;
    let delay = false;
    const httpAction = vi.fn(async (_config: unknown, method: string) => {
      if (delay && method === action) return await new Promise(resolve => { complete = resolve; });
      return { status: 'ok', retcode: 0, data: method === 'get_login_info' ? { user_id: 123, nickname: 'Initial' } : null };
    });
    const client = new NapcatClient({ config: { context: 'napcat', id: 'instance-name', connection: 'http', http_url: 'http://synthetic.invalid', post_path: '/test' },
      httpAction: httpAction as typeof callNapCatHttpAction });
    await client.callApi('get_login_info');
    delay = true;
    const oldRead = client.callApi(action, action === 'get_stranger_info' ? { user_id: 123 } : {});
    await client.setQQProfile({ nickname: 'Confirmed new' });
    complete({ status: 'ok', retcode: 0, data: { user_id: 123, nickname: 'Old snapshot', long_nick: 'Old signature' } });
    await oldRead;
    expect(client.currentSelfProfile).toEqual({ nickname: 'Confirmed new' });
  });
});
