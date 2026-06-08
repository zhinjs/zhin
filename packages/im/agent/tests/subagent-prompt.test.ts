import { describe, expect, it } from 'vitest';
import { AgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';
import { buildSubagentRolePrompt, sanitizeSubagentSystemPrompt } from '../src/subagent-prompt.js';

describe('subagent-prompt', () => {
  it('净化编排工具名', () => {
    const out = sanitizeSubagentSystemPrompt('Use spawn_task and tool_search for orchestration.');
    expect(out).not.toContain('spawn_task');
    expect(out).not.toContain('tool_search');
  });

  it('reviewer buildRolePrompt 不含 spawn 段落', () => {
    const dispatcher = new AgentDispatcher();
    const task = dispatcher.createTask({
      name: 'review',
      description: 'review code',
      role: 'reviewer',
      goal: 'review code',
      priority: 'medium',
    });
    const prompt = buildSubagentRolePrompt(dispatcher, 'reviewer', task);
    expect(prompt).toContain('reviewer');
    expect(prompt.toLowerCase()).toContain('spawn sub-agents: no');
    expect(prompt).not.toMatch(/\bspawn_task\b/i);
  });
});
