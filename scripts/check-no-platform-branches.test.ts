import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script
import { collectAdapterPlatformNames, EXTRA_PLATFORM_NAMES, findPlatformBranches, PLATFORM_NAMES, run } from './check-no-platform-branches.mjs';

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

  it('collects platform names from the adapter packages', () => {
    const collected = collectAdapterPlatformNames();
    for (const name of ['wecom', 'weixin-ilink', 'wechat-mp', 'line', 'email', 'github', 'juejin', 'douyin-live', 'bilibili-live', 'ipad-wechat', 'icqq', 'telegram']) {
      expect(collected).toContain(name);
      expect(PLATFORM_NAMES).toContain(name);
    }
    for (const name of EXTRA_PLATFORM_NAMES) expect(PLATFORM_NAMES).toContain(name);
    expect(PLATFORM_NAMES).toEqual(expect.arrayContaining(['onebot', 'weixin', 'wechat']));
  });

  it('flags newly collected adapter ids', () => {
    expect(findPlatformBranches([
      "if (adapter === 'wecom') {}",
      "if (adapter === 'weixin-ilink') {}",
      "case 'wechat-mp':",
      'const quirks = { wecom: 1, juejin: 2 };',
      "if (adapter === 'onebot11') {}",
    ].join('\n')).map((hit: { name: string }) => hit.name)).toEqual(['wecom', 'weixin-ilink', 'wechat-mp', 'wecom', 'juejin', 'onebot11']);
  });

  it('flags word-like adapter ids only as literals, never as object keys', () => {
    expect(findPlatformBranches([
      "if (platform === 'line') {}",
      'const hit = { line: 3, email: user.email, github: true };',
    ].join('\n')).map((hit: { name: string; kind: string }) => `${hit.name}:${hit.kind}`)).toEqual(['line:literal']);
  });

  it('passes on the repository', () => {
    expect(run()).toBe(0);
  });
});
