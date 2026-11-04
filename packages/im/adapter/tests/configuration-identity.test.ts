import { sameConfigurationIdentity } from '../src/configuration-identity.js';
import type { EndpointDesiredRecord } from '../src/adapter-types.js';

const previous: EndpointDesiredRecord = { instanceId: 'account-instance', canonicalId: 'account-canonical', endpointId: 'bot',
  revision: 1, desiredEnabled: false, config: { token: 'old' } };
function input() {
  return { previous, next: { config: { token: 'rotated' } }, changedFields: ['token'], signal: new AbortController().signal,
    identify: vi.fn(async (_config: Record<string, unknown>, _signal: AbortSignal, _fields: readonly string[]): Promise<string | undefined> => 'platform:123') };
}

describe('read-only credential identity verification', () => {
  it('compares actual identities rather than credential text', async () => {
    const options = input();
    await expect(sameConfigurationIdentity(options)).resolves.toBe(true);
    expect(options.identify.mock.calls.map(call => call[0].token)).toEqual(['old', 'rotated']);
    options.identify.mockResolvedValueOnce('platform:123').mockResolvedValueOnce('platform:456');
    await expect(sameConfigurationIdentity(options)).resolves.toBe(false);
  });
  it('resolves nested encrypted references only into private verification copies', async () => {
    const options = { ...input(), previous: { ...previous, config: { auth: { user: 'bot' } }, secretRefs: { 'auth.token': 'old-ref' } },
      next: { config: { auth: { user: 'bot' } }, secretRefs: { 'auth.token': 'new-ref' } },
      secrets: { resolve: vi.fn(async (reference: string) => reference === 'old-ref' ? 'old-secret' : 'new-secret') } };
    await expect(sameConfigurationIdentity(options)).resolves.toBe(true);
    expect(options.identify.mock.calls.map(call => call[0].auth)).toEqual([
      { user: 'bot', token: 'old-secret' }, { user: 'bot', token: 'new-secret' },
    ]);
    expect(options.previous.config.auth).toEqual({ user: 'bot' });
    expect(options.next.config.auth).toEqual({ user: 'bot' });
  });
  it('keeps a failed lookup distinct from unsupported verification', async () => {
    const options = input(), cause = new Error('synthetic upstream lookup failure');
    options.identify.mockRejectedValueOnce(cause);
    await expect(sameConfigurationIdentity(options)).rejects.toMatchObject({ code: 'unavailable', cause });
    options.identify.mockResolvedValueOnce(undefined);
    await expect(sameConfigurationIdentity(options)).rejects.toMatchObject({ code: 'unsupported' });
    expect(options.identify).toHaveBeenCalledTimes(2);
  });
  it('does not invoke a provider after cancellation', async () => {
    const controller = new AbortController(), options = { ...input(), signal: controller.signal };
    const reason = new Error('account operation cancelled'); controller.abort(reason);
    await expect(sameConfigurationIdentity(options)).rejects.toBe(reason);
    expect(options.identify).not.toHaveBeenCalled();
  });
  it('does not start a second lookup after cancellation during the first', async () => {
    const controller = new AbortController(), options = { ...input(), signal: controller.signal };
    const reason = new Error('generation retired');
    options.identify.mockImplementationOnce(async () => { controller.abort(reason); return 'platform:123'; });
    await expect(sameConfigurationIdentity(options)).rejects.toBe(reason);
    expect(options.identify).toHaveBeenCalledOnce();
  });
});
