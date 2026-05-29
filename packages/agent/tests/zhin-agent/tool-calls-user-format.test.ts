import { describe, expect, it } from 'vitest';
import {
  formatToolCallsForUser,
  looksLikeInternalToolDump,
} from '../../src/zhin-agent/tool-calls-user-format.js';
import { sanitizeAssistantReply } from '../../src/zhin-agent/text-sanitize.js';

const DEFERRED_JSON = JSON.stringify({
  status: 'ok',
  loaded_tools: ['web_search'],
  iterations: 5,
  summary: '【web_search】(1/20 searches)\n1. 狐蒂云相关新闻\nURL: https://example.com',
});

describe('formatToolCallsForUser', () => {
  it('extracts summary from run_deferred_task JSON without wrapper', () => {
    const out = formatToolCallsForUser([
      { tool: 'tool_search', result: '未找到与「狐」匹配的工具' },
      { tool: 'run_deferred_task', result: DEFERRED_JSON },
    ]);
    expect(out).toContain('狐蒂云');
    expect(out).not.toContain('"status"');
    expect(out).not.toContain('【run_deferred_task】');
    expect(out).not.toContain('未找到');
  });

  it('drops minified JS in bash summary', () => {
    const noisy = JSON.stringify({
      status: 'ok',
      summary: [
        '【bash】[执行] STDOUT:',
        "'(function(){/*',",
        'google.c.e("load",a,',
        '【web_search】\n1. 结果标题',
      ].join('\n'),
    });
    const out = formatToolCallsForUser([{ tool: 'run_deferred_task', result: noisy }]);
    expect(out).toContain('结果标题');
    expect(out).not.toContain('google.c.e');
  });
});

describe('looksLikeInternalToolDump + sanitizeAssistantReply', () => {
  it('prefers formatted tool summary over agent dump text', () => {
    const dump = `Done. Information retrieved:\n【run_deferred_task】\n${DEFERRED_JSON}`;
    const formatted = formatToolCallsForUser([
      { tool: 'run_deferred_task', result: DEFERRED_JSON },
    ]);
    expect(looksLikeInternalToolDump(dump)).toBe(true);
    const out = sanitizeAssistantReply(dump, { toolSummary: formatted });
    expect(out).toBe(formatted);
    expect(out).not.toContain('Done. Information retrieved');
  });
});
