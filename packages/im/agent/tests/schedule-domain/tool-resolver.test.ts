import type { AgentTool } from '@zhin.js/ai';
import { describe, expect, it } from 'vitest';
import { resolveScheduleTools } from '../../src/schedule-domain/tool-resolver.js';

function tool(name: string, description: string, keywords: string[] = []): AgentTool {
  return {
    name,
    description,
    keywords,
    parameters: { type: 'object', properties: {} },
    execute: async () => name,
  };
}

describe('resolveScheduleTools', () => {
  const pool = [
    tool('weather_lookup', '查询城市天气预报', ['天气', '预报']),
    tool('send_report', '发送日报', ['日报']),
    tool('discover', '发现工具'),
    tool('ask_user', '询问用户'),
  ];

  it('uses a confirmed execution plan as the authoritative selection', () => {
    const result = resolveScheduleTools({
      prompt: '查询天气并发送',
      executionPlan: { prompt: '查询天气并发送', tools: ['send_report', 'missing'] },
      tools: pool,
      skillRegistry: null,
    });

    expect(result.resolvedBy).toBe('execution-plan');
    expect(result.tools.map(item => item.name)).toEqual(['send_report']);
    expect(result.missingTools).toEqual(['missing']);
  });

  it('loads affinity matches and never exposes unattended meta tools', () => {
    const result = resolveScheduleTools({
      prompt: '每天查询天气预报',
      tools: pool,
      skillRegistry: null,
    });

    expect(result.resolvedBy).toBe('affinity');
    expect(result.tools.map(item => item.name)).toContain('weather_lookup');
    expect(result.tools.map(item => item.name)).not.toContain('discover');
    expect(result.tools.map(item => item.name)).not.toContain('ask_user');
  });
});
