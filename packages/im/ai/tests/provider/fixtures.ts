import { normalizeProviderGraph } from '../../src/provider/graph.js';
import { defineProvider, type ProviderExecution, type ProviderDefinition } from '../../src/provider/driver.js';
import { createInferenceRuntime } from '../../src/provider/runtime.js';
import type { ProviderCallContext, ProviderGraph } from '../../src/provider/types.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '../../src/llm/types/agent-message.js';

export const HOST = 'host:test';
export const context: ProviderCallContext = { rootId: 'root', hostOwnerId: HOST, ownerId: HOST,
  operationId: 'operation', sessionKey: 'conversation', epoch: 'epoch' };
export function graphFixture(): ProviderGraph {
  const base = { rootId: 'root', revision: 1, ownerId: HOST };
  return normalizeProviderGraph({ rootId: 'root', revision: 1,
    services: { service: { ...base, id: 'service', driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' },
      options: {}, models: {
        text: { id: 'text', kinds: ['language'], protocol: 'fixture', streaming: true, toolCalling: true, input: ['text'] },
        decision: { id: 'decision', kinds: ['decision'], protocol: 'fixture' },
        image: { id: 'image', kinds: ['image'], protocol: 'fixture' },
      } } },
    accounts: { account: { ...base, id: 'account', serviceId: 'service', incarnation: 'first', authentication: { method: 'none' } } },
    profiles: Object.fromEntries(['text', 'decision', 'image'].map(id => [id,
      { ...base, id, accountId: 'account', model: id, parameters: {} }])),
    purposes: { defaults: { chat: 'text', image: 'image' }, decisions: { tools: { profile: 'decision', mode: 'active' } } },
  });
}
export function assistant(text = 'done'): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'fixture', provider: 'fixture', model: 'text',
    usage: structuredClone(EMPTY_TOKEN_USAGE), stopReason: 'stop', timestamp: 1 };
}
export function runtimeFixture(options: {
  graph?: ProviderGraph;
  execution?: ProviderExecution;
  definition?: ProviderDefinition<unknown, unknown>;
  canUseProfile?: Parameters<typeof createInferenceRuntime>[0]['canUseProfile'];
  onCleanupError?: Parameters<typeof createInferenceRuntime>[0]['onCleanupError'];
  release?: () => void | Promise<void>;
  resources?: Parameters<typeof createInferenceRuntime>[0]['resources'];
  generationIdentity?: object;
} = {}) {
  let graph = options.graph ?? graphFixture();
  const calls = { created: 0, released: 0, credentials: 0, network: 0 };
  const execution = options.execution ?? { language: {
    generate: async () => assistant(),
    stream: async () => (async function* () { yield { type: 'done' as const, message: assistant() }; })(),
  } };
  const definition = options.definition ?? defineProvider({ id: 'fixture', contractVersion: '1',
    serviceSchema: { parse: (value: unknown) => value }, authentication: { methods: ['none'] },
    targets: () => ({ authentication: [], inference: ['https://example.test/v1/'] }),
    models: service => service.models,
    createExecution: () => { calls.created++; return execution; },
  });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition,
      release: async () => { calls.released++; await options.release?.(); } }) },
    credentials: () => { calls.credentials++; return { bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ headers: {}, revision: '1' }) }; },
    fetch: () => async () => { calls.network++; throw new Error('network must not be called'); },
    canUseProfile: options.canUseProfile, onCleanupError: options.onCleanupError,
    resources: options.resources, generationIdentity: options.generationIdentity,
  });
  return { runtime, calls, setGraph(value: ProviderGraph) { graph = value; } };
}
