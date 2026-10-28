/**
 * Chat eval: how human the bot sounds in IM, scored on fixed scenarios with real models.
 *
 *   pnpm eval:chat --workspace ~/zhin-workspace [--model alias/model] [--judge alias/model]
 *                  [--runs 2] [--only id-or-tag,...] [--baseline report.json|none]
 *
 * Writes reports/<timestamp>.{json,md} next to this file and compares with the latest earlier report.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fillPromptSlots } from '../../packages/im/agent/src/prompt/system-prompt.js';
import { runChecks } from './src/checks.js';
import { judgeReply } from './src/judge.js';
import { buildReport, renderMarkdown, type EvalReport, type RunRecord } from './src/report.js';
import { loadScenarios, selectScenarios, type Scenario } from './src/scenario.js';
import { buildSystemPrompt, runScenarioTurn, scenarioTurn, scenarioPromptKey } from './src/turn.js';
import { loadEvalWorkspace } from './src/workspace.js';

const here = dirname(fileURLToPath(import.meta.url));
const print = (line: string) => process.stdout.write(`${line}\n`);
const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: process.cwd() },
    agent: { type: 'string' },
    model: { type: 'string' },
    judge: { type: 'string' },
    runs: { type: 'string', default: '2' },
    only: { type: 'string', default: '' },
    scenarios: { type: 'string', default: join(here, 'scenarios.yaml') },
    out: { type: 'string', default: join(here, 'reports') },
    baseline: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
  },
});

const workspaceDir = resolve(values.workspace.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
const workspace = loadEvalWorkspace(workspaceDir, values.agent);
const modelRef = values.model ?? workspace.agentModel;
const judgeRef = values.judge ?? modelRef;
const runs = Math.max(1, Number.parseInt(values.runs, 10) || 1);
const concurrency = Math.max(1, Number.parseInt(values.concurrency, 10) || 1);
const scenarios = selectScenarios(loadScenarios(values.scenarios), values.only.split(',').map(term => term.trim()).filter(Boolean));
if (scenarios.length === 0) throw new Error('No scenario matches --only');

const soulPath = join(workspaceDir, 'SOUL.md');
const persona = existsSync(soulPath) ? fillPromptSlots(readFileSync(soulPath, 'utf8'), workspace.nickname) : '(no SOUL.md)';
const model = workspace.model(modelRef);
const judge = workspace.model(judgeRef);
const startedAt = new Date().toISOString();
print(`chat eval: ${scenarios.length} scenarios × ${runs} runs, model ${modelRef}, judge ${judgeRef}`);

const prompts = new Map<string, Promise<string>>();
const systemPromptFor = (scenario: Scenario) => {
  const key = scenarioPromptKey(scenario);
  if (!prompts.has(key)) prompts.set(key, buildSystemPrompt(workspaceDir, workspace.nickname, scenarioTurn(scenario), scenario.time));
  return prompts.get(key)!;
};

const jobs = scenarios.flatMap(scenario => Array.from({ length: runs }, (_unused, run) => ({ scenario, run })));
const records: RunRecord[] = [];
let next = 0;
async function worker(): Promise<void> {
  while (next < jobs.length) {
    const { scenario, run } = jobs[next++]!;
    const result = await runScenarioTurn({ runtime: workspace.runtime, model, systemPrompt: await systemPromptFor(scenario), scenario });
    const checks = runChecks(scenario, result);
    let judgment: RunRecord['judgment'];
    let judgeError: string | undefined;
    if (!result.callError) {
      try {
        judgment = await judgeReply({ completion: workspace.runtime, model: judge, scenario, persona, result });
      } catch (error) {
        judgeError = error instanceof Error ? error.message : String(error);
      }
    }
    records.push({ scenario: scenario.id, run, result, checks, ...(judgment ? { judgment } : {}), ...(judgeError ? { judgeError } : {}) });
    const reply = result.callError ? `ERROR ${result.callError}` : result.messages.join(' / ') || '(quiet)';
    print(`  ${scenario.id} #${run + 1}: ${reply.slice(0, 80)}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
records.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.run - b.run);

const report = buildReport({ startedAt, model: modelRef, judge: judgeRef, runsPerScenario: runs, scenarios, records });
mkdirSync(values.out, { recursive: true });
const earlier = readdirSync(values.out).filter(name => name.endsWith('.json')).sort();
const baselinePath = values.baseline === 'none' ? undefined : values.baseline ?? (earlier.length > 0 ? join(values.out, earlier.at(-1)!) : undefined);
const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalReport : undefined;
const stamp = startedAt.replace(/[:.]/g, '-');
writeFileSync(join(values.out, `${stamp}.json`), `${JSON.stringify(report, null, 1)}\n`);
const markdown = renderMarkdown(report, baseline);
writeFileSync(join(values.out, `${stamp}.md`), markdown);
print(`\n${markdown}`);
print(`report: ${join(values.out, `${stamp}.md`)}${baselinePath ? ` (baseline ${baselinePath})` : ''}`);
