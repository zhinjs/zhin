import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import rootConfig from '../../../../vitest.config.js';
import nightlyConfig from '../evals/nightly/vitest.config.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const VITEST_BIN = fileURLToPath(new URL('../../../../node_modules/vitest/vitest.mjs', import.meta.url));
const PR_GATE_EVAL_EXCLUDE = 'packages/im/agent/evals/**';
const NIGHTLY_ENTRY = 'packages/im/agent/evals/nightly/nightly.run.ts';
const GATE_EVAL_TEST = 'packages/im/agent/evals/nightly/nightly.test.ts';

/** Model credentials must not reach a discovery process, even though it does not execute tests. */
const MODEL_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'NIGHTLY_PROVIDER',
  'NIGHTLY_MODELS',
  'NIGHTLY_REPORT_DIR',
  'NIGHTLY_PREVIOUS_REPORT',
];

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function discoveryEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
  for (const key of Object.keys(env)) {
    if (key === 'VITEST' || key.startsWith('VITEST_') || MODEL_ENV_KEYS.includes(key)) delete env[key];
  }
  return env;
}

/**
 * Same config `eval:nightly` runs (`vitest --config evals/nightly/vitest.config.ts`),
 * but `list --filesOnly` only globs. It does not import test files or call a model.
 *
 * Do not pass `--json` here. That option takes an optional path, so a following
 * file filter is treated as the output file and Vitest overwrites it.
 */
function listTestFiles(config: string, filter?: string): { status: number | null; files: string[]; output: string } {
  const args = [VITEST_BIN, 'list', '--config', config, '--filesOnly'];
  if (filter) args.push(filter);
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: discoveryEnv(),
    timeout: 60_000,
  });
  const stdout = result.stdout ?? '';
  const output = `${stdout}\n${result.stderr ?? ''}`;
  if (result.error) throw result.error;
  const files = stdout.replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((line) => line.trim()).filter((line) => line.endsWith('.ts') || line.endsWith('.tsx'));
  return { status: result.status, files, output };
}

describe('nightly vitest file discovery', () => {
  it('drops only the PR-gate evals exclude and still finds nightly.run.ts without running it', () => {
    const rootExclude = stringList(rootConfig.test?.exclude, 'root exclude');
    const nightlyExclude = stringList(nightlyConfig.test?.exclude, 'nightly exclude');
    expect(rootExclude).toContain(PR_GATE_EVAL_EXCLUDE);
    expect(nightlyExclude).not.toContain(PR_GATE_EVAL_EXCLUDE);
    expect(nightlyExclude).toEqual(rootExclude.filter((pattern) => pattern !== PR_GATE_EVAL_EXCLUDE));
    expect(nightlyConfig.test?.include).toEqual([NIGHTLY_ENTRY]);

    const nightly = listTestFiles('packages/im/agent/evals/nightly/vitest.config.ts');
    expect(nightly.status, nightly.output).toBe(0);
    expect(nightly.files.some((file) => file.endsWith(NIGHTLY_ENTRY))).toBe(true);
    expect(nightly.files.some((file) => file.endsWith('.test.ts') || file.endsWith('.eval.ts'))).toBe(false);
    expect(nightly.output).not.toContain('capability matrix');
    expect(nightly.output).not.toContain('GEMINI_API_KEY');

    const visible = listTestFiles('vitest.config.ts', 'packages/im/agent/tests/nightly-vitest-discovery.test.ts');
    expect(visible.status, visible.output).toBe(0);
    expect(visible.files).toEqual(['packages/im/agent/tests/nightly-vitest-discovery.test.ts']);

    const gate = listTestFiles('vitest.config.ts', GATE_EVAL_TEST);
    expect(gate.status, gate.output).toBe(0);
    expect(gate.files).toEqual([]);
    expect(gate.output).not.toContain('capability matrix');
  }, 90_000);
});
