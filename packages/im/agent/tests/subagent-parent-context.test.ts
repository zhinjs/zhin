import { describe, expect, it } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import { buildParentContextPreamble } from '../src/subagent-parent-context.js';

describe('buildParentContextPreamble', () => {
  it('包含 user/assistant 消息并过滤编排 tool 结果', () => {
    const messages = [
      createUserMessage('帮我审查 subagent.ts'),
      {
        role: 'toolResult' as const,
        toolCallId: '1',
        toolName: 'spawn_task',
        content: [{ type: 'text' as const, text: '子任务已启动' }],
        isError: false,
        timestamp: 1,
      },
      {
        role: 'toolResult' as const,
        toolCallId: '2',
        toolName: 'read_file',
        content: [{ type: 'text' as const, text: 'file contents here' }],
        isError: false,
        timestamp: 2,
      },
    ];
    const preamble = buildParentContextPreamble(messages);
    expect(preamble).toContain('User: 帮我审查 subagent.ts');
    expect(preamble).toContain('Tool(read_file)');
    expect(preamble).not.toContain('spawn_task');
    expect(preamble).not.toContain('子任务已启动');
  });
});
