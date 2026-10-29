/**
 * `pnpm eval:budget` — ADR 0042 §8 first-turn token measurement.
 *   pnpm eval:budget            print the markdown table
 *   pnpm eval:budget --compare  also show deltas against evals/budget/baseline.json
 *   pnpm eval:budget --write    overwrite the baseline with the current numbers
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measureAll, renderTable, toBaseline, type BaselineFile } from './measure.js';

const BASELINE_PATH = fileURLToPath(new URL('./baseline.json', import.meta.url));
const args = new Set(process.argv.slice(2));
const measures = await measureAll();

if (args.has('--write')) {
  const note = 'ADR 0042 W5 baseline on feat/0041-impl (before W1-W4). Rerun: pnpm eval:budget --compare';
  writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(measures, note), null, 2)}\n`);
  console.log(`baseline written to ${BASELINE_PATH}\n`);
}
let baseline: BaselineFile | undefined;
if (args.has('--compare')) baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
console.log(renderTable(measures, baseline));
