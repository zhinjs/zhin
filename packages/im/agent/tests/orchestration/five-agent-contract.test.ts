/**
 * Five-Agent 契约测试（ADR 0024，legacy pipeline tools removed ADR 0026/0027）：
 * - 角色 ACL
 * - 内置 opt-in prompt：nickname 渲染
 */
import { describe, it, expect } from 'vitest';
import {
  isToolAllowedForRole,
  filterToolNamesForRole,
} from '../../src/orchestration/five-agent/role-capability-policy.js';
import { FiveAgentPromptRegistry } from '../../src/orchestration/five-agent/index.js';
import { resolveFiveAgentRoleBinding } from '../../src/config/resolve-five-agent-binding.js';

describe('role ACL', () => {
  it('evaluator has no external write or web tools', () => {
    expect(isToolAllowedForRole('web_search', 'evaluator')).toBe(false);
    expect(isToolAllowedForRole('write_file', 'evaluator')).toBe(false);
    expect(isToolAllowedForRole('read_file', 'evaluator')).toBe(true);
  });

  it('reviewer cannot web_search or write', () => {
    expect(isToolAllowedForRole('web_search', 'reviewer')).toBe(false);
    expect(isToolAllowedForRole('read_file', 'reviewer')).toBe(true);
    expect(isToolAllowedForRole('write_file', 'reviewer')).toBe(false);
  });

  it('planner cannot write deliverables but can orchestrate', () => {
    expect(isToolAllowedForRole('write_file', 'planner')).toBe(false);
    expect(isToolAllowedForRole('workroom_create_run', 'planner')).toBe(false);
    expect(isToolAllowedForRole('workroom_transition', 'planner')).toBe(false);
    expect(isToolAllowedForRole('ask_user', 'planner')).toBe(true);
    expect(isToolAllowedForRole('group_delegate', 'planner')).toBe(false);
  });

  it('filters tool name list by role', () => {
    const tools = ['web_search', 'read_file', 'write_file', 'grep'];
    expect(filterToolNamesForRole(tools, 'evaluator')).toEqual(['read_file', 'grep']);
  });
});

describe('builtin prompts (opt-in WorkflowStrategy)', () => {
  it('renders nickname into planner prompt', () => {
    const p = FiveAgentPromptRegistry.render({ role: 'planner', nickname: '总监' });
    expect(p).toContain('总监');
    expect(p).toContain('Planner');
  });
  it('falls back to role label when nickname missing', () => {
    const p = FiveAgentPromptRegistry.render({ role: 'researcher' });
    expect(p).toContain('Researcher');
  });
});

describe('pipeline role binding', () => {
  const agents = { zhin: { nickname: '总监', mcpServers: ['facts'], permission: { level: 'user' } } };
  it('inherits role capabilities while model selection stays in runtime purposes', () => {
    const b = resolveFiveAgentRoleBinding('executor', { agents });
    expect(b.mcpServers).toEqual(['facts']);
    expect(b).not.toHaveProperty('providerAlias');
    expect(b).not.toHaveProperty('model');
    expect(b.nickname).toBe('Executor');
  });
  it('uses ai.agents.<role> override', () => {
    const b = resolveFiveAgentRoleBinding('evaluator', {
      agents: {
        ...agents,
        evaluator: { mcpServers: ['review'], nickname: '分析师' },
      },
    });
    expect(b.mcpServers).toEqual(['review']);
    expect(b.nickname).toBe('分析师');
  });
  it('planner inherits zhin nickname', () => {
    const b = resolveFiveAgentRoleBinding('planner', { agents });
    expect(b.nickname).toBe('总监');
  });
});
