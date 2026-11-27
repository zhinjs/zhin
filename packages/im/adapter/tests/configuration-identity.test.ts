import { getLogger } from '@zhin.js/logger';
import { identityFailureReason, sameConfigurationIdentity } from '../src/configuration-identity.js';
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
  it('#1250 b111: logs why the lookup failed, with resolved credentials masked', async () => {
    const warn = vi.spyOn(getLogger('adapter'), 'warn');
    const options = { ...input(), previous: { ...previous, secretRefs: { token: 'old-ref' } },
      secrets: { resolve: vi.fn(async () => 'resolved-secret-1') } };
    options.identify.mockRejectedValueOnce(new Error('platform said 401 for resolved-secret-1 at https://api.test/x?token=abc\nstack'));
    await expect(sameConfigurationIdentity(options)).rejects.toMatchObject({ code: 'unavailable' });
    const line = warn.mock.calls.map(call => String(call[0])).find(text => text.includes('endpoint_identity_verification_failed'));
    expect(line).toContain('platform said 401 for *** at https://api.test/x?***');
    expect(line).not.toContain('resolved-secret-1');
    expect(line).not.toContain('stack');
    warn.mockRestore();
  });
  it('#1250 b111: masks credentials typed in plain text in the previous or the new configuration', async () => {
    const warn = vi.spyOn(getLogger('adapter'), 'warn');
    const options = { ...input(), previous: { ...previous, config: { token: 'old-plain-token-1', appId: 'cli_app' } },
      next: { config: { token: 'NEW-plain-token-2', clientSecret: 'console-typed-secret', nested: { key: 'nested-key-value' } } } };
    options.identify.mockResolvedValueOnce('platform:123')
      .mockRejectedValueOnce(new Error('401 NEW-plain-token-2 / console-typed-secret / nested-key-value / old-plain-token-1 rejected'));
    await expect(sameConfigurationIdentity(options)).rejects.toMatchObject({ code: 'unavailable' });
    const line = warn.mock.calls.map(call => String(call[0])).find(text => text.includes('endpoint_identity_verification_failed'))!;
    for (const secret of ['NEW-plain-token-2', 'console-typed-secret', 'nested-key-value', 'old-plain-token-1']) expect(line).not.toContain(secret);
    expect(line).toContain('401 *** / *** / *** / *** rejected');
    warn.mockRestore();
  });
  it.each([
    ['bad token=XYZabc123 here', 'XYZabc123'],
    ['body {"secret":"s3cr3t-value"}', 's3cr3t-value'],
    ['refused access_token=abcd1234efgh', 'abcd1234efgh'],
    ['Authorization: token ghp_abcdefghijklmnop1234', 'ghp_abcdefghijklmnop1234'],
    ['key -----BEGIN RSA PRIVATE KEY----- MIIEabcdef== -----END RSA PRIVATE KEY-----', 'MIIEabcdef'],
    ['-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----', 'MIIEvQIBADANBgkq'],
  ])('#1250 b111: masks secret-shaped text %j', (text, secret) => {
    expect(identityFailureReason(new Error(text))).not.toContain(secret);
  });
  it('#1250 b111: masks before it cuts, so a secret across the boundary is not half kept', () => {
    const secret = 'boundary-secret-0123456789';
    const reason = identityFailureReason(new Error(`${'x'.repeat(190)} ${secret}`), [secret]);
    expect(reason).not.toMatch(/boundary|0123456789/u);
    expect(identityFailureReason(new Error(`${'x'.repeat(190)} token=abcdefghijklmnopqrstuvwxyz`))).not.toMatch(/abcdefgh|klmnop/u);
  });
  it('bounds and masks identity failure reasons', () => {
    expect(identityFailureReason(new Error('Bearer abcdef denied'))).toBe('Bearer *** denied');
    expect(identityFailureReason('x'.repeat(300))).toHaveLength(201);
    expect(identityFailureReason(new Error(''))).toBe('Error');
  });
});
