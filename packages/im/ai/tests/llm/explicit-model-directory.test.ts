import { anthropicProvider, openAiCompatibleProvider, openAiProvider } from '../../src/providers/api-key.js';
import { driverFixture, callContext, chatReply, prompt } from '../providers/fixtures.js';

it.each([anthropicProvider, openAiProvider])('$id has no implicit native-model preset when the Service directory is empty', definition => {
  const service = { id: 's', rootId: 'r', ownerId: 'h', revision: 1, driver: { id: definition.id, owner: 'root', contractVersion: '1' }, options: definition.serviceSchema.parse({}), models: {} };
  expect(definition.models(service)).toEqual({});
});
it('lists only the explicitly configured Profile without querying the network or acquiring credentials', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://gateway.example/v1' }, model: { id: 'custom-native', protocol: 'openai-chat', kinds: ['language'] }, fetch });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try { expect((await client.list({ kind: 'language' })).map(item => item.model)).toEqual(['custom-native']); expect(fetch).not.toHaveBeenCalled(); expect(fixture.authorize).not.toHaveBeenCalled(); }
  finally { await client.close(); }
});
it('uses the exact explicit model rather than substituting the first known vendor model', async () => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: anthropicProvider, model: { id: 'custom-native', protocol: 'anthropic-messages', kinds: ['language'] }, parameters: { maxRetries: 0 },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return Response.json({ id: 'msg', type: 'message', role: 'assistant', model: 'custom-native', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }); } });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try { await client.generate({ request: { context: prompt } }); expect((await requests[0].json()).model).toBe('custom-native'); }
  finally { await client.close(); }
});
it('supports an unfamiliar explicitly declared gateway model without core brand or model-id registration', async () => {
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://gateway.example/v1' }, model: { id: 'unfamiliar/native-id', kinds: ['language'], protocol: 'openai-chat' }, parameters: { maxRetries: 0 }, fetch: async () => chatReply() });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try { expect((await client.generate({ request: { context: prompt } })).content).toEqual([{ type: 'text', text: 'synthetic answer' }]); }
  finally { await client.close(); }
});
