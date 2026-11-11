import Ajv2020 from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../schema.json' with { type: 'json' };
import { resolveGroupSuiteConfig } from '../src/config.js';
import { getTeachModel } from '../src/db-store.js';
import { createInMemoryGroupSuiteDb } from '../src/memory-store.js';
import { createGroupSuiteRuntime } from '../src/runtime-state.js';
import { isSafeRegex, TEACH_REGEX_MAX_CONTENT, teachAdd, tryTeachReply } from '../src/teach-lib.js';

const input = {
  locale: 'zh-CN' as const,
  content: '',
  conversation: { kind: 'group' as const, id: 'g1', endpoint: { adapter: 'sandbox', id: 'bot' } },
  sender: { id: 'u1', name: 'Alice' },
};

/** Patterns that backtrack exponentially on a short non-matching input. */
const CATASTROPHIC = ['(\\w+\\s?)+$', '(a|aa)+$', '(.*a){10}$'];

afterEach(() => vi.restoreAllMocks());

describe('teach regex safety', () => {
  it('is off by default in code and in the published schema', () => {
    expect(resolveGroupSuiteConfig({}).teachAllowRegex).toBe(false);
    const data: Record<string, unknown> = {};
    expect(new Ajv2020({ useDefaults: true, strict: false }).compile(schema)(data)).toBe(true);
    expect(data.teachAllowRegex).toBe(false);
  });

  it.each(CATASTROPHIC)('rejects %s without ever executing it', (pattern) => {
    const test = vi.spyOn(RegExp.prototype, 'test');
    const exec = vi.spyOn(RegExp.prototype, 'exec');
    const started = performance.now();
    const safe = isSafeRegex(pattern);
    const elapsed = performance.now() - started;
    // The check is structural: it must not run the pattern (running it is the attack).
    const ranPattern = [...test.mock.contexts, ...exec.mock.contexts].some(regex => (regex as RegExp).source === pattern);
    expect(safe).toBe(false);
    expect(ranPattern).toBe(false);
    // Generous bound for loaded CI machines; running the pattern would take minutes.
    expect(elapsed).toBeLessThan(1000);
  });

  it.each([
    '((a+))+', '(a*)*', '(a+){2,}', '(x|y)*z', '(?=a+)a', '(?<!b)a', '(a)\\1', '(?<n>a)\\k<n>',
    '.*.*.*.*x', 'a{1,9}b{1,9}c{1,9}d{1,9}', '(a', 'x'.repeat(201),
  ])('rejects %s', (pattern) => {
    expect(isSafeRegex(pattern)).toBe(false);
  });

  it.each([
    '^你好.*$', '^(\\d+)\\+(\\d+)$', '^(早|晚)安$', '[ab]+c', 'colou?r', '^\\w+@\\w+\\.com$', '(ab)+', 'a{2,4}', '\\(literal\\)+',
    '[(+*|]+x', '^(\\d+)?天气$',
  ])('accepts %s', (pattern) => {
    expect(isSafeRegex(pattern)).toBe(true);
  });

  it('teach-regex refuses the catastrophic patterns and regex rules when disabled', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    const enabled = resolveGroupSuiteConfig({ teachAllowRegex: true });
    expect(await teachAdd(input, enabled, '(\\w+\\s?)+$ boom', true, runtime)).toBe('该正则可能导致性能问题，请简化');
    expect(await teachAdd(input, enabled, '(.*a){10}$ boom', true, runtime)).toBe('该正则可能导致性能问题，请简化');
    // `|` is always read as the question/answer separator, so this one is cut to an invalid pattern first.
    expect(await teachAdd(input, enabled, '(a|aa)+$ boom', true, runtime)).toMatch(/正则表达式不合法|性能问题/);
    expect(await teachAdd(input, resolveGroupSuiteConfig({}), '^hi$|hello', true, runtime)).toBe('管理员已禁用正则问答');
    expect(await getTeachModel(runtime.db)!.select()).toEqual([]);
  });

  it('skips an unsafe rule already in storage and stays fast on adversarial input', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    const enabled = resolveGroupSuiteConfig({ teachAllowRegex: true, teachCooldownMs: 0 });
    await getTeachModel(runtime.db)!.insert({
      question: '(\\w+\\s?)+$', answer: 'boom', is_regex: 1, context_type: 'group', context_id: 'g1', hit_count: 0,
    });
    const started = performance.now();
    expect(await tryTeachReply({ ...input, content: `${'a'.repeat(40)}!` }, enabled, runtime)).toBeNull();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('only tries regex rules on short messages, compiles each rule once and still fills captures', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    const enabled = resolveGroupSuiteConfig({ teachAllowRegex: true, teachCooldownMs: 0 });
    expect(await teachAdd(input, enabled, '^(\\d+)号桌|已为 $1 号桌下单', true, runtime)).toContain('^(\\d+)号桌');
    await teachAdd(input, enabled, '长消息 exact', false, runtime);

    expect(await tryTeachReply({ ...input, content: '12号桌 加一份' }, enabled, runtime)).toBe('已为 12 号桌下单');
    const long = `7号桌${'x'.repeat(TEACH_REGEX_MAX_CONTENT)}`;
    expect(await tryTeachReply({ ...input, content: long }, enabled, runtime)).toBeNull();
    // Exact rules are not subject to the length cap, and regex rules stay off when disabled.
    expect(await tryTeachReply({ ...input, content: '长消息' }, enabled, runtime)).toBe('exact');
    expect(await tryTeachReply({ ...input, content: '12号桌' }, resolveGroupSuiteConfig({}), runtime)).toBeNull();

    const compile = vi.spyOn(globalThis, 'RegExp');
    for (let i = 0; i < 5; i += 1) await tryTeachReply({ ...input, content: `${i}号桌` }, enabled, runtime);
    expect(compile.mock.calls.filter(([source]) => source === '^(\\d+)号桌')).toEqual([]);
  });
});
