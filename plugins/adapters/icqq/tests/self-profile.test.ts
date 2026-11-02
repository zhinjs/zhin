import { createIcqqSelfProfile } from '../src/self-profile.js';
import { EndpointProfileState } from '@zhin.js/adapter';

function fixture() {
  const client = {
    uin: 123, nickname: 'Login name', isOnline: vi.fn(() => true),
    getProfile: vi.fn(async () => ({ nickname: 'Current name', sex: 'female', age: 24,
      signature: '', avatar: { url: 'https://example.com/avatar.jpg' }, mail: 'not-for-agent@example.com', QID: 'not-for-agent' })),
    setNickname: vi.fn(async (_value: string) => true), setGender: vi.fn(async (_value: 0 | 1 | 2) => true),
    setSignature: vi.fn(async (_value?: string) => true), setDescription: vi.fn(async (_value?: string) => true),
    setAvatar: vi.fn(async (_value: unknown) => undefined),
  };
  return { client, port: createIcqqSelfProfile(client), signal: new AbortController().signal };
}

describe('ICQQ own account profile', () => {
  it('reads only supported self facts, preserving known empty signatures and live nickname', async () => {
    const { client, port, signal } = fixture();
    expect(port.current).toEqual({ nickname: 'Login name' });
    expect(await port.read({ signal })).toEqual({ nickname: 'Current name', gender: 'female', age: 24,
      signature: '', avatar: 'https://example.com/avatar.jpg' });
    expect(client.getProfile).toHaveBeenCalledExactlyOnceWith(123);
    expect(port.current).toEqual({ nickname: 'Login name' });
    client.nickname = 'Native event name';
    expect(port.current).toEqual({ nickname: 'Native event name' });
  });

  it('does not claim supported birthday, age or interests writes', async () => {
    const { port, signal } = fixture();
    expect(port.writableFields).toEqual(['nickname', 'gender', 'signature', 'bio', 'avatar']);
    expect(await port.write!({ signal, change: { field: 'birthday', value: '2000-02-29' } })).toMatchObject({ status: 'rejected' });
    expect(await port.write!({ signal, change: { field: 'age', value: 24 } })).toMatchObject({ status: 'rejected' });
  });

  it('does not let a delayed profile query overwrite a newer native nickname event', async () => {
    const { client, port, signal } = fixture();
    let complete!: (profile: Record<string, unknown>) => void;
    client.getProfile.mockImplementation(() => new Promise(resolve => { complete = resolve; }) as never);
    const state = new EndpointProfileState({ source: port, defaults: {} });
    const pending = state.read({ signal });
    client.nickname = 'Newer native event';
    complete({ nickname: 'Earlier query snapshot' });
    expect((await pending).values.nickname).toBe('Newer native event');
    expect(client.nickname).toBe('Newer native event');
  });

  it('maps gender explicitly and returns a native rejection without updating cached nickname', async () => {
    const { client, port, signal } = fixture();
    expect(await port.write!({ signal, change: { field: 'gender', value: 'female' } })).toEqual({ status: 'updated', profile: { gender: 'female' } });
    expect(client.setGender).toHaveBeenCalledExactlyOnceWith(2);
    client.setNickname.mockResolvedValue(false);
    expect(await port.write!({ signal, change: { field: 'nickname', value: 'Rejected' } })).toMatchObject({ status: 'rejected' });
    expect(port.current).toEqual({ nickname: 'Login name' });
    expect(await port.write!({ signal, change: { field: 'gender', value: 'other' } })).toMatchObject({ status: 'rejected' });
    expect(client.setGender).toHaveBeenCalledTimes(1);
  });

  it('updates the live SDK nickname only after acknowledgement and keeps avatar input out of facts', async () => {
    const { client, port, signal } = fixture();
    await port.write!({ signal, change: { field: 'nickname', value: 'New name' } });
    expect(port.current).toEqual({ nickname: 'New name' });
    expect(await port.write!({ signal, change: { field: 'avatar', value: { kind: 'url', value: 'https://example.com/new.jpg' } } })).toEqual({ status: 'updated' });
    expect(client.setAvatar).toHaveBeenCalledExactlyOnceWith('https://example.com/new.jpg');
  });

  it('retains errors and prevents a late cancelled lookup or mutation from updating facts', async () => {
    const { client, port } = fixture();
    const abort = new AbortController();
    client.setNickname.mockImplementation(() => new Promise<boolean>(() => undefined));
    const pending = port.write!({ signal: abort.signal, change: { field: 'nickname', value: 'Late' } });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'endpoint_inactive', disposition: 'unknown' });
    expect(client.nickname).toBe('Login name');
    client.getProfile.mockRejectedValue(new Error('native lookup failed'));
    await expect(port.read({ signal: new AbortController().signal })).rejects.toThrow('native lookup failed');
  });
});
