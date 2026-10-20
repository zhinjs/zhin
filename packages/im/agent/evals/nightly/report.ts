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
  /** Not run (budget exhausted, or the model lacks a needed input); excluded from the pass rate. */
  readonly skipped?: boolean;
  /**
   * The provider stayed 503 UNAVAILABLE after its retry (rate-limit.ts): an infra
   * failure, not a model one. Excluded from the pass rate, counted in `report.infra`.
   */
  readonly unavailable?: boolean;
}

export interface CaseSummary {
  readonly id: string;
  readonly capability: Capability;
  readonly runs: number;
  readonly passed: number;
  readonly skipped: number;
  /** Of `skipped`, the runs skipped because the request/token budget ran out. */
  readonly budgetSkipped?: number;
  /** Runs that were provider-unavailable (503 after retry); not part of the pass rate. */
  readonly unavailable?: number;
  /** passed / (runs − skipped − unavailable); null when no run produced a verdict. */
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
  /** Set when the run had to stop early and must fail (the free-tier daily quota ran out). */
  readonly fatal?: string;
  /** Client-side pacing (see rate-limit.ts): spacing, real requests sent, 429 retries. */
  readonly pacing?: Readonly<{ minIntervalMs: number; requests: number; retries: number; gaveUp: number; unavailable503?: number; unavailableRetries?: number; providerUnavailable?: number }>;
  /**
   * Provider health. `flaky` when most attempted (non-skipped) runs were
   * provider-unavailable: the pass rates then say nothing about model quality, and
   * the nightly job fails as infra-flaky (see nightly.run.ts) instead of reporting
   * regressions or becoming the next night's baseline.
   */
  readonly infra?: Readonly<{ attempted: number; providerUnavailable: number; flaky: boolean }>;
  readonly models: readonly ModelSummary[];
}

/** Infra-flaky: more than half of the runs that were attempted ended provider-unavailable. */
export function infraHealth(models: readonly ModelSummary[]): { attempted: number; providerUnavailable: number; flaky: boolean } {
  let attempted = 0;
  let providerUnavailable = 0;
  for (const model of models) {
    for (const c of model.cases) {
      attempted += c.runs - c.skipped;
      providerUnavailable += c.unavailable ?? 0;
    }
  }
  return { attempted, providerUnavailable, flaky: attempted > 0 && providerUnavailable * 2 > attempted };
}

const BUDGET_SKIP = /budget/i;

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export function summarizeCase(id: string, capability: Capability, results: readonly CaseRunResult[]): CaseSummary {
  const counted = results.filter((result) => !result.skipped && !result.unavailable);
  const skipped = results.filter((result) => result.skipped);
  const unavailable = results.filter((result) => !result.skipped && result.unavailable).length;
  const passed = counted.filter((result) => result.pass).length;
  const failures = results
    .filter((result) => !result.skipped && !result.pass)
    .map((result) => result.error ?? result.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail ?? ''}`).join('; '));
  return {
    id,
    capability,
    runs: results.length,
    passed,
    skipped: skipped.length,
    budgetSkipped: skipped.filter((result) => BUDGET_SKIP.test(result.error ?? '')).length,
    unavailable,
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
    ...(report.pacing ? [`Pacing: ≥${report.pacing.minIntervalMs / 1000}s between requests · ${report.pacing.requests} sent · ${report.pacing.retries} 429 retries · ${report.pacing.gaveUp} gave up`] : []),
    ...(report.pacing?.unavailable503 ? [`503 UNAVAILABLE: ${report.pacing.unavailable503} answers · ${report.pacing.unavailableRetries ?? 0} retried · ${report.pacing.providerUnavailable ?? 0} requests still 503 after retry (runs marked provider-unavailable only when they failed)`] : []),
    ...(report.fatal ? ['', `**Run failed:** ${report.fatal}`] : []),
    ...(report.infra?.flaky ? ['', `**Infra-flaky:** ${report.infra.providerUnavailable} of ${report.infra.attempted} attempted runs were provider-unavailable (503). Pass rates and regressions below are not a quality signal; the job fails as infra-flaky.`] : []),
    ...budgetSkipLines(report),
    '',
    '| Model | Case | Capability | Pass rate | Δ | Not counted | Avg tokens | Avg tool calls |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const byKey = new Map(diffs.map((d) => [`${d.model}\u0000${d.id}`, d]));
  for (const model of report.models) {
    for (const c of model.cases) {
      const diff = byKey.get(`${model.model}\u0000${c.id}`);
      const delta = diff?.status === 'new' ? 'new' : diff?.delta == null ? '—' : `${diff.delta > 0 ? '+' : ''}${Math.round(diff.delta * 100)}%${diff.status === 'regressed' ? ' ⚠️' : ''}`;
      lines.push(`| ${model.model} | ${c.id} | ${c.capability} | ${pct(c.passRate)} (${c.passed}/${c.runs - c.skipped - (c.unavailable ?? 0)}) | ${delta} | ${notCounted(c)} | ${c.avgTokens} | ${c.avgToolCalls} |`);
    }
  }
  const regressions = diffs.filter((d) => d.status === 'regressed');
  const label = report.infra?.flaky ? '**Regressions (untrusted, infra-flaky run):**' : '**Regressions:**';
  lines.push('', regressions.length ? `${label} ${regressions.map((d) => `${d.model}/${d.id}`).join(', ')}` : 'No regressions against the previous report.');
  return lines.join('\n');
}

function notCounted(c: CaseSummary): string {
  const budget = c.budgetSkipped ?? 0;
  const parts = [
    ...(budget ? [`${budget} budget-skipped`] : []),
    ...(c.skipped - budget ? [`${c.skipped - budget} skipped`] : []),
    ...(c.unavailable ? [`${c.unavailable} provider-unavailable`] : []),
  ];
  return parts.join(', ') || '—';
}

function budgetSkipLines(report: NightlyReport): string[] {
  const skipped = report.models.flatMap((model) => model.cases
    .filter((c) => (c.budgetSkipped ?? 0) > 0)
    .map((c) => `${model.model}/${c.id} (${c.budgetSkipped}/${c.runs})`));
  if (skipped.length === 0) return [];
  const total = report.models.reduce((sum, model) => sum + model.cases.reduce((n, c) => n + (c.budgetSkipped ?? 0), 0), 0);
  return ['', `**Budget-skipped:** ${total} runs not run because the budget (requests ${report.budget.requests}/${report.budget.maxRequests}) ran out: ${skipped.join(', ')}`];
}
