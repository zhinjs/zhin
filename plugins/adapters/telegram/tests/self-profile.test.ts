import { createTelegramSelfProfile } from '../src/self-profile.js';
import { EndpointProfileState } from '@zhin.js/adapter';
import { TelegramClient } from '../src/telegram-client.js';
import { resolveTelegramConfig } from '../src/protocol.js';

function fixture() {
  let nickname = 'Login name';
  const callApi = vi.fn(async (method: string) => {
    if (method === 'getMyName') return { name: 'Real name' };
    if (method === 'getMyDescription') return { description: 'About this bot' };
    if (method === 'getMyShortDescription') return { short_description: '' };
    return true;
  });
  const callApiForm = vi.fn(async () => true);
  const port = createTelegramSelfProfile({ client: { callApi, callApiForm } as never,
    current: () => ({ nickname }), nicknameChanged: value => { nickname = value; } });
  return { callApi, callApiForm, port, signal: new AbortController().signal };
}

describe('Telegram bot account profile', () => {
  it.each(['nickname', 'avatar'] as const)('maps real Bot API rejections for %s without invalidating confirmed facts', async field => {
    const client = new TelegramClient({ config: resolveTelegramConfig({ id: 'test', token: 'synthetic' }),
      fetch: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ ok: false, error_code: 400, description: 'Change rejected' }), json: async () => ({}) }) });
    const changed = vi.fn();
    const source = createTelegramSelfProfile({ client, current: () => ({ nickname: 'Known name' }), nicknameChanged: changed });
    const signal = new AbortController().signal;
    const change = field === 'nickname' ? { field, value: 'No' } as const
      : { field, value: { kind: 'base64', value: 'aW1hZ2U=', mime_type: 'image/jpeg' } } as const;
    expect(await source.write!({ signal, change })).toMatchObject({ status: 'rejected', message: expect.stringContaining('Change rejected') });
    expect(source.current).toEqual({ nickname: 'Known name' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('reports an uncertain real transport result as unknown and preserves not-sent cancellation', async () => {
    const client = new TelegramClient({ config: resolveTelegramConfig({ id: 'test', token: 'synthetic' }),
      fetch: async () => { throw new Error('Connection closed'); } });
    const source = createTelegramSelfProfile({ client, current: () => ({}), nicknameChanged: vi.fn() });
    expect(await source.write!({ signal: new AbortController().signal, change: { field: 'nickname', value: 'Maybe' } }))
      .toMatchObject({ status: 'unknown', message: expect.stringContaining('Connection closed') });
    const abort = new AbortController(); abort.abort();
    await expect(source.write!({ signal: abort.signal, change: { field: 'nickname', value: 'No' } }))
      .rejects.toMatchObject({ disposition: 'not_sent' });
  });
  it('distinguishes bot profile methods from chat description methods', async () => {
    const { port, callApi, signal } = fixture();
    expect(await port.read({ signal })).toEqual({ nickname: 'Real name', signature: '', bio: 'About this bot' });
    expect(port.current).toEqual({ nickname: 'Login name' });
    expect(callApi.mock.calls.map(call => call[0])).toEqual(['getMyName', 'getMyDescription', 'getMyShortDescription']);
    expect(await port.write!({ signal, change: { field: 'bio', value: '' } })).toEqual({ status: 'updated', profile: { bio: '' } });
    expect(callApi).toHaveBeenLastCalledWith('setMyDescription', { description: '' }, signal);
  });

  it('does not acknowledge a false native setter result or invent unsupported gender/age', async () => {
    const { port, callApi, signal } = fixture();
    callApi.mockResolvedValueOnce(false);
    expect(await port.write!({ signal, change: { field: 'nickname', value: 'Rejected' } })).toMatchObject({ status: 'rejected' });
    expect(port.current).toEqual({ nickname: 'Login name' });
    expect(await port.write!({ signal, change: { field: 'gender', value: 'male' } })).toMatchObject({ status: 'rejected' });
    expect(callApi).toHaveBeenCalledTimes(1);
  });

  it('does not let a delayed name query overwrite a confirmed nickname change', async () => {
    const { port, callApi, signal } = fixture();
    let complete!: (value: { name: string }) => void;
    callApi.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }) as never);
    const state = new EndpointProfileState({ source: port, defaults: {} });
    const pending = state.read({ signal });
    await state.write({ signal, change: { field: 'nickname', value: 'Confirmed new name' } });
    complete({ name: 'Earlier query snapshot' });
    expect((await pending).values.nickname).toBe('Confirmed new name');
    expect(port.current).toEqual({ nickname: 'Confirmed new name' });
  });

  it('uploads resolved JPEG bytes via multipart, without leaking bot-token URLs or echoing bytes', async () => {
    const { port, callApiForm, signal } = fixture();
    const bytes = Buffer.from('synthetic JPEG payload');
    expect(await port.write!({ signal, change: { field: 'avatar', value: { kind: 'base64', value: bytes.toString('base64'), mime_type: 'image/jpeg' } } })).toEqual({ status: 'updated' });
    const [method, form, passedSignal] = callApiForm.mock.calls[0] as unknown as [string, FormData, AbortSignal];
    expect(method).toBe('setMyProfilePhoto');
    expect(form.get('photo')).toBe('{"type":"static","photo":"attach://avatar"}');
    expect(Buffer.from(await (form.get('avatar') as Blob).arrayBuffer())).toEqual(bytes);
    expect(passedSignal).toBe(signal);
    expect(await port.write!({ signal, change: { field: 'avatar', value: { kind: 'url', value: 'https://example.com/photo.jpg' } } })).toMatchObject({ status: 'rejected' });
  });
});
