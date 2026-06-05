import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  compactMediaToolJsonForModel,
  parseMediaToolResultForOutbound,
  relativizeCwdPaths,
  sanitizeToolResult,
  stripHallucinatedToolCalls,
} from '../src/agent/tool-result-sanitizer.js';

describe('sanitizeToolResult', () => {
  it('keeps normal text untouched', () => {
    const input = 'Star count is 64';
    expect(sanitizeToolResult(input)).toBe(input);
  });

  it('filters noisy html/anti-bot payloads', () => {
    const input = [
      '200',
      '<!DOCTYPE html><html><head><script>window.location.assign("/antibot/verifycode")</script></head></html>',
      'Final finding: source site blocks scraping, switch to web_search.',
    ].join('\n');
    const out = sanitizeToolResult(input);
    expect(out).toContain('Final finding');
    expect(out).toContain('（已省略无关的页面/脚本噪声）');
    expect(out.toLowerCase()).not.toContain('<html');
  });

  it('filters minified javascript lines', () => {
    const input = [
      '【bash】[执行] STDOUT:',
      "'(function(){/*',",
      'google.c.e("load",a,b);var B=this||self;',
      '【web_search】\n1. 有效结果',
    ].join('\n');
    const out = sanitizeToolResult(input);
    expect(out).toContain('有效结果');
    expect(out).not.toContain('google.c.e');
  });

  it('relativizeCwdPaths replaces project root with dot', () => {
    const root = path.resolve('/tmp/zhin-test-root');
    const input = `read ${root}/packages/ai/src/index.ts and ${root}`;
    const out = relativizeCwdPaths(input, root);
    expect(out).toBe('read ./packages/ai/src/index.ts and .');
  });

  it('sanitizeToolResult applies cwd relativization', () => {
    const root = path.resolve('/tmp/zhin-sanitize-root');
    const out = sanitizeToolResult(`file: ${root}/README.md`, { cwd: root });
    expect(out).toBe('file: ./README.md');
  });

  it('strips hallucinated tool_call markup but keeps prose', () => {
    const input =
      '项目结构如下：\n<tool_call>read_file</tool_call>\nplugins 在 examples/test-bot/src/plugins';
    const out = sanitizeToolResult(input);
    expect(out).toContain('项目结构如下');
    expect(out).toContain('plugins');
    expect(out).not.toContain('<tool_call');
  });

  it('truncates overly long output', () => {
    const input = `result:\n${'x'.repeat(2000)}`;
    const out = sanitizeToolResult(input, { maxChars: 120 });
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out).toContain('[truncated]');
  });

  it('compactMediaToolJsonForModel omits generate_image base64 but keeps metadata', () => {
    const raw = JSON.stringify({
      image: 'A'.repeat(5000),
      mime: 'image/png',
      model: 'cogview-3-flash',
      provider: 'zhipu-vl',
    });
    const compact = compactMediaToolJsonForModel('generate_image', raw);
    const parsed = JSON.parse(compact) as Record<string, unknown>;
    expect(parsed.mime).toBe('image/png');
    expect(String(parsed.image)).toContain('omitted');
    expect(String(parsed.image)).not.toContain('AAAA');
    const sanitized = sanitizeToolResult(compact);
    expect(() => JSON.parse(sanitized)).not.toThrow();
  });

  it('parseMediaToolResultForOutbound preserves full generate_image payload', () => {
    const raw = JSON.stringify({ image: 'YmFzZTY0', mime: 'image/png' });
    const out = parseMediaToolResultForOutbound('generate_image', raw);
    expect(out).toEqual({ image: 'YmFzZTY0', mime: 'image/png' });
  });
});

