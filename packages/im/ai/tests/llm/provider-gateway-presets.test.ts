import { normalizeProviderGraph } from '../../src/provider/index.js';

it('keeps declared model facts without SDK, alias or model-name inference', () => {
  const graph = normalizeProviderGraph({ rootId: 'r', revision: 1,
    services: { s: { id: 's', rootId: 'r', ownerId: 'h', revision: 1,
      driver: { id: 'openai-compatible', owner: 'root', contractVersion: '1' }, options: { baseUrl: 'https://gateway.example/v1' },
      models: { 'gemini-looking-128k-thinking': { id: 'gemini-looking-128k-thinking', protocol: 'openai-chat', kinds: ['language'] } } } },
    accounts: {}, profiles: {}, purposes: { defaults: {} },
  });
  expect(graph.services.s.models['gemini-looking-128k-thinking']).toEqual({
    id: 'gemini-looking-128k-thinking', protocol: 'openai-chat', kinds: ['language'],
  });
});
it('retains an explicitly declared context window instead of a gateway preset', () => {
  const graph = normalizeProviderGraph({ rootId: 'r', revision: 1,
    services: { s: { id: 's', rootId: 'r', ownerId: 'h', revision: 1,
      driver: { id: 'openai-compatible', owner: 'root', contractVersion: '1' }, options: { baseUrl: 'https://opencode.ai/zen/v1' },
      models: { native: { id: 'native', protocol: 'openai-chat', kinds: ['language'], contextWindow: 16384 } } } },
    accounts: {}, profiles: {}, purposes: { defaults: {} },
  });
  expect(graph.services.s.models.native.contextWindow).toBe(16384);
});
