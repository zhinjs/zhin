import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { preloadScheduleTools } from '../../src/assistant/schedule-tool-runtime.js';
import type { ZhinAgentPrivate } from '../../src/internal/agent-host.js';

function mockTool(name: string): AgentTool {
  return { name, description: name, execute: async () => 'ok' };
}

function mockAgent(overrides: Partial<ZhinAgentPrivate> = {}): ZhinAgentPrivate {
  return {
    config: { deferredTools: {} },
    contextRepository: {
      getDeferredToolSnapshot: vi.fn(async () => ({ loadedTools: {}, loadedSkills: [] })),
      setDeferredToolSnapshot: vi.fn(async () => {}),
    },
    skillRegistry: {
      getByName: vi.fn((name: string) => ({
        name,
        description: name,
        tools: [{ name: `${name}_tool`, description: 't', execute: async () => 'ok' }],
      })),
      getAlwaysSkills: vi.fn(() => []),
    } as any,
    ...overrides,
  } as unknown as ZhinAgentPrivate;
}

describe('preloadScheduleTools', () => {
  it('unlocks skill tools and explicit tools in deferred snapshot', async () => {
    const agent = mockAgent();
    const catalog = [
      { name: 'weather_tool', brief: 'w', fullTool: mockTool('weather_tool'), source: 'skill' as const, deferDefault: true },
      { name: 'web_search', brief: 's', fullTool: mockTool('web_search'), source: 'builtin' as const, deferDefault: true },
    ];

    const snapshot = await preloadScheduleTools(
      agent,
      'session-1',
      { prompt: 'p', skills: ['weather'], tools: ['web_search'] },
      catalog,
      { loadedTools: {}, loadedSkills: [] },
    );

    expect(snapshot.loadedSkills).toContain('weather');
    expect(Object.keys(snapshot.loadedTools)).toEqual(
      expect.arrayContaining(['weather_tool', 'web_search']),
    );
    expect(agent.contextRepository.setDeferredToolSnapshot).toHaveBeenCalled();
  });
});
