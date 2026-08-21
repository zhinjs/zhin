import { describe, expect, it } from 'vitest';
import { sanitizeSubagentSystemPrompt } from '../src/subagent-prompt.js';

describe('subagent-prompt', () => {
  it('净化编排工具名', () => {
    const out = sanitizeSubagentSystemPrompt('Use spawn_task and tool_search for orchestration.');
    expect(out).not.toContain('spawn_task');
    expect(out).not.toContain('tool_search');
  });
});
