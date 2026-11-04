import { openAiCompatibleProvider } from '../../../../../packages/im/ai/src/providers/api-key.js';
import { typeSafeProvider } from '../../../../../plugins/services/typesafe/src/provider.js';
import { callContext, chatReply, driverFixture, prompt } from '../../../../../packages/im/ai/tests/providers/fixtures.js';
import { createProviderNetwork } from '../../../src/plugin-runtime/inference/network.js';
import { AiCompletionQuotaError } from '@zhin.js/agent/runtime';

it.each(['same-origin', 'cross-origin'])('keeps actual SDK POST/body/auth inside the Host %s redirect boundary', async mode => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', kinds: ['language'], protocol: 'openai-chat' }, parameters: { maxRetries: 0 },
    fetch: (url, init) => network(url, init) });
  const network: typeof globalThis.fetch = createProviderNetwork({ definition: openAiCompatibleProvider, account: fixture.graph.accounts.account,
    service: { ...fixture.graph.services.service, options: openAiCompatibleProvider.serviceSchema.parse({ baseUrl: 'https://provider.example/v1' }) },
    hostOwnerId: callContext.hostOwnerId, purpose: 'inference', hostFetch: async (url, init) => {
      requests.push(new Request(url, init));
      if (requests.length === 1) return new Response(null, { status: 307, headers: { location: mode === 'same-origin' ? '/v1/final' : 'https://foreign.example/collect' } });
      return chatReply();
    } });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    if (mode === 'same-origin') {
      await client.generate({ request: { context: prompt } });
      expect(requests).toHaveLength(2); expect(await requests[1].text()).toBe(await requests[0].text());
      expect(requests[1].headers.get('authorization')).toBe('Bearer synthetic-key'); expect(requests[1].method).toBe('POST');
    } else {
      await expect(client.generate({ request: { context: prompt } })).rejects.toBeInstanceOf(Error);
      expect(requests).toHaveLength(1);
    }
    expect(requests.every(request => new URL(request.url).origin === 'https://provider.example')).toBe(true);
  } finally { await client.close(); }
});

it('allows the real TypeSafe SDK to follow a same-origin HTTPS 307 under Host policy', async () => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: typeSafeProvider, options: { baseUrl: 'https://provider.example' },
    model: { id: 'jev-local', kinds: ['decision'], protocol: 'typesafe-system-one' }, parameters: { maxRetries: 0 }, fetch: (url, init) => network(url, init) });
  const network: typeof globalThis.fetch = createProviderNetwork({ definition: typeSafeProvider, account: fixture.graph.accounts.account,
    service: { ...fixture.graph.services.service, options: typeSafeProvider.serviceSchema.parse({ baseUrl: 'https://provider.example' }) }, hostOwnerId: callContext.hostOwnerId, purpose: 'inference',
    hostFetch: async (url, init) => {
      requests.push(new Request(url, init));
      if (requests.length === 1) return new Response(null, { status: 307, headers: { location: '/v1/final' } });
      return Response.json({ model: 'jev-local', usage: { input_tokens: 1, output_tokens: 1 }, answers: { allowed: { type: 'noul', noul: 0.8 } } });
    } });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const profile = (await client.list({ kind: 'decision' }))[0].reference;
    expect((await client.evaluate({ profile, state: null, questions: { allowed: { type: 'noul' } } })).answers.allowed.noul).toBe(0.8);
    expect(requests).toHaveLength(2); expect(await requests[1].text()).toBe(await requests[0].text());
    expect(requests[1].headers.get('authorization')).toBe('Bearer synthetic-key');
  } finally { await client.close(); }
});

it('preserves a personal quota denial through the real SDK without transport submission or automatic network retry', async () => {
  const denied = new AiCompletionQuotaError('synthetic token quota', 'user', 1), transport = vi.fn(async () => chatReply());
  const submitted = vi.fn(() => { throw denied; });
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', kinds: ['language'], protocol: 'openai-chat' }, parameters: { maxRetries: 2 }, fetch: (url, init) => network(url, init) });
  const network: typeof globalThis.fetch = createProviderNetwork({ definition: openAiCompatibleProvider, account: { ...fixture.graph.accounts.account, ownerId: 'personal' },
    service: { ...fixture.graph.services.service, options: openAiCompatibleProvider.serviceSchema.parse({ baseUrl: 'https://provider.example/v1' }) },
    hostOwnerId: callContext.hostOwnerId, purpose: 'inference', personalFetch: () => transport, beforeSubmit: submitted });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    await expect(client.generate({ request: { context: prompt } })).rejects.toBe(denied);
    expect(submitted).toHaveBeenCalledTimes(1); expect(transport).not.toHaveBeenCalled();
  } finally { await client.close(); }
});

it('preserves token quota denial through the actual TypeSafe SDK without retrying admission or transport', async () => {
  const denied = new AiCompletionQuotaError('synthetic token quota', 'user', 1), transport = vi.fn(async () => new Response());
  const submitted = vi.fn(() => { throw denied; });
  const fixture = driverFixture({ definition: typeSafeProvider, options: { baseUrl: 'https://provider.example' },
    model: { id: 'jev-local', kinds: ['decision'], protocol: 'typesafe-system-one' }, parameters: { maxRetries: 2 }, fetch: (url, init) => network(url, init) });
  const network: typeof globalThis.fetch = createProviderNetwork({ definition: typeSafeProvider, account: fixture.graph.accounts.account,
    service: { ...fixture.graph.services.service, options: typeSafeProvider.serviceSchema.parse({ baseUrl: 'https://provider.example' }) },
    hostOwnerId: callContext.hostOwnerId, purpose: 'inference', hostFetch: transport, beforeSubmit: submitted });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const profile = (await client.list({ kind: 'decision' }))[0].reference;
    await expect(client.evaluate({ profile, state: null, questions: { allowed: { type: 'noul' } } })).rejects.toBe(denied);
    expect(submitted).toHaveBeenCalledTimes(1); expect(transport).not.toHaveBeenCalled();
  } finally { await client.close(); }
});
