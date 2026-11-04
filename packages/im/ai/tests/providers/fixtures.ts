import { createInferenceRuntime } from '../../src/provider/runtime.js';
import { normalizeProviderGraph } from '../../src/provider/graph.js';
import type { CredentialGrant, ProviderDefinition } from '../../src/provider/driver.js';
import type { JsonObject, ModelDefinition } from '../../src/provider/types.js';

export const callContext = { rootId: 'root', hostOwnerId: 'host:test', ownerId: 'host:test', operationId: 'operation', sessionKey: 'session', epoch: 'epoch' };
export function driverFixture(input: {
  definition: ProviderDefinition<unknown, unknown>;
  model: ModelDefinition;
  options?: JsonObject;
  parameters?: JsonObject;
  grant?: CredentialGrant;
  fetch: typeof globalThis.fetch;
}) {
  const base = { rootId: 'root', revision: 1, ownerId: 'host:test' };
  const service = { ...base, id: 'service', driver: { id: input.definition.id, owner: 'root/providers', contractVersion: input.definition.contractVersion },
    options: input.options ?? {}, models: { [input.model.id]: input.model } };
  const graph = normalizeProviderGraph({ rootId: 'root', revision: 1, services: { service },
    accounts: { account: { ...base, id: 'account', serviceId: 'service', incarnation: 'first', authentication: { method: input.definition.authentication.methods[0]! } } },
    profiles: { selected: { ...base, id: 'selected', accountId: 'account', model: input.model.id, parameters: input.parameters ?? {} } },
    purposes: { defaults: { ...(input.model.kinds.includes('language') ? { chat: 'selected' } : {}), ...(input.model.kinds.includes('image') ? { image: 'selected' } : {}) }, decisions: {} },
  });
  const authorize = vi.fn(async () => input.grant ?? { token: 'synthetic-key', headers: {}, revision: '1' });
  const bindRequest = vi.fn((input: { grant: CredentialGrant; request: Request }) => input.request);
  let currentGraph = graph;
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => currentGraph },
    drivers: { acquire: async () => ({ reference: service.driver, definition: input.definition, release() {} }) },
    credentials: () => ({ bindRequest, authorize }), fetch: () => input.fetch,
  });
  return { runtime, authorize, bindRequest, graph, replaceGraph(next: typeof graph) { currentGraph = normalizeProviderGraph(next); } };
}

export function chatReply(text = 'synthetic answer') {
  return Response.json({ id: 'chatcmpl-local', object: 'chat.completion', created: 1, model: 'configured-model',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  });
}

export function sse(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

export const prompt = { systemPrompt: 'System rule', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }], timestamp: 1 }] };
