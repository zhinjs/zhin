/**
 * Five-Agent 契约测试（ADR 0024）：
 * - 角色 ACL：evaluator 零外部工具；reviewer 禁 web_search
 * - 转移门控：full 严格顺序；compact 允许 Planner 短路
 * - 模式探测：5 角色 → full；不齐 → compact
 * - Reviewer 记忆隔离：切片不含 evaluator blueprint
 * - 内置 prompt：nickname 渲染
 */
import { describe, it, expect } from 'vitest';
import {
  isToolAllowedForRole,
  filterToolNamesForRole,
} from '../../src/aop/pipeline/role-capability-policy.js';
import { detectPipelineProfile, cellHasFiveRoles } from '../../src/aop/pipeline/pipeline-mode.js';
import { FiveAgentPromptRegistry } from '../../src/builtin/five-agent/index.js';
import { resolvePipelineRoleBinding } from '../../src/config/resolve-pipeline-binding.js';
import type { CollaborationCell } from '../../src/collaboration/types.js';

const fullCell: CollaborationCell = {
  id: 'c', adapter: 'sandbox', sceneId: 'g',
  members: [
    { endpointId: 'p', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'r', primary: 'researcher', pipelineRole: 'researcher' },
    { endpointId: 'e', primary: 'evaluator', pipelineRole: 'evaluator' },
    { endpointId: 'x', primary: 'executor', pipelineRole: 'executor' },
    { endpointId: 'v', primary: 'reviewer', pipelineRole: 'reviewer' },
  ],
};

const compactCell: CollaborationCell = {
  id: 'c2', adapter: 'sandbox', sceneId: 'g2',
  members: [
    { endpointId: 'p', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'x', primary: 'executor', pipelineRole: 'executor' },
  ],
};

describe('role ACL', () => {
  it('evaluator has no external tools', () => {
    expect(isToolAllowedForRole('web_search', 'evaluator')).toBe(false);
    expect(isToolAllowedForRole('write_file', 'evaluator')).toBe(false);
    expect(isToolAllowedForRole('cell_submit_artifact', 'evaluator')).toBe(true);
  });

  it('reviewer cannot web_search or read source', () => {
    expect(isToolAllowedForRole('web_search', 'reviewer')).toBe(false);
    expect(isToolAllowedForRole('read_file', 'reviewer')).toBe(false);
    expect(isToolAllowedForRole('cell_read_artifact', 'reviewer')).toBe(true);
  });

  it('planner cannot write deliverables but can orchestrate', () => {
    expect(isToolAllowedForRole('write_file', 'planner')).toBe(false);
    expect(isToolAllowedForRole('orchestration_start', 'planner')).toBe(true);
    expect(isToolAllowedForRole('orchestration_add_task', 'planner')).toBe(true);
    expect(isToolAllowedForRole('spawn_task', 'planner')).toBe(true);
    expect(isToolAllowedForRole('group_delegate', 'planner')).toBe(false);
    expect(isToolAllowedForRole('cell_advance_stage', 'planner')).toBe(false);
  });

  it('filters tool name list by role', () => {
    const tools = ['web_search', 'cell_submit_artifact', 'write_file', 'cell_read_artifact'];
    expect(filterToolNamesForRole(tools, 'evaluator')).toEqual(['cell_submit_artifact', 'cell_read_artifact']);
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

describe('builtin prompts', () => {
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
  it('inherits zhin provider/model when pipeline omits', () => {
    const b = resolvePipelineRoleBinding('executor', { agents, pipeline: {} });
    expect(b.providerAlias).toBe('agnes');
    expect(b.model).toBe('flash');
    expect(b.nickname).toBe('Executor');
  });
  it('overrides provider/model and nickname per role', () => {
    const b = resolvePipelineRoleBinding('evaluator', {
      agents,
      pipeline: { evaluator: { provider: 'bigmodel', model: 'glm', nickname: '分析师' } },
    });
    expect(b.providerAlias).toBe('bigmodel');
    expect(b.model).toBe('glm');
    expect(b.nickname).toBe('分析师');
  });
  it('planner inherits zhin nickname', () => {
    const b = resolvePipelineRoleBinding('planner', { agents, pipeline: {} });
    expect(b.nickname).toBe('总监');
  });
});
