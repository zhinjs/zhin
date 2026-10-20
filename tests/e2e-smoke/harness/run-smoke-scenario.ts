import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export interface SmokeScenarioResult {
  readonly stdout: string;
  readonly steps: readonly string[];
}

/**
 * Runs one scenario in a fresh native Node process. Framework feature providers must be loaded by the
 * same Node loader as the application, so scenarios never run inside the Vitest module graph.
 */
export async function runSmokeScenario(scenarioFile: string, timeoutMs: number): Promise<SmokeScenarioResult> {
  const scenarioPath = fileURLToPath(new URL(`../scenarios/${scenarioFile}`, import.meta.url));
  const nodeArguments = ['--conditions=development', '--import', 'tsx', scenarioPath];
  const result = await runFile(process.execPath, nodeArguments, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const steps = result.stdout
    .split(/\r?\n/u)
    .filter(line => line.startsWith('SMOKE_STEP '))
    .map(line => line.slice('SMOKE_STEP '.length));
  return { stdout: result.stdout, steps };
}
