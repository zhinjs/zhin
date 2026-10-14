import { describe, expect, it } from 'vitest';
import {
  formatToolCallsForUser,
  looksLikeInternalToolDump,
} from '../../src/core/tool-calls-user-format.js';
import { sanitizeAssistantReply } from '../../src/core/text-sanitize.js';

describe('formatToolCallsForUser', () => {
  it('empty toolCalls returns actionable hint', () => {
    const out = formatToolCallsForUser([]);
    expect(out).toContain('/reset');
    expect(out).not.toContain('任务已结束，但没有可展示的结果');
  });

  it('hides catalog meta-tools and reports executable tool results', () => {
    const out = formatToolCallsForUser([
      { tool: 'discover', result: 'web_search' },
      { tool: 'web_search', result: '1. 狐蒂云相关新闻\nURL: https://example.com' },
    ]);
    expect(out).toContain('狐蒂云');
    expect(out).not.toContain('discover');
  });
});

describe('looksLikeInternalToolDump + sanitizeAssistantReply', () => {
  it('prefers formatted tool summary over agent dump text', () => {
    const dump = 'Done. Information retrieved:\n【web_search】\nraw result';
    const formatted = formatToolCallsForUser([
      { tool: 'web_search', result: '1. Result\nURL: https://example.com' },
    ]);
    expect(looksLikeInternalToolDump(dump)).toBe(true);
    const out = sanitizeAssistantReply(dump, { toolSummary: formatted });
    expect(out).toBe(formatted);
    expect(out).not.toContain('Done. Information retrieved');
  });
});

describe('formatToolCallsForUser exploration tools', () => {
  it('never includes bodies of read-only exploration tools', () => {
    const out = formatToolCallsForUser([
      { tool: 'read_file', result: 'File: secret.ts\n1 | const token = 1;' },
      { tool: 'grep', result: 'node_modules/foo/package.json:2: "name"' },
      { tool: 'list_dir', result: '[DIR]  handlers' },
      { tool: 'glob', result: 'a.ts\nb.ts' },
      { tool: 'web_fetch', result: '<html>page</html>' },
    ]);
    expect(out).not.toMatch(/secret\.ts|node_modules|handlers|a\.ts|<html>/);
    expect(out).toContain('继续');
  });

  it('keeps non-exploration results but caps the total length', () => {
    const out = formatToolCallsForUser([
      { tool: 'read_file', result: 'File: x.ts' },
      ...Array.from({ length: 5 }, (_, i) => ({ tool: 'web_search', result: `${i}`.repeat(1500) })),
    ]);
    expect(out).not.toContain('File: x.ts');
    expect(out.length).toBeLessThanOrEqual(3001);
  });
});
