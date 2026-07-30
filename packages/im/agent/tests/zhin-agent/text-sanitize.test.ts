import { describe, expect, it } from 'vitest';
import {
  looksLikeRawToolMarkup,
  sanitizeAssistantReply,
  stripHallucinatedToolCalls,
  unwrapJsonStringLayers,
} from '../../src/core/text-sanitize.js';

const DSML_SAMPLE = `<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="run_deferred_task">
<｜｜DSML｜｜parameter name="goal" string="true">搜索成都房价</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="tool_query" string="true">web_search 成都</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`;

describe('stripHallucinatedToolCalls', () => {
  it('removes DeepSeek DSML blocks', () => {
    const out = stripHallucinatedToolCalls(DSML_SAMPLE);
    expect(out).toBe('');
    expect(looksLikeRawToolMarkup(out)).toBe(false);
  });

  it('preserves surrounding natural language', () => {
    const out = stripHallucinatedToolCalls(`好的，我来查。\n${DSML_SAMPLE}\n请稍等。`);
    expect(out).toContain('好的');
    expect(out).toContain('请稍等');
    expect(out).not.toContain('DSML');
  });
});

describe('unwrapJsonStringLayers', () => {
  it('unwraps a single JSON string literal', () => {
    expect(unwrapJsonStringLayers('"你好！很高兴见到你。"')).toBe('你好！很高兴见到你。');
  });

  it('decodes escaped newlines inside the string', () => {
    expect(unwrapJsonStringLayers('"您好！\\n"')).toBe('您好！\n');
  });

  it('recursively unwraps nested JSON string layers', () => {
    const nested = JSON.stringify(`${JSON.stringify('我是你的助手\n\n准备执行')}\n`);
    expect(unwrapJsonStringLayers(nested)).toBe('我是你的助手\n\n准备执行');
  });

  it('leaves plain text and JSON objects untouched', () => {
    expect(unwrapJsonStringLayers('普通回复')).toBe('普通回复');
    expect(unwrapJsonStringLayers('{"text":"hi"}')).toBe('{"text":"hi"}');
  });
});

describe('sanitizeAssistantReply', () => {
  it('returns fallback when reply is only DSML', () => {
    const out = sanitizeAssistantReply(DSML_SAMPLE, {
      toolSummary: '【web_search】\n找到 3 条结果',
    });
    expect(out).toBe('【web_search】\n找到 3 条结果');
  });

  it('returns default message when DSML and no tool summary', () => {
    const out = sanitizeAssistantReply(DSML_SAMPLE);
    expect(out).toContain('无效');
    expect(out).not.toContain('DSML');
  });

  it('unwraps JSON-quoted model replies before outbound', () => {
    expect(sanitizeAssistantReply('"你好！"')).toBe('你好！');
    expect(sanitizeAssistantReply('"您好！\\n还有下文"')).toBe('您好！\n还有下文');
  });
});
