import { describe, expect, it, vi } from 'vitest';
import { rehydrateTurnActiveSkills } from '../../src/assistant/schedule-skills.js';
import { getTurnActiveSkillsFromContext, runInTurnContext } from '../../src/zhin-agent/turn-context.js';
import { TurnTracker } from '../../src/zhin-agent/turn-tracker.js';
import type { ZhinAgentPrivate } from '../../src/zhin-agent/zhin-agent-private.js';

vi.mock('../../src/builtin/load-skill-tool.js', () => ({
  readSkillInstructions: vi.fn(async (name: string) => `# Skill ${name}\nInstructions.`),
}));

vi.mock('../../src/zhin-agent/skill-load-opts.js', () => ({
  buildSkillLoadOptsForAgent: vi.fn(() => ({
    skillDirList: () => [],
    skillMaxChars: 8000,
  })),
}));

function mockAgent(): ZhinAgentPrivate {
  return {
    config: { chatModel: 'gpt-4o-mini' },
    getTurnProvider: () => ({ models: ['gpt-4o-mini'], name: 'openai' }),
    skillRegistry: {
      getByName: vi.fn((name: string) => ({ name, description: name, tools: [] })),
    },
    contextRepository: {
      getDeferredToolSnapshot: vi.fn(async () => ({
        loadedTools: {},
        loadedSkills: ['weather'],
      })),
    },
  } as unknown as ZhinAgentPrivate;
}

describe('rehydrateTurnActiveSkills', () => {
  it('writes baseline plus snapshot skills into turn ALS', async () => {
    const tracker = new TurnTracker();
    const host = mockAgent();

    await runInTurnContext('t1', tracker, async () => {
      await rehydrateTurnActiveSkills(host, 'session-1', 'always baseline');
      expect(getTurnActiveSkillsFromContext()).toContain('always baseline');
      expect(getTurnActiveSkillsFromContext()).toContain('# Skill weather');
    });
  });
});
