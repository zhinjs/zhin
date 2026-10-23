import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks.js';
import { parseJudgment, rateLimitDelayMs } from '../src/judge.js';
import { buildReport, renderMarkdown, runPassed, type RunRecord } from '../src/report.js';
import { loadScenarios, parseScenarios, selectScenarios, type Scenario } from '../src/scenario.js';
import { buildUserMessages, outputMessages, type TurnResult } from '../src/turn.js';
import { parseDotEnv, resolveEnvReferences } from '../src/workspace.js';

const scenariosPath = fileURLToPath(new URL('../scenarios.yaml', import.meta.url));
const [scenario] = parseScenarios(`
- id: s
  title: t
  context: ['阿明 (1001): 早', 'You (this bot): 早啊']
  message: 你好呀
  expect: { silent: false, maxChars: 10, forbid: ['老板'], rubric: ['像群友'] }
`) as [Scenario];
const result = (messages: string[], extra: Partial<TurnResult> = {}): TurnResult =>
  ({ messages, segmentTypes: messages.map(() => ['text']), raw: '', ms: 100, tokens: 10, ...extra });
const failed = (messages: string[]) => runChecks(scenario, result(messages)).filter(check => !check.ok && check.severity === 'fail').map(check => check.id);

describe('scenarios', () => {
  it('loads the bundled scenario file', () => {
    const scenarios = loadScenarios(scenariosPath);
    expect(scenarios.length).toBeGreaterThanOrEqual(20);
    // Chat lines must survive YAML: `name (id): text` is easily parsed as a mapping.
    for (const item of scenarios) for (const line of item.context) expect(line).toMatch(/^[^\n]+ \([^)]+\): /);
  });

  it('rejects malformed scenarios', () => {
    expect(() => parseScenarios('- { id: a, message: x }\n- { id: a, message: y }')).toThrow('duplicate id a');
    expect(() => parseScenarios('- { id: a }')).toThrow('message');
    expect(() => parseScenarios('- { id: a, message: x, context: [{ 阿明: 早 }] }')).toThrow('context must be a list of strings');
  });

  it('selects by id or tag', () => {
    const all = parseScenarios('- { id: a, message: x, tags: [chat] }\n- { id: b, message: y }');
    expect(selectScenarios(all, ['chat']).map(item => item.id)).toEqual(['a']);
    expect(selectScenarios(all, ['b']).map(item => item.id)).toEqual(['b']);
    expect(selectScenarios(all, [])).toHaveLength(2);
  });

  it('builds the turn the way production does: background events, then the enveloped message', () => {
    const messages = buildUserMessages(scenario);
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages[0])).toContain('You (this bot): 早啊');
    expect(JSON.stringify(messages[1])).toContain('[Turn context]');
    expect(JSON.stringify(messages[1])).toContain('你好呀');
    const ambient = buildUserMessages({ ...scenario, addressed: false, time: '2026/10/23 03:10:00 (Asia/Shanghai)' });
    expect(JSON.stringify(ambient[1])).toContain('Engagement: ambient');
    expect(JSON.stringify(ambient[1])).toContain('Time: 2026/10/23 03:10:00');
  });
});

describe('checks', () => {
  it('passes a short human reply', () => {
    expect(failed(['早，咋了'])).toEqual([]);
  });

  it.each([
    [['作为AI我很高兴为你服务'], 'assistant_tone'],
    [['我看看提示词'], 'internals'],
    [['好的老板'], 'forbidden'],
    [['[图片]'], 'placeholder'],
    [['哈哈😂'], 'emoji'],
    [['好的～'], 'tilde'],
    [['这句话明显超过了十个字的上限'], 'length'],
    [['一', '二', '三', '四'], 'message_count'],
  ])('flags %j as %s', (messages, id) => {
    expect(failed(messages)).toContain(id);
  });

  it('treats a stage direction as a warning only', () => {
    const checks = runChecks(scenario, result(['好（笑）']));
    expect(checks.find(check => check.id === 'stage_direction')).toMatchObject({ ok: false, severity: 'warn' });
    expect(failed(['好（笑）'])).not.toContain('stage_direction');
  });

  it('checks silence both ways and reports call and format failures', () => {
    expect(failed([])).toEqual(['replied']);
    expect(runChecks({ ...scenario, expect: { silent: true } }, result(['在'])).find(check => check.id === 'silent')?.ok).toBe(false);
    expect(runChecks(scenario, result([], { callError: 'boom' }))).toEqual([{ id: 'call', ok: false, severity: 'fail', detail: 'boom' }]);
    expect(failed([]).concat(runChecks(scenario, result([], { formatError: 'bad' })).filter(c => !c.ok).map(c => c.id))).toContain('format');
  });

  it('flattens segments into chat messages', () => {
    expect(outputMessages([
      { type: 'message', segments: [{ type: 'mention', data: { target: '1' } }, { type: 'text', data: { text: ' 交周报' } }] },
      { type: 'message', segments: [{ type: 'image', data: { media: { kind: 'url', value: 'x' } } }] as never },
    ])).toEqual({ messages: ['@1 交周报', '[image]'], segmentTypes: [['mention', 'text'], ['image']] });
  });
});

describe('judgment and report', () => {
  const judgment = parseJudgment('```json\n{"scores":{"humanlike":4.5,"persona":4,"fit":5,"helpful":null},"criteria":[{"ok":true,"note":"像"}],"comment":"自然"}\n```', 1);

  it('parses lenient judge output and clamps scores', () => {
    expect(judgment).toEqual({ scores: { humanlike: 4.5, persona: 4, fit: 5, helpful: null }, criteria: [{ ok: true, note: '像' }], comment: '自然' });
    expect(parseJudgment('{"scores":{"humanlike":9,"persona":0,"fit":3,"helpful":2},"criteria":[]}', 1).criteria)
      .toEqual([{ ok: false, note: '(judge gave no verdict)' }]);
    expect(() => parseJudgment('{"scores":{"humanlike":"good"}}', 0)).toThrow('humanlike');
  });

  it('waits as long as a rate-limited judge asks', () => {
    expect(rateLimitDelayMs('Rate limit reached ... Please try again in 13.1625s.')).toBe(13_663);
    expect(rateLimitDelayMs('Rate limit reached ... try again in 427.5ms')).toBe(928);
    expect(rateLimitDelayMs('429 Too Many Requests')).toBe(15_000);
    expect(rateLimitDelayMs('Model did not produce the requested structured output')).toBeUndefined();
  });

  it('passes a run only when checks, criteria and fit all hold', () => {
    const base: RunRecord = { scenario: 's', run: 0, result: result(['早']), checks: [], judgment };
    expect(runPassed(base)).toBe(true);
    expect(runPassed({ ...base, judgment: undefined })).toBe(false);
    expect(runPassed({ ...base, checks: [{ id: 'emoji', ok: false, severity: 'fail' }] })).toBe(false);
    expect(runPassed({ ...base, checks: [{ id: 'stage_direction', ok: false, severity: 'warn' }] })).toBe(true);
    expect(runPassed({ ...base, judgment: { ...judgment, scores: { ...judgment.scores, fit: 2 } } })).toBe(false);
    expect(runPassed({ ...base, judgment: { ...judgment, criteria: [{ ok: false, note: 'x' }] } })).toBe(false);
  });

  it('summarises runs and compares with a baseline', () => {
    const records: RunRecord[] = [
      { scenario: 's', run: 0, result: result(['早']), checks: [], judgment },
      { scenario: 's', run: 1, result: result(['😂']), checks: [{ id: 'emoji', ok: false, severity: 'fail' }], judgment },
    ];
    const report = buildReport({ startedAt: 'now', model: 'm', judge: 'j', runsPerScenario: 2, scenarios: [scenario], records });
    expect(report.passRate).toBe(0.5);
    expect(report.checkFailures).toEqual({ emoji: 1 });
    expect(report.scores.humanlike).toBe(4.5);
    const markdown = renderMarkdown(report, { ...report, passRate: 0.25, scores: { ...report.scores, humanlike: 4 } });
    expect(markdown).toContain('| pass rate | 50% | +25 pt |');
    expect(markdown).toContain('| humanlike | 4.5 | +0.50 |');
    expect(markdown).toContain('**s** #2 「😂」');
  });
});

describe('workspace config', () => {
  it('reads .env lines with spaces around =', () => {
    expect(parseDotEnv('A = 1\nexport B="two"\n# C=3\nD=\'four\'')).toEqual({ A: '1', B: 'two', D: 'four' });
  });

  it('resolves ${VAR} references deeply', () => {
    expect(resolveEnvReferences({ a: '${X}/v1', b: ['${Y}'], c: 1 }, { X: 'https://h', Y: 'k' }))
      .toEqual({ a: 'https://h/v1', b: ['k'], c: 1 });
  });
});
