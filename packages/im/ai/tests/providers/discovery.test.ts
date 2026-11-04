import { googleProvider, anthropicProvider, openAiProvider } from '../../src/providers/api-key.js';
import { openCodeGoProvider, openCodeZenProvider, codexProvider } from '../../src/providers/subscriptions.js';

function service<T>(definition: { id: string; serviceSchema: { parse(input: unknown): T } }) {
  return { id: 'service', rootId: 'root', ownerId: 'host:test', revision: 1,
    driver: { id: definition.id, owner: 'root/providers', contractVersion: '1' },
    options: definition.serviceSchema.parse({}), models: {} };
}
const signal = new AbortController().signal;
function credentials() { return { bindRequest: (input: { request: Request }) => input.request, authorize: vi.fn(async () => ({ token: 'synthetic', headers: {}, revision: '1' })) }; }

it('discovers actual OpenAI model ids without inventing kinds, modalities or a usable Profile', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: [{ id: 'unfamiliar-model' }] }));
  const grant = credentials();
  const models = await openAiProvider.discover!({ service: service(openAiProvider), credentials: grant, fetch, signal });
  expect(models).toEqual([{ id: 'unfamiliar-model' }]);
  expect(new Request(...fetch.mock.calls[0]).url).toBe('https://api.openai.com/v1/models');
  expect(new Request(...fetch.mock.calls[0]).headers.get('authorization')).toBe('Bearer synthetic');
  expect(grant.authorize).toHaveBeenCalledTimes(1);
});

it('follows actual Google page tokens and obtains a current grant for each page', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ models: [{ name: 'models/first', displayName: 'First' }], nextPageToken: 'cursor' }))
    .mockResolvedValueOnce(Response.json({ models: [{ name: 'models/second' }] }));
  const grant = credentials();
  expect(await googleProvider.discover!({ service: service(googleProvider), credentials: grant, fetch, signal })).toEqual([{ id: 'first', label: 'First' }, { id: 'second' }]);
  expect(new URL(new Request(...fetch.mock.calls[1]).url).searchParams.get('pageToken')).toBe('cursor');
  expect(new Request(...fetch.mock.calls[0]).headers.get('x-goog-api-key')).toBe('synthetic');
  expect(grant.authorize).toHaveBeenCalledTimes(2);
});

it('does not turn a failed later directory page into an empty or partially successful refresh', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ data: [{ id: 'first', display_name: 'First' }], has_more: true, last_id: 'first' }))
    .mockResolvedValueOnce(Response.json({ error: 'private remote detail' }, { status: 503 }));
  await expect(anthropicProvider.discover!({ service: service(anthropicProvider), credentials: credentials(), fetch, signal })).rejects.toThrow('503');
  expect(new URL(new Request(...fetch.mock.calls[1]).url).searchParams.get('after_id')).toBe('first');
});

it.each([openCodeGoProvider, openCodeZenProvider])('keeps the OpenCode $id product directory distinct', async definition => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: [{ id: 'native-model', name: 'Native' }] }));
  expect(await definition.discover!({ service: service(definition), credentials: credentials(), fetch, signal })).toEqual([{ id: 'native-model', label: 'Native' }]);
  expect(new Request(...fetch.mock.calls[0]).url).toBe(`https://opencode.ai/inference${definition.id === 'opencode-go' ? '/go' : ''}/v1/models`);
});

it('does not advertise an unimplemented subscription catalogue as a working discovery interface', () => {
  expect(codexProvider.discover).toBeUndefined();
});
