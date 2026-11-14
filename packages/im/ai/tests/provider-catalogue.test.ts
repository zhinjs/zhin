import { anthropicProvider, googleProvider, openAiCompatibleProvider } from '../src/providers/api-key.js';
import { driverFixture, callContext, prompt } from './providers/fixtures.js';
import { claudeSubscriptionProvider, codexProvider } from '../src/providers/subscriptions.js';

function service<S>(definition: { id: string; serviceSchema: { parse(value: unknown): S } }, options: unknown = {}) {
  return { id: 'service', rootId: 'root', ownerId: 'host', revision: 1, driver: { id: definition.id, owner: 'root', contractVersion: '1' },
    options: definition.serviceSchema.parse(options), models: {} };
}
const signal = new AbortController().signal;
const credentials = { bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: 'synthetic-key', headers: {}, revision: '1' }) };

it('does not invent preset Anthropic capabilities or query a catalogue when listing configured Profiles', async () => {
  expect(anthropicProvider.models(service(anthropicProvider))).toEqual({});
  const fetch = vi.fn();
  const fixture = driverFixture({ definition: anthropicProvider, model: { id: 'explicit-model', protocol: 'anthropic-messages', kinds: ['language'] }, fetch });
  const client = await fixture.runtime.openOperation({ context: callContext });
  const listed = await client.list({ kind: 'language' });
  expect(listed).toHaveLength(1); expect(listed[0].model).toBe('explicit-model');
  expect(fetch).not.toHaveBeenCalled(); expect(fixture.authorize).not.toHaveBeenCalled(); await client.close();
});

it('uses explicit Google discovery and returns usable native ids without guessing model kinds', async () => {
  const fetch = vi.fn(async () => Response.json({ models: [
    { name: 'models/synthetic-chat', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/synthetic-embedding', supportedGenerationMethods: ['embedContent'] },
  ] }));
  const observed = await googleProvider.discover!({ service: service(googleProvider, { baseUrl: 'https://proxy.example' }), credentials, fetch, signal });
  expect(observed).toEqual([{ id: 'synthetic-chat' }, { id: 'synthetic-embedding' }]);
  expect(new Request(...fetch.mock.calls[0]).url).toBe('https://proxy.example/v1beta/models');
  expect(new Request(...fetch.mock.calls[0]).headers.get('x-goog-api-key')).toBe('synthetic-key');
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: googleProvider, model: { id: observed[0].id, protocol: 'google-generate-content', kinds: ['language'] },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }); } });
  const client = await fixture.runtime.openOperation({ context: callContext });
  await client.generate({ request: { context: prompt } });
  expect(requests[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/synthetic-chat:generateContent');
  await client.close();
});

it('keeps independent catalogue credentials and transports isolated between Service owners', async () => {
  const left = vi.fn(async () => Response.json({ data: [{ id: 'left-model' }] })), right = vi.fn(async () => Response.json({ data: [{ id: 'right-model' }] }));
  const discover = async (name: string, fetch: typeof globalThis.fetch) => openAiCompatibleProvider.discover!({
    service: service(openAiCompatibleProvider, { baseUrl: `https://${name}.example/v1` }),
    credentials: { bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: `${name}-key`, headers: {}, revision: '1' }) }, fetch, signal });
  expect(await discover('left', left)).toEqual([{ id: 'left-model' }]); expect(await discover('right', right)).toEqual([{ id: 'right-model' }]);
  expect(new Request(...left.mock.calls[0]).url).toBe('https://left.example/v1/models'); expect(new Request(...right.mock.calls[0]).url).toBe('https://right.example/v1/models');
  expect(new Request(...left.mock.calls[0]).headers.get('authorization')).toBe('Bearer left-key');
  expect(new Request(...right.mock.calls[0]).headers.get('authorization')).toBe('Bearer right-key');
});

it('discovers Codex subscription models from the Codex backend catalogue, keeping only listed models', async () => {
  const fetch = vi.fn(async () => Response.json({ models: [
    { slug: 'synthetic-codex', display_name: 'Synthetic Codex', visibility: 'list' },
    { slug: 'synthetic-hidden', display_name: 'Hidden', visibility: 'hide' },
  ] }));
  const grantCredentials = { bindRequest: (input: { request: Request }) => input.request,
    authorize: async () => ({ token: 'synthetic-oauth', headers: {}, revision: '1', metadata: { chatgptAccountId: 'routing-account' } }) };
  const observed = await codexProvider.discover!({ service: service(codexProvider), credentials: grantCredentials, fetch, signal });
  expect(observed).toEqual([{ id: 'synthetic-codex', label: 'Synthetic Codex' }]);
  const request = new Request(...fetch.mock.calls[0]);
  const url = new URL(request.url);
  expect(`${url.origin}${url.pathname}`).toBe('https://chatgpt.com/backend-api/codex/models');
  expect(url.searchParams.get('client_version')).toMatch(/^\d+\.\d+\.\d+/);
  expect(request.headers.get('authorization')).toBe('Bearer synthetic-oauth');
  expect(request.headers.get('chatgpt-account-id')).toBe('routing-account');
  expect(codexProvider.targets(service(codexProvider)).discovery).toEqual(['https://chatgpt.com/backend-api/codex/models']);
});

it('offers Claude subscription model IDs only as labelled suggestions, without discovery', () => {
  expect(claudeSubscriptionProvider.discover).toBeUndefined();
  expect(claudeSubscriptionProvider.models(service(claudeSubscriptionProvider))).toEqual({});
  expect(claudeSubscriptionProvider.modelSuggestions?.length).toBeGreaterThan(0);
  for (const suggestion of claudeSubscriptionProvider.modelSuggestions ?? []) expect(suggestion.label).toContain('suggestion');
});
