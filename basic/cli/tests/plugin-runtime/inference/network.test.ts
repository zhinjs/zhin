import type { ProviderAccount, ProviderDefinition, ProviderService } from '@zhin.js/ai/provider';
import { createProviderNetwork, matchesProviderTarget } from '../../../src/plugin-runtime/inference/network.js';
const account: ProviderAccount = { id: 'a', rootId: 'r', ownerId: 'host', revision: 1, serviceId: 's', incarnation: 'first', authentication: { method: 'api-key' } };
const service: ProviderService = { id: 's', rootId: 'r', ownerId: 'host', revision: 1, driver: { id: 'fixture', owner: 'root', contractVersion: '1' }, options: {}, models: {} };
const definition: ProviderDefinition<unknown, unknown> = { id: 'fixture', contractVersion: '1', serviceSchema: { parse: value => value }, authentication: { methods: ['api-key'] },
  targets: () => ({ authentication: [], inference: ['https://provider.test/v1'] }), models: () => ({}), createExecution: () => ({}) };

it('matches normalized origins and whole path boundaries, never host substrings or credential-bearing descriptors', () => {
  expect(matchesProviderTarget(new URL('https://provider.test/v1/messages'), ['https://provider.test/v1'])).toBe(true);
  for (const url of ['https://provider.test.evil/v1', 'https://provider.test/v11', 'https://secret@provider.test/v1', 'http://provider.test/v1']) {
    expect(matchesProviderTarget(new URL(url), ['https://provider.test/v1'])).toBe(false);
  }
  expect(matchesProviderTarget(new URL('https://provider.test/v1'), ['https://provider.test/v1?api_key=private'])).toBe(false);
});

it('enforces target boundaries at each redirect and preserves a 307 POST without adding requests', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/v1/final' } }))
    .mockResolvedValueOnce(new Response('done'));
  const network = createProviderNetwork({ account, service, definition, hostOwnerId: 'host', purpose: 'inference', hostFetch: fetch });
  expect(await (await network('https://provider.test/v1/start', { method: 'POST', body: 'body', headers: { authorization: 'Bearer synthetic' } })).text()).toBe('done');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[1]?.method).toBe('POST');
  expect(Buffer.from(fetch.mock.calls[1]?.[1]?.body as ArrayBuffer).toString()).toBe('body');
  fetch.mockReset().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.test/v1' } }));
  await expect(network('https://provider.test/v1/start')).rejects.toMatchObject({ code: 'redirect-denied' });
  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockReset().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/outside' } }));
  await expect(network('https://provider.test/v1/start')).rejects.toMatchObject({ code: 'redirect-denied' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('uses personal egress policy for a personal Account even when it references a Host Service', async () => {
  const host = vi.fn<typeof globalThis.fetch>(), personal = vi.fn(async () => new Response('personal'));
  const factory = vi.fn(() => personal);
  const network = createProviderNetwork({ account: { ...account, ownerId: 'member' }, service, definition, hostOwnerId: 'host', purpose: 'inference', hostFetch: host, personalFetch: factory });
  expect(await (await network('https://provider.test/v1/messages')).text()).toBe('personal');
  expect(factory).toHaveBeenCalledWith('https://provider.test'); expect(host).not.toHaveBeenCalled();
  await expect(network('https://elsewhere.test/v1')).rejects.toMatchObject({ code: 'target-denied' });
  expect(personal).toHaveBeenCalledOnce();
});
