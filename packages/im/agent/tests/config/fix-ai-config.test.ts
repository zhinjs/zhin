import { applyAiConfigFixes } from '../../src/config/fix-ai-config.js';
import { validateModelRuntimeConfig } from '../../src/model-runtime/validation.js';

it('preserves all old model and credential source facts for explicit migration rather than producing another old configuration', () => {
  const source = { defaultProvider: 'main', providers: { main: { driver: 'openai', apiKey: 'synthetic-secret' } }, agents: { zhin: { provider: 'main', model: 'native' } }, agent: { chatModel: 'native', execPreset: 'readonly' } };
  const result = applyAiConfigFixes(source);
  expect(result.ai).toEqual(source); expect(result.fixes).toEqual([]);
  expect(validateModelRuntimeConfig(result.ai, 'host').join(' ')).toContain('migration required');
  expect(source.providers.main.driver).toBe('openai');
});

it('removes only retired role switches while preserving MCP, authority metadata and the selected source', () => {
  const { ai, fixes } = applyAiConfigFixes({ agents: { zhin: { provider: 'p', model: 'm', priority: 1, match: {} }, planner: { nickname: 'Planner', permission: { task: 'deny' }, mcpServers: ['mcp'], match: [] } } });
  expect(ai?.agents).toEqual({ zhin: { provider: 'p', model: 'm' }, planner: { nickname: 'Planner', permission: { task: 'deny' }, mcpServers: ['mcp'] } });
  expect(fixes).toEqual(['removed deprecated ai.agents.zhin.priority', 'removed deprecated ai.agents.zhin.match', 'removed deprecated ai.agents.planner.match']);
});

it('keeps unrelated Agent and context settings while applying the existing deprecated-key rename', () => {
  const { ai, fixes } = applyAiConfigFixes({ agent: { maxSkills: 3, maxIterations: 10 }, context: { maxMessagesBeforeSummary: 50 } });
  expect(ai).toEqual({ agent: { maxIterations: 10 }, context: { summaryThreshold: 50 } });
  expect(fixes).toContain('renamed ai.context.maxMessagesBeforeSummary to summaryThreshold');
});
