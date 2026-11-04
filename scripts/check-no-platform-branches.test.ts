import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script
import { findPlatformBranches, run } from './check-no-platform-branches.mjs';

describe('check-no-platform-branches', () => {
  it('flags platform literals and unquoted keys', () => {
    const hits = findPlatformBranches([
      "if (platform === 'icqq') {}",
      'switch (x) { case "discord": break; }',
      'const table = { telegram: 1, kook?: 2 };',
    ].join('\n'));
    expect(hits.map((hit: { name: string }) => hit.name)).toEqual(['icqq', 'discord', 'telegram', 'kook']);
  });

  it('ignores comments, prose strings and member access', () => {
    expect(findPlatformBranches([
      "// platform === 'icqq'",
      '/** discord: native */',
      "throw new Error(`blocked by sandbox: ${x}`);",
      'const y = config.sandbox ? 1 : 2;',
      "const z = 'qq-guild';",
    ].join('\n'))).toEqual([]);
  });

  it('passes on the repository', () => {
    expect(run()).toBe(0);
  });
});
