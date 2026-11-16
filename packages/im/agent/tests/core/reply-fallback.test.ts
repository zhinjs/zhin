/** #1250 b33: the empty-reply fallback states the actual cause; tool names are inline code. */
import { describe, expect, it } from 'vitest';
import {
  describeToolCallsForUser,
  formatReplyFallback,
  formatToolCallsForUser,
  inlineToolName,
} from '../../src/core/tool-calls-user-format.js';
import { formatUnexecutedToolResult } from '../../src/core/unexecuted-tool-notice.js';
import { sanitizeAssistantReplyDetailed } from '../../src/core/text-sanitize.js';

const WEATHER = 'api60s__skill__60s-life__weather';

describe('reply fallback (#1250 b33)', () => {
  it('keeps the interactive empty-reply text when nothing else is known', () => {
    expect(formatToolCallsForUser([])).toBe('模型未返回可见内容（可能为推理型模型空回复或上下文过长）。可发送 /reset 后重试，或换用非推理模型。');
  });

  it('names "no tools" for a scheduled job, with its name, id and trace, and no /reset', () => {
    const text = formatReplyFallback({ cause: 'no_tools' },
      { schedule: { jobId: 'sched_1', label: '天气早报', turnId: 'turn-9' } });
    expect(text).toContain('定时任务 「天气早报」（sched_1）');
    expect(text).toContain('没有可用的工具');
    expect(text).toContain('zhin trace turn-9');
    expect(text).not.toContain('/reset');
    expect(text).not.toContain('推理型模型');
  });

  it('names the denied tool in inline code instead of dumping the denial text', () => {
    const described = describeToolCallsForUser([
      { tool: WEATHER, result: '未执行（NOT EXECUTED）：工具 x 被拒绝', status: 'denied', sideEffect: false },
    ]);
    expect(described.fallback).toEqual({ cause: 'tool_denied', tools: [WEATHER] });
    expect(described.text).toContain(`\`${WEATHER}\``);
    expect(described.text).not.toContain('NOT EXECUTED');
  });

  it('reports "model returned empty" for a scheduled job that had tools', () => {
    const described = describeToolCallsForUser([], { toolsAvailable: true, schedule: { jobId: 'j' } });
    expect(described.fallback).toEqual({ cause: 'empty_reply' });
    expect(described.text).toContain('模型未返回可见内容');
    expect(described.text).not.toContain('/reset');
  });

  it('does not call real tool output a fallback', () => {
    expect(describeToolCallsForUser([{ tool: 'weather', result: '上海 晴 25°C', status: 'completed' }]).fallback).toBeUndefined();
  });

  it('tells model text from the summary fallback', () => {
    expect(sanitizeAssistantReplyDetailed('上海晴', { toolSummary: 'x' }).source).toBe('model');
    expect(sanitizeAssistantReplyDetailed('', { toolSummary: 'x' }).source).toBe('summary');
    expect(sanitizeAssistantReplyDetailed('', {}).source).toBe('empty');
  });
});

describe('unexecuted tool names (#1250 b33)', () => {
  it('renders the tool name as inline code so Markdown cannot eat `__`', () => {
    expect(inlineToolName(WEATHER)).toBe(`\`${WEATHER}\``);
    expect(inlineToolName('a`b')).toBe('``a`b``');
    const text = formatUnexecutedToolResult(WEATHER, 'denied', 'unattended', false);
    expect(text).toContain(`工具 \`${WEATHER}\` 被拒绝`);
    expect(text).not.toContain(`「${WEATHER}」`);
  });
});
