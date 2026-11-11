import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ADR 0047 §1a / S1 acceptance「文档检查」: Claude subscription and Antigravity
// ship only as experimental channels and must never be described as officially supported.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const RISK_NOTICE = '实验 · 不受官方支持 · 可能违反供应商条款 · 风险由使用者自行承担';

// ADR / plan documents discuss the §1a policy itself and are exempt from the pairing check.
const exemptDirs = ['docs/adr', 'docs/plans'];

const listMarkdown = (dir: string): string[] =>
  fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || exemptDirs.includes(relativePath)) return [];
      return listMarkdown(relativePath);
    }
    return entry.name.endsWith('.md') ? [relativePath] : [];
  });

const experimentalProvider = /claude[^\n]{0,40}(订阅|subscription)|(订阅|subscription)[^\n]{0,40}claude|antigravity/iu;
const officialClaim = /(?<!不受|非|未获|未经)官方支持|(?<!not |never |un)officially supported/iu;

describe('AI provider experimental channel docs (ADR 0047 §1a)', () => {
  it.each([
    'docs/ai/providers.md',
    'packages/im/ai/README.md',
    'README.md',
    'README.zh-CN.md',
  ])('%s carries the §1a risk notice', (relativePath) => {
    expect(read(relativePath)).toContain(RISK_NOTICE);
  });

  it.each(['README.md', 'README.zh-CN.md'])('%s links to docs/ai/providers.md', (relativePath) => {
    expect(read(relativePath)).toContain('](./docs/ai/providers.md)');
  });

  it('docs never pair Claude subscription / Antigravity with an official-support claim', () => {
    const files = [...listMarkdown('docs'), 'packages/im/ai/README.md'];
    const offenders = files.flatMap((relativePath) =>
      read(relativePath)
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => experimentalProvider.test(line) && officialClaim.test(line))
        .map(({ line, index }) => `${relativePath}:${index + 1}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
