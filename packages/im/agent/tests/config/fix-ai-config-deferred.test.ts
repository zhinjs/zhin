import { describe, it, expect } from 'vitest';
import { applyAiConfigFixes } from '../../src/config/fix-ai-config.js';

describe('fix-ai-config deferred migration', () => {
  it('migrates orchestratorTools to deferredTools.alwaysLoadedTools', () => {
    const { ai, fixes } = applyAiConfigFixes({
      providers: { openai: { sdk: 'openai', apiKey: 'x' } },
      agents: { zhin: { provider: 'openai', model: 'gpt-4o-mini' } },
      agent: {
        orchestratorTools: ['ask_user', 'activate_skill', 'tool_search'],
      },
    });
    const agent = ai?.agent as Record<string, unknown>;
    expect(agent.orchestratorTools).toBeUndefined();
    const dt = agent.deferredTools as { alwaysLoadedTools: string[] };
    expect(dt.alwaysLoadedTools).toContain('ask_user');
    expect(dt.alwaysLoadedTools).toContain('load_skill');
    expect(dt.alwaysLoadedTools).not.toContain('tool_search');
    expect(fixes.some(f => f.includes('deferredTools'))).toBe(true);
  });
});
