import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { relativizeCwdPaths, sanitizeToolResult } from '../src/agent/tool-result-sanitizer.js';

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

  it('truncates overly long output', () => {
    const input = `result:\n${'x'.repeat(2000)}`;
    const out = sanitizeToolResult(input, { maxChars: 120 });
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out).toContain('[truncated]');
  });
});

