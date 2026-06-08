import { describe, expect, it } from 'vitest';
import type { AgentMeta } from '../src/discovery/agents.js';
import {
  resolveSubagentContextMode,
  resolveSubagentRole,
} from '../src/subagent-preset.js';

function meta(partial: Partial<AgentMeta> & Pick<AgentMeta, 'name' | 'description' | 'filePath'>): AgentMeta {
  return partial as AgentMeta;
}

describe('subagent-preset', () => {
  it('frontmatter role 优先于预设名推断', () => {
    const m = meta({
      name: 'custom',
      description: 'x',
      filePath: '/tmp/x.agent.md',
      role: 'planner',
    });
    expect(resolveSubagentRole(m, 'reviewer')).toBe('planner');
  });

  it('reviewer 预设名推断为 reviewer 角色', () => {
    expect(resolveSubagentRole(null, 'reviewer')).toBe('reviewer');
  });

  it('reviewer 默认 contextMode 为 fresh', () => {
    expect(resolveSubagentContextMode(null, 'reviewer')).toBe('fresh');
  });

  it('subtask 默认 contextMode 为 fork', () => {
    expect(resolveSubagentContextMode(null, 'subtask')).toBe('fork');
  });

  it('显式 contextMode 覆盖角色默认', () => {
    expect(resolveSubagentContextMode(null, 'reviewer', 'fork')).toBe('fork');
  });
});
