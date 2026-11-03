import { createUserMessage } from '../../src/llm/types/agent-message.js';
import { normalizeProviderGraph } from '../../src/provider/graph.js';
import { graphFixture, runtimeFixture, context } from './fixtures.js';

const prompt = { systemPrompt: '', messages: [createUserMessage('synthetic')] };
const tools = [{ name: 'synthetic_tool', description: 'synthetic', parameters: { type: 'object' as const, properties: {} } }];

it.each([false, undefined])('rejects tools when toolCalling=%j for plain generation and streams before driver credentials/HTTP', async toolCalling => {
  const original = graphFixture();
  const graph = normalizeProviderGraph({ ...original, services: { service: { ...original.services.service,
    models: { ...original.services.service.models, text: { ...original.services.service.models.text, toolCalling } } } } });
  const f = runtimeFixture({ graph }); const client = await f.runtime.openOperation({ context });
  await expect(client.generate({ request: { context: { ...prompt, tools } } })).rejects.toThrow('unsupported-capability');
  await expect(client.stream({ request: { context: { ...prompt, tools } } })).rejects.toThrow('unsupported-capability');
  expect(f.calls.created).toBe(0); expect(f.calls.released).toBe(0);
  expect(f.calls.credentials).toBe(0); expect(f.calls.network).toBe(0); await client.close();
});

it('accepts declared tools but rejects undeclared thinking and native user/tool-result media at the same request boundary', async () => {
  const f = runtimeFixture(); const client = await f.runtime.openOperation({ context });
  await client.generate({ request: { context: { ...prompt, tools } } });
  expect(f.calls.created).toBe(1);
  await expect(client.generate({ request: { context: prompt, options: { thinkingLevel: 'high' } } })).rejects.toThrow('unsupported-capability');
  const media = { type: 'image' as const, data: { media: { kind: 'base64' as const, value: 'AA==' } } };
  await expect(client.generate({ request: { context: { ...prompt, messages: [createUserMessage('image', [media])] } } })).rejects.toThrow('unsupported-capability');
  await expect(client.generate({ request: { context: { ...prompt, messages: [{ role: 'toolResult', toolCallId: 'one', toolName: 'tool',
    content: [media], isError: false, timestamp: 1 }] } } })).rejects.toThrow('unsupported-capability');
  expect(f.calls.created).toBe(1); await client.close();
});

it('validates the actual stored model descriptor against the held Driver before private credentials', async () => {
  let credentials = 0, executions = 0;
  const { createInferenceRuntime } = await import('../../src/provider/runtime.js');
  const { defineProvider } = await import('../../src/provider/driver.js');
  const graph = graphFixture();
  const definition = defineProvider({ id: 'fixture', contractVersion: '1', serviceSchema: { parse: (input: unknown) => input },
    authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: [] }),
    models: service => ({ ...service.models, text: { ...service.models.text, protocol: 'different-contract' } }),
    createExecution: () => { executions++; return {}; },
  });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition, release: () => undefined }) },
    credentials: () => { credentials++; return { bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ headers: {}, revision: 'one' }) }; },
    fetch: () => async () => { throw new Error('Unexpected HTTP'); } });
  const client = await runtime.openOperation({ context });
  await expect(client.generate({ request: { context: prompt } })).rejects.toThrow('driver-contract-mismatch');
  expect(credentials).toBe(0); expect(executions).toBe(0); await client.close();
});
