import { describe, expect, it } from 'vitest';
import {
  buildScheduleTurnPrompt,
  parseExecutionPlanFromArgs,
  parseScheduleJobExecutionPlan,
} from '../../src/assistant/schedule-execution.js';

describe('schedule execution plan', () => {
  it('buildScheduleTurnPrompt preview mode wraps task without time context', () => {
    const out = buildScheduleTurnPrompt({ basePrompt: 'daily weather', mode: 'preview' });
    expect(out).toContain('预演');
    expect(out).toContain('daily weather');
    expect(out).not.toContain('星期');
  });

  it('buildScheduleTurnPrompt scheduled mode adds time context', () => {
    const out = buildScheduleTurnPrompt({ basePrompt: 'daily weather', mode: 'scheduled' });
    expect(out).toContain('定时任务');
    expect(out).toContain('daily weather');
    expect(out).toMatch(/星期[一二三四五六日]/);
  });

  it('parseExecutionPlanFromArgs reads execution_plan object', () => {
    expect(
      parseExecutionPlanFromArgs(
        {
          execution_plan: {
            prompt: 'refined',
            tools: ['a', 'b'],
            skills: ['s1'],
          },
        },
        'fallback',
      ),
    ).toEqual({
      prompt: 'refined',
      tools: ['a', 'b'],
      skills: ['s1'],
      previewSample: undefined,
      previewedAt: undefined,
      confirmed: false,
    });
  });

  it('parseExecutionPlanFromArgs reads refined_prompt + tools/skills strings', () => {
    expect(
      parseExecutionPlanFromArgs(
        { refined_prompt: 'refined', tools: 'a,b', skills: 's1 s2' },
        'fallback',
      ),
    ).toEqual({
      prompt: 'refined',
      tools: ['a', 'b'],
      skills: ['s1', 's2'],
    });
  });

  it('parseScheduleJobExecutionPlan normalizes persisted payload', () => {
    expect(
      parseScheduleJobExecutionPlan({
        prompt: 'p',
        tools: ['t1'],
        skills: ['s1'],
        confirmed: true,
      }),
    ).toEqual({
      prompt: 'p',
      tools: ['t1'],
      skills: ['s1'],
      previewSample: undefined,
      previewedAt: undefined,
      confirmed: true,
    });
  });
});
