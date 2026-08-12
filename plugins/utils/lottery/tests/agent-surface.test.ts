import { describe, it, expect } from 'vitest';
import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { buildDailyPipelinePrompt } from '../src/agent/prompts.js';

describe('lottery agent/ surface', () => {
  it('does not hard-code a runtime instanceKey into prompts', () => {
    const prompt = buildDailyPipelinePrompt({ games: ['ssq'] });
    expect(prompt).toContain('synchronize draws');
    expect(prompt).not.toMatch(/lottery_{1,2}/u);
  });

  it('defineTool accepts zod schema', () => {
    const tool = defineTool({
      description: 'sync',
      inputSchema: z.object({ game: z.string().optional() }),
      async execute() { return 'ok'; },
    });
    expect(tool.description).toBe('sync');
  });
});
