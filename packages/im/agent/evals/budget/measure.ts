/**
 * ADR 0042 §8 first-turn token measurement. Runs the fixed scenes offline
 * against the scripted model and reports, per measured turn, the nominal input
 * tokens of every model call, the stable (cross-session cacheable) prefix, an
 * estimated cached share and the number of calls. Numbers are estimates from
 * `estimatePromptTokens` (CJK ~1 token/char, other ~4 chars/token), computed
 * from exactly what the harness sent; deterministic, no network.
 */
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimatePromptTokens } from '../../src/prompt/estimate-tokens.js';
import { runEvalCase, type EvalCase } from '../framework/index.js';
import type { ScriptedModelRequest } from '../framework/scripted-model.js';
import { BUDGET_SCENES, type BudgetScene } from './scenes.js';

/** Weight of a cache read relative to a fresh input token in the "billed-equivalent" column. */
export const CACHE_READ_WEIGHT = 0.1;

/** The scene line is the tail of the system prompt (ADR 0041 §5); everything before it is the stable prefix. */
export const SCENE_MARKER = '[scene_id:';

export interface CallMeasure {
  readonly nominal: number;
  readonly stablePrefix: number;
  readonly cachedRead: number;
}

export interface SceneSummary {
  readonly callCount: number;
  readonly firstCallNominal: number;
  readonly totalNominal: number;
  readonly stablePrefix: number;
  /** Stable prefix / first-call nominal. */
  readonly cachedShareFirstCall: number;
  /** Σ(fresh + cacheRead × weight): call 1 reads the stable prefix, later calls read the previous call's prompt. */
  readonly billedEquivalent: number;
}

export interface SceneMeasure {
  readonly id: string;
  readonly title: string;
  readonly calls: readonly CallMeasure[];
  /** Last turn's first-request ContextBudgetReport totals from the trace (`context_budget`). */
  readonly contextBudget: Readonly<{ total_tokens: number; fixed_tokens: number }> | null;
  readonly summary: SceneSummary;
}

function stablePrefixTokens(request: ScriptedModelRequest): number {
  const cut = request.systemPrompt.indexOf(SCENE_MARKER);
  const system = cut >= 0 ? request.systemPrompt.slice(0, cut) : request.systemPrompt;
  return estimatePromptTokens(system) + estimatePromptTokens(request.toolSchemaText);
}

function nominalTokens(request: ScriptedModelRequest): number {
  return estimatePromptTokens(request.systemPrompt) + estimatePromptTokens(request.toolSchemaText) + estimatePromptTokens(request.inputText);
}

export function summarize(calls: readonly CallMeasure[]): SceneSummary {
  const first = calls[0];
  const billed = calls.reduce((sum, call) => sum + (call.nominal - call.cachedRead) + call.cachedRead * CACHE_READ_WEIGHT, 0);
  return {
    callCount: calls.length,
    firstCallNominal: first?.nominal ?? 0,
    totalNominal: calls.reduce((sum, call) => sum + call.nominal, 0),
    stablePrefix: first?.stablePrefix ?? 0,
    cachedShareFirstCall: first && first.nominal > 0 ? Math.round((first.stablePrefix / first.nominal) * 1000) / 1000 : 0,
    billedEquivalent: Math.round(billed),
  };
}

function toEvalCase(scene: BudgetScene): EvalCase {
  return {
    id: `budget-${scene.id}`,
    description: scene.title,
    source: 'ADR 0042 §8 measurement',
    ...scene.base,
    inbound: scene.turns.map((turn) => turn.inbound),
    script: scene.turns.flatMap((turn) => turn.script),
    expect: {},
  };
}

export async function measureScene(scene: BudgetScene): Promise<SceneMeasure> {
  const run = await runEvalCase(toEvalCase(scene));
  const lastTurn = scene.turns[scene.turns.length - 1]!;
  const requests = run.modelRequests.slice(run.modelRequests.length - lastTurn.script.length);
  const calls: CallMeasure[] = requests.map((request, index) => {
    const nominal = nominalTokens(request);
    const stable = stablePrefixTokens(request);
    const previous = index > 0 ? nominalTokens(requests[index - 1]!) : 0;
    return { nominal, stablePrefix: stable, cachedRead: Math.min(nominal, index === 0 ? stable : Math.max(previous, stable)) };
  });
  const budget = run.traces[run.traces.length - 1]?.context_budget;
  return {
    id: scene.id,
    title: scene.title,
    calls,
    contextBudget: budget ? { total_tokens: budget.total_tokens, fixed_tokens: budget.fixed_tokens } : null,
    summary: summarize(calls),
  };
}

/**
 * Pinned bootstrap files (AGENTS.md / SOUL.md / TOOLS.md). The harness reads
 * them, and `git status`, from the cwd, so measurement runs in a throwaway copy
 * outside any git checkout: numbers then do not depend on the repo's state.
 */
const FIXTURE_WORKSPACE = fileURLToPath(new URL('./workspace', import.meta.url));

export async function measureAll(scenes: readonly BudgetScene[] = BUDGET_SCENES): Promise<SceneMeasure[]> {
  const previous = process.cwd();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-eval-budget-')));
  await cp(FIXTURE_WORKSPACE, root, { recursive: true });
  process.chdir(root);
  try {
    const out: SceneMeasure[] = [];
    for (const scene of scenes) out.push(await measureScene(scene));
    return out;
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
}

export interface BaselineFile {
  readonly note: string;
  readonly scenes: Readonly<Record<string, SceneSummary & Readonly<{ perCallNominal: readonly number[] }>>>;
}

export function toBaseline(measures: readonly SceneMeasure[], note: string): BaselineFile {
  return {
    note,
    scenes: Object.fromEntries(measures.map((m) => [m.id, { ...m.summary, perCallNominal: m.calls.map((c) => c.nominal) }])),
  };
}

export function renderTable(measures: readonly SceneMeasure[], baseline?: BaselineFile): string {
  const header = baseline
    ? '| scene | calls | per-call nominal | first-call | stable prefix | cached share (1st) | billed-eq | Δ first-call | Δ billed-eq |'
    : '| scene | calls | per-call nominal | first-call | stable prefix | cached share (1st) | billed-eq | ctx budget total/fixed |';
  const sep = baseline ? '|---|---:|---|---:|---:|---:|---:|---:|---:|' : '|---|---:|---|---:|---:|---:|---:|---|';
  const delta = (now: number, before: number | undefined) => before === undefined
    ? 'n/a'
    : `${now - before >= 0 ? '+' : ''}${now - before} (${before ? Math.round(((now - before) / before) * 100) : 0}%)`;
  const rows = measures.map((m) => {
    const s = m.summary;
    const perCall = m.calls.map((c) => c.nominal).join(' / ');
    const base = baseline?.scenes[m.id];
    const common = `| ${m.id} | ${s.callCount} | ${perCall} | ${s.firstCallNominal} | ${s.stablePrefix} | ${(s.cachedShareFirstCall * 100).toFixed(1)}% | ${s.billedEquivalent} |`;
    return baseline
      ? `${common} ${delta(s.firstCallNominal, base?.firstCallNominal)} | ${delta(s.billedEquivalent, base?.billedEquivalent)} |`
      : `${common} ${m.contextBudget ? `${m.contextBudget.total_tokens} / ${m.contextBudget.fixed_tokens}` : 'n/a'} |`;
  });
  return [header, sep, ...rows].join('\n');
}
