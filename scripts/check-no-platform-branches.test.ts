import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script
import { allowlistCovers, collectAdapterPlatformNames, EXTRA_PLATFORM_NAMES, findPlatformBranches, LITERAL_ONLY_NAMES, PLATFORM_NAMES, run } from './check-no-platform-branches.mjs';

/** A whole-repository scan, measured at a few seconds locally and slower under CI coverage. */
const REPO_SCAN_TIMEOUT_MS = 60_000;

/**
 * Snapshot of every scanned platform name and how it is matched (#1250 review L3).
 *
 * A new adapter package adds its id automatically, so this test fails until the id is confirmed here.
 * Before adding it, decide: is the id an ordinary word or a field name (`line`, `email`, `sandbox`)?
 * Then add it to LITERAL_ONLY_NAMES in check-no-platform-branches.mjs ('literal') so `foo: 1` keys
 * are not flagged; literals such as `kind === 'line'` still are and need an allowlist entry with a `text`
 * fragment. Ids with a hyphen are only ever matched as literals.
 */
const EXPECTED_PLATFORM_NAMES: Record<string, 'literal' | 'literal+key'> = {
  bilibili: 'literal+key',
  'bilibili-live': 'literal',
  dingtalk: 'literal+key',
  discord: 'literal+key',
  'douyin-live': 'literal',
  email: 'literal',
  feishu: 'literal+key',
  github: 'literal',
  icqq: 'literal+key',
  'ipad-wechat': 'literal',
  juejin: 'literal+key',
  kook: 'literal+key',
  lark: 'literal+key',
  line: 'literal',
  milky: 'literal+key',
  napcat: 'literal+key',
  onebot: 'literal+key',
  onebot11: 'literal+key',
  onebot12: 'literal+key',
  qq: 'literal+key',
  // common word: `runtime.sandbox` is a capability field (allowlisted by line in capability-profile.ts)
  sandbox: 'literal+key',
  satori: 'literal+key',
  slack: 'literal+key',
  telegram: 'literal+key',
  wechat: 'literal+key',
  'wechat-mp': 'literal',
  wecom: 'literal+key',
  weixin: 'literal+key',
  'weixin-ilink': 'literal',
  wxwork: 'literal+key',
};

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

  it('scans exactly the confirmed platform names (update EXPECTED_PLATFORM_NAMES when an adapter is added)', () => {
    const actual = Object.fromEntries([...PLATFORM_NAMES].sort().map((name: string) => [
      name,
      LITERAL_ONLY_NAMES.includes(name) || name.includes('-') ? 'literal' : 'literal+key',
    ]));
    expect(actual).toEqual(EXPECTED_PLATFORM_NAMES);
  });

  it('allowlist entries with a text fragment cover only matching lines (#1250 review L2)', () => {
    const entry = { file: 'a.ts', name: 'line', text: "kind === 'line'", reason: 'x' };
    expect(allowlistCovers(entry, 'a.ts', { name: 'line', text: "if (plan.kind === 'line') {" })).toBe(true);
    expect(allowlistCovers(entry, 'a.ts', { name: 'line', text: "if (platform === 'line') {" })).toBe(false);
    expect(allowlistCovers({ file: 'a.ts', name: 'line', reason: 'x' }, 'a.ts', { name: 'line', text: 'anything' })).toBe(true);
  });

  it('every allowlist entry is narrowed to a text fragment', async () => {
    const { readFileSync } = await import('node:fs');
    const entries = JSON.parse(readFileSync(new URL('./no-platform-branches-allowlist.json', import.meta.url), 'utf8')) as Array<{ text?: string }>;
    for (const entry of entries) expect(entry.text, JSON.stringify(entry)).toBeTruthy();
  });

  it('ignores comment markers inside strings when blanking comments', () => {
    expect(findPlatformBranches("const u = 'a//'; if (p === 'icqq') {}").map((hit: { name: string }) => hit.name)).toEqual(['icqq']);
  });

  // Whole-repo scan: sized for coverage-instrumented CI runners, not the 10s unit-test default.
  it('passes on the repository', () => {
    expect(run()).toBe(0);
  }, REPO_SCAN_TIMEOUT_MS);
});
