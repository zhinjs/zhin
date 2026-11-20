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
    expect(formatToolCallsForUser([])).toBe('模型未返回可见内容（可能为推理型模型空回复或上下文过长）。可发送 /clear 清空本会话上下文后重试，或换用非推理模型。');
  });

  it('names "no tools" for a scheduled job, with its name, id and trace, and no /reset', () => {
    const text = formatReplyFallback({ cause: 'no_tools' },
      { schedule: { jobId: 'sched_1', label: '天气早报', turnId: 'turn-9' } });
    expect(text).toContain('定时任务 「天气早报」（sched_1）');
    expect(text).toContain('没有可用的工具');
    expect(text).toContain('zhin trace turn-9');
    expect(text).not.toContain('/reset');
    expect(text).not.toContain('/clear');
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
    expect(described.text).not.toContain('/clear');
  });

  it('does not call real tool output a fallback', () => {
    expect(describeToolCallsForUser([{ tool: 'weather', result: '上海 晴 25°C', status: 'completed' }]).fallback).toBeUndefined();
  });

  it('writes every fallback in English for an English recipient, keeping `/clear` literal (#1250)', () => {
    const cjk = /[\u4e00-\u9fff]/u;
    const empty = formatToolCallsForUser([], { locale: 'en' });
    expect(empty).toBe('The model returned no visible content (a reasoning model may have replied empty, or the context is too long). '
      + 'Send /clear to clear this conversation\'s context and try again, or switch to a non-reasoning model.');
    const denied = describeToolCallsForUser([{ tool: WEATHER, result: 'x', status: 'denied' }], { locale: 'en' }).text;
    expect(denied).toBe(`The required tools \`${WEATHER}\` were denied and did not run, so the request could not be completed. `
      + 'Try again after someone with permission approves it.');
    expect(formatReplyFallback({ cause: 'no_tools' }, { locale: 'en' })).toContain('No tools were available');
    const scheduled = formatReplyFallback({ cause: 'no_tools' },
      { locale: 'en', schedule: { jobId: 'sched_1', label: 'Weather', turnId: 'turn-9' } });
    expect(scheduled).toBe('Scheduled job "Weather" (sched_1) did not finish: No tools were available this round and the model gave no reply. '
      + 'Check the job\'s plan and available tools, or rehearse it first with schedule_preview. Investigate: zhin trace turn-9');
    expect(scheduled).not.toContain('/clear');
    expect(describeToolCallsForUser([{ tool: 'read_file', result: 'x', status: 'completed' }], { locale: 'en' }).text)
      .toContain('Reply "continue"');
    expect(describeToolCallsForUser([{ tool: 'load_skill', result: 'x' }], { locale: 'en' }).text)
      .toContain('No useful information');
    for (const text of [empty, denied, scheduled]) expect(text).not.toMatch(cjk);
    // The default language is unchanged.
    expect(formatToolCallsForUser([], { locale: 'zh-CN' })).toBe(formatToolCallsForUser([]));
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
