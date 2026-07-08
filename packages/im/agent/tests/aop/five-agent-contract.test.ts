/**
 * Five-Agent 契约测试（ADR 0024，legacy pipeline tools removed ADR 0026/0027）：
 * - 角色 ACL（subagent spawn_task 路径）
 * - 模式探测：5 角色 → full；不齐 → compact
 * - 内置 opt-in prompt：nickname 渲染
 */
import { describe, it, expect } from 'vitest';
import {
  isToolAllowedForRole,
  filterToolNamesForRole,
} from '../../src/aop/pipeline/role-capability-policy.js';
import { detectPipelineProfile, cellHasFiveRoles } from '../../src/aop/pipeline/pipeline-mode.js';
import { FiveAgentPromptRegistry } from '../../src/builtin/five-agent/index.js';
import { resolvePipelineRoleBinding } from '../../src/config/resolve-pipeline-binding.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const fullCell: CollaborationScene = {
  id: 'c', adapter: 'sandbox', sceneId: 'g',
  members: [
    { endpointId: 'p', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'r', primary: 'researcher', pipelineRole: 'researcher' },
    { endpointId: 'e', primary: 'evaluator', pipelineRole: 'evaluator' },
    { endpointId: 'x', primary: 'executor', pipelineRole: 'executor' },
    { endpointId: 'v', primary: 'reviewer', pipelineRole: 'reviewer' },
  ],
};

const compactCell: CollaborationScene = {
  id: 'c2', adapter: 'sandbox', sceneId: 'g2',
  members: [
    { endpointId: 'p', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'x', primary: 'executor', pipelineRole: 'executor' },
  ],
};

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
    expect(isToolAllowedForRole('orchestration_start', 'planner')).toBe(true);
    expect(isToolAllowedForRole('orchestration_add_task', 'planner')).toBe(true);
    expect(isToolAllowedForRole('spawn_task', 'planner')).toBe(true);
    expect(isToolAllowedForRole('group_delegate', 'planner')).toBe(false);
  });

  it('filters tool name list by role', () => {
    const tools = ['web_search', 'read_file', 'write_file', 'grep'];
    expect(filterToolNamesForRole(tools, 'evaluator')).toEqual(['read_file', 'grep']);
  });
});

describe('mode detection', () => {
  it('full when 5 roles present', () => {
    expect(cellHasFiveRoles(fullCell)).toBe(true);
    expect(detectPipelineProfile(fullCell)).toBe('full');
  });
  it('compact otherwise', () => {
    expect(cellHasFiveRoles(compactCell)).toBe(false);
    expect(detectPipelineProfile(compactCell)).toBe('compact');
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
  const agents = { zhin: { provider: 'agnes', model: 'flash', nickname: '总监' } };
  it('inherits zhin provider/model when role agent omits', () => {
    const b = resolvePipelineRoleBinding('executor', { agents });
    expect(b.providerAlias).toBe('agnes');
    expect(b.model).toBe('flash');
    expect(b.nickname).toBe('Executor');
  });
  it('uses ai.agents.<role> override', () => {
    const b = resolvePipelineRoleBinding('evaluator', {
      agents: {
        ...agents,
        evaluator: { provider: 'bigmodel', model: 'glm', nickname: '分析师' },
      },
    });
    expect(b.providerAlias).toBe('bigmodel');
    expect(b.model).toBe('glm');
    expect(b.nickname).toBe('分析师');
  });
  it('planner inherits zhin nickname', () => {
    const b = resolvePipelineRoleBinding('planner', { agents });
    expect(b.nickname).toBe('总监');
  });
});
