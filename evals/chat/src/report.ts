/** Aggregate runs into a report and compare it with an earlier one. */
import type { CheckResult } from './checks.js';
import { SCORE_DIMENSIONS, type Judgment, type ScoreDimension } from './judge.js';
import type { Scenario } from './scenario.js';
import type { TurnResult } from './turn.js';

export interface RunRecord {
  readonly scenario: string;
  readonly run: number;
  readonly result: TurnResult;
  readonly checks: readonly CheckResult[];
  readonly judgment?: Judgment;
  readonly judgeError?: string;
}

export interface ScenarioSummary {
  readonly id: string;
  readonly title: string;
  readonly passRate: number;
  readonly scores: Readonly<Partial<Record<ScoreDimension, number>>>;
}

export interface EvalReport {
  readonly version: 1;
  readonly startedAt: string;
  readonly model: string;
  readonly judge: string;
  readonly runsPerScenario: number;
  readonly passRate: number;
  readonly scores: Readonly<Partial<Record<ScoreDimension, number>>>;
  /** Failed `fail`-severity checks by id, across all runs. */
  readonly checkFailures: Readonly<Record<string, number>>;
  readonly medianMs: number;
  readonly totalTokens: number;
  readonly scenarios: readonly ScenarioSummary[];
  readonly records: readonly RunRecord[];
}

/** A run passes when no hard check failed, the judge accepted every criterion and the call fit. */
export function runPassed(record: RunRecord): boolean {
  if (record.checks.some(check => !check.ok && check.severity === 'fail')) return false;
  if (!record.judgment) return false;
  if (record.judgment.criteria.some(criterion => !criterion.ok)) return false;
  return (record.judgment.scores.fit ?? 0) >= 3;
}

function mean(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function meanScores(records: readonly RunRecord[]): Partial<Record<ScoreDimension, number>> {
  const scores: Partial<Record<ScoreDimension, number>> = {};
  for (const dimension of SCORE_DIMENSIONS) {
    const value = mean(records.flatMap(record => {
      const score = record.judgment?.scores[dimension];
      return typeof score === 'number' ? [score] : [];
    }));
    if (value !== undefined) scores[dimension] = value;
  }
  return scores;
}

export function buildReport(input: {
  readonly startedAt: string;
  readonly model: string;
  readonly judge: string;
  readonly runsPerScenario: number;
  readonly scenarios: readonly Scenario[];
  readonly records: readonly RunRecord[];
}): EvalReport {
  const { records } = input;
  const checkFailures: Record<string, number> = {};
  for (const record of records) {
    for (const check of record.checks) {
      if (!check.ok && check.severity === 'fail') checkFailures[check.id] = (checkFailures[check.id] ?? 0) + 1;
    }
    if (record.judgeError) checkFailures.judge_error = (checkFailures.judge_error ?? 0) + 1;
  }
  const latencies = records.filter(record => !record.result.callError).map(record => record.result.ms).sort((a, b) => a - b);
  return {
    version: 1,
    startedAt: input.startedAt,
    model: input.model,
    judge: input.judge,
    runsPerScenario: input.runsPerScenario,
    passRate: records.length === 0 ? 0 : records.filter(runPassed).length / records.length,
    scores: meanScores(records),
    checkFailures,
    medianMs: latencies[Math.floor(latencies.length / 2)] ?? 0,
    totalTokens: records.reduce((sum, record) => sum + record.result.tokens, 0),
    scenarios: input.scenarios.map(scenario => {
      const own = records.filter(record => record.scenario === scenario.id);
      return {
        id: scenario.id,
        title: scenario.title,
        passRate: own.length === 0 ? 0 : own.filter(runPassed).length / own.length,
        scores: meanScores(own),
      };
    }),
    records,
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const signed = (value: number, digits = 2) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;

export function renderMarkdown(report: EvalReport, baseline?: EvalReport): string {
  const lines = [
    `# Chat eval — ${report.startedAt}`,
    '',
    `Model \`${report.model}\` · judge \`${report.judge}\` · ${report.scenarios.length} scenarios × ${report.runsPerScenario} runs`,
    '',
    '| | value | vs baseline |',
    '|---|---|---|',
    `| pass rate | ${percent(report.passRate)} | ${baseline ? signed((report.passRate - baseline.passRate) * 100, 0) + ' pt' : '—'} |`,
    ...SCORE_DIMENSIONS.map(dimension => {
      const value = report.scores[dimension];
      const before = baseline?.scores[dimension];
      return `| ${dimension} | ${value ?? '—'} | ${value !== undefined && before !== undefined ? signed(value - before) : '—'} |`;
    }),
    `| median latency | ${(report.medianMs / 1000).toFixed(1)} s | — |`,
    `| tokens | ${report.totalTokens} | — |`,
    '',
  ];
  const failures = Object.entries(report.checkFailures).sort((a, b) => b[1] - a[1]);
  if (failures.length > 0) {
    lines.push('## Hard check failures', '', ...failures.map(([id, count]) => `- \`${id}\`: ${count}`), '');
  }
  lines.push('## Scenarios', '', '| scenario | pass | humanlike | persona | fit | vs baseline |', '|---|---|---|---|---|---|');
  for (const scenario of report.scenarios) {
    const before = baseline?.scenarios.find(item => item.id === scenario.id);
    lines.push(`| ${scenario.id} ${scenario.title} | ${percent(scenario.passRate)} | ${scenario.scores.humanlike ?? '—'} | ${scenario.scores.persona ?? '—'} | ${scenario.scores.fit ?? '—'} | ${before ? signed((scenario.passRate - before.passRate) * 100, 0) + ' pt' : '—'} |`);
  }
  const failed = report.records.filter(record => !runPassed(record));
  if (failed.length > 0) {
    lines.push('', '## Failed runs', '');
    for (const record of failed) {
      const reply = record.result.messages.length > 0 ? record.result.messages.map(message => `「${message}」`).join(' ') : '(stayed quiet)';
      const reasons = [
        ...record.checks.filter(check => !check.ok && check.severity === 'fail').map(check => `${check.id}${check.detail ? `: ${check.detail}` : ''}`),
        ...(record.judgment?.criteria.filter(criterion => !criterion.ok).map(criterion => `criterion: ${criterion.note}`) ?? []),
        ...(record.judgment && (record.judgment.scores.fit ?? 0) < 3 ? [`fit ${record.judgment.scores.fit}`] : []),
        ...(record.judgeError ? [`judge: ${record.judgeError}`] : []),
      ];
      lines.push(`- **${record.scenario}** #${record.run + 1} ${reply}`, ...reasons.map(reason => `  - ${reason}`));
      if (record.judgment?.comment) lines.push(`  - 评语：${record.judgment.comment}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
