/** Nightly report: per model × case pass rates, averages, and a diff against the previous night. */
import type { Capability } from './matrix-cases.js';
import type { SemanticCheck } from './semantic.js';

export interface CaseRunResult {
  readonly pass: boolean;
  readonly checks: readonly SemanticCheck[];
  readonly totalTokens: number;
  readonly toolCalls: number;
  /** Provider error or budget stop, when the run produced no observation. */
  readonly error?: string;
  readonly skipped?: boolean;
}

export interface CaseSummary {
  readonly id: string;
  readonly capability: Capability;
  readonly runs: number;
  readonly passed: number;
  readonly skipped: number;
  /** passed / (runs − skipped); null when every run was skipped. */
  readonly passRate: number | null;
  readonly avgTokens: number;
  readonly avgToolCalls: number;
  /** First failure detail per failing run, for triage. */
  readonly failures: readonly string[];
}

export interface ModelSummary {
  readonly model: string;
  readonly cases: readonly CaseSummary[];
}

export interface NightlyReport {
  readonly version: 1;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly provider: string;
  readonly budget: Readonly<{ requests: number; totalTokens: number; maxRequests: number; maxTotalTokens: number }>;
  readonly stoppedByBudget: boolean;
  readonly models: readonly ModelSummary[];
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export function summarizeCase(id: string, capability: Capability, results: readonly CaseRunResult[]): CaseSummary {
  const counted = results.filter((result) => !result.skipped);
  const passed = counted.filter((result) => result.pass).length;
  const failures = counted
    .filter((result) => !result.pass)
    .map((result) => result.error ?? result.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail ?? ''}`).join('; '));
  return {
    id,
    capability,
    runs: results.length,
    passed,
    skipped: results.length - counted.length,
    passRate: counted.length === 0 ? null : Math.round((passed / counted.length) * 1000) / 1000,
    avgTokens: average(counted.map((result) => result.totalTokens)),
    avgToolCalls: average(counted.map((result) => result.toolCalls)),
    failures,
  };
}

export interface CaseDiff {
  readonly model: string;
  readonly id: string;
  readonly previous: number | null;
  readonly current: number | null;
  readonly delta: number | null;
  readonly status: 'regressed' | 'improved' | 'unchanged' | 'new' | 'removed';
}

/** Compare pass rates; a change of `threshold` or more counts as regressed / improved. */
export function diffReports(previous: NightlyReport | undefined, current: NightlyReport, threshold = 0.2): CaseDiff[] {
  const key = (model: string, id: string) => `${model}\u0000${id}`;
  const before = new Map<string, number | null>();
  for (const model of previous?.models ?? []) for (const c of model.cases) before.set(key(model.model, c.id), c.passRate);
  const diffs: CaseDiff[] = [];
  const seen = new Set<string>();
  for (const model of current.models) {
    for (const c of model.cases) {
      const k = key(model.model, c.id);
      seen.add(k);
      if (!before.has(k)) {
        diffs.push({ model: model.model, id: c.id, previous: null, current: c.passRate, delta: null, status: 'new' });
        continue;
      }
      const prev = before.get(k) ?? null;
      const delta = prev === null || c.passRate === null ? null : Math.round((c.passRate - prev) * 1000) / 1000;
      const status = delta === null ? 'unchanged' : delta <= -threshold ? 'regressed' : delta >= threshold ? 'improved' : 'unchanged';
      diffs.push({ model: model.model, id: c.id, previous: prev, current: c.passRate, delta, status });
    }
  }
  for (const model of previous?.models ?? []) {
    for (const c of model.cases) {
      if (!seen.has(key(model.model, c.id))) {
        diffs.push({ model: model.model, id: c.id, previous: c.passRate, current: null, delta: null, status: 'removed' });
      }
    }
  }
  return diffs;
}

const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

/** Markdown for the job summary and the artifact. */
export function renderMarkdown(report: NightlyReport, diffs: readonly CaseDiff[]): string {
  const lines = [
    `# Nightly model evals — ${report.startedAt.slice(0, 10)}`,
    '',
    `Provider: ${report.provider} · requests ${report.budget.requests}/${report.budget.maxRequests} · tokens ${report.budget.totalTokens}/${report.budget.maxTotalTokens}${report.stoppedByBudget ? ' · **stopped by budget**' : ''}`,
    '',
    '| Model | Case | Capability | Pass rate | Δ | Avg tokens | Avg tool calls |',
    '|---|---|---|---|---|---|---|',
  ];
  const byKey = new Map(diffs.map((d) => [`${d.model}\u0000${d.id}`, d]));
  for (const model of report.models) {
    for (const c of model.cases) {
      const diff = byKey.get(`${model.model}\u0000${c.id}`);
      const delta = diff?.status === 'new' ? 'new' : diff?.delta == null ? '—' : `${diff.delta > 0 ? '+' : ''}${Math.round(diff.delta * 100)}%${diff.status === 'regressed' ? ' ⚠️' : ''}`;
      lines.push(`| ${model.model} | ${c.id} | ${c.capability} | ${pct(c.passRate)} (${c.passed}/${c.runs - c.skipped}) | ${delta} | ${c.avgTokens} | ${c.avgToolCalls} |`);
    }
  }
  const regressions = diffs.filter((d) => d.status === 'regressed');
  lines.push('', regressions.length ? `**Regressions:** ${regressions.map((d) => `${d.model}/${d.id}`).join(', ')}` : 'No regressions against the previous report.');
  return lines.join('\n');
}
