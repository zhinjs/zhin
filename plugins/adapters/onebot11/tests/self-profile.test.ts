import { createOnebot11SelfProfile } from '../src/self-profile.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';

const signal = new AbortController().signal;

describe('OneBot11 self profile observation order', () => {
  it('does not replace a newer verified login name when its extended lookup fails', async () => {
    let complete!: (value: unknown) => void;
    const earlierSignal = new AbortController().signal;
    const call = vi.fn(async ({ action, signal: requestSignal }: { action: string; signal?: AbortSignal }) => {
      if (action === 'get_login_info') return { user_id: 1, nickname: requestSignal === earlierSignal ? 'Old login' : 'New verified login' };
      if (requestSignal === earlierSignal) return new Promise(resolve => { complete = resolve; });
      throw new Error('New extended lookup unavailable');
    });
    const port = createOnebot11SelfProfile({ call, reportAccount: vi.fn() });
    const earlier = port.read({ signal: earlierSignal });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await expect(port.read({ signal })).rejects.toThrow('New extended lookup unavailable');
    complete({ user_id: 1, nickname: 'Old extended name' });
    await earlier;
    expect(port.current).toEqual({ nickname: 'New verified login' });
  });
  it.each(['get_login_info', 'get_stranger_info'])('retains the last valid %s response when a newer login query fails', async delayedAction => {
    let complete!: (value: unknown) => void;
    const earlierSignal = new AbortController().signal;
    const call = vi.fn(async ({ action, signal: requestSignal }: { action: string; signal?: AbortSignal }) => {
      if (requestSignal !== earlierSignal) throw new Error('Newer login lookup failed');
      if (action === delayedAction) return new Promise(resolve => { complete = resolve; });
      return { user_id: 1, nickname: action === 'get_login_info' ? 'Login name' : 'Last valid name' };
    });
    const port = createOnebot11SelfProfile({ call, reportAccount: vi.fn() });
    const earlier = port.read({ signal: earlierSignal });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await expect(port.read({ signal })).rejects.toThrow('Newer login lookup failed');
    complete({ user_id: 1, nickname: 'Last valid name' });
    await earlier;
    expect(port.current).toEqual({ nickname: 'Last valid name' });
  });
  it.each(['get_login_info', 'get_stranger_info'])('never publishes a delayed %s response over a newer read', async delayedAction => {
    let complete!: (value: unknown) => void;
    let delay = true;
    const earlierSignal = new AbortController().signal;
    const call = vi.fn(async ({ action, signal: requestSignal }: { action: string; signal?: AbortSignal }) => {
      if (delay && action === delayedAction) { delay = false; return new Promise(resolve => { complete = resolve; }); }
      return { user_id: 2, nickname: requestSignal === earlierSignal ? 'Older name' : 'New name' };
    });
    const port = createOnebot11SelfProfile({ call, reportAccount: vi.fn() });
    const earlier = port.read({ signal: earlierSignal });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(await port.read({ signal })).toEqual({ nickname: 'New name' });
    complete({ user_id: 2, nickname: 'Older name' });
    await earlier;
    expect(port.current).toEqual({ nickname: 'New name' });
  });

  it('clears cached facts on account changes/stop and rejects reads from an earlier account', async () => {
    let complete!: (value: unknown) => void;
    const call = vi.fn(async ({ action }: { action: string }) => action === 'get_login_info'
      ? { user_id: 1, nickname: 'Old account' }
      : await new Promise(resolve => { complete = resolve; }));
    const report = vi.fn(), port = createOnebot11SelfProfile({ call, reportAccount: report });
    const pending = port.read({ signal });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(port.current).toEqual({ nickname: 'Old account' });
    port.reportAccount('2');
    expect(port.current).toEqual({});
    complete({ user_id: 1, nickname: 'Late old account' });
    await expect(pending).rejects.toThrow('account changed');
    expect(port.current).toEqual({});
    port.reportAccount(undefined);
    expect(report).toHaveBeenLastCalledWith(undefined);
    expect(port.current).toEqual({});
  });

  it.each(['rejected', 'unknown'] as const)('does not hide an extended lookup %s as a successful partial read', async disposition => {
    const failure = new EndpointDeliveryError('native_failure', 'Extended lookup failed', disposition);
    const call = vi.fn(async ({ action }: { action: string }) => {
      if (action === 'get_login_info') return { user_id: 1, nickname: 'Verified login name' };
      throw failure;
    });
    const port = createOnebot11SelfProfile({ call, reportAccount: vi.fn() });
    await expect(port.read({ signal })).rejects.toBe(failure);
    expect(port.current).toEqual({ nickname: 'Verified login name' });
  });

  it('invalidates a read stopped before the first account identity was known', async () => {
    let complete!: (value: unknown) => void;
    const port = createOnebot11SelfProfile({ call: () => new Promise(resolve => { complete = resolve; }), reportAccount: vi.fn() });
    const pending = port.read({ signal });
    port.reportAccount(undefined);
    complete({ user_id: 1, nickname: 'Stopped account' });
    await expect(pending).rejects.toThrow('account changed');
    expect(port.current).toEqual({});
  });
});
