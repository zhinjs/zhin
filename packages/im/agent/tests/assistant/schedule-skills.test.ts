import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { rehydrateTurnActiveSkills } from '../../src/assistant/schedule-skills.js';
import { getTurnActiveSkillsFromContext, runInTurnContext } from '../../src/internal/turn-context.js';
import { TurnTracker } from '../../src/turn/turn-tracker.js';
import type { ZhinAgentPrivate } from '../../src/internal/agent-host.js';
import * as loadSkillTool from '../../src/builtin/load-skill-tool.js';
import * as skillLoadOpts from '../../src/skill/skill-load-opts.js';

beforeEach(() => {
  vi.spyOn(loadSkillTool, 'readSkillInstructions').mockImplementation(
    async (name: string) => `# Skill ${name}\nInstructions.`,
  );
  vi.spyOn(skillLoadOpts, 'buildSkillLoadOptsForAgent').mockReturnValue({
    skillDirList: () => [],
    skillMaxChars: 8000,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
