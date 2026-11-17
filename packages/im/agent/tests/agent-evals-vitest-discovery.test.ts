import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import rootConfig from '../../../../vitest.config.js';
import agentEvalConfig from '../evals/vitest.config.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const VITEST_BIN = fileURLToPath(new URL('../../../../node_modules/vitest/vitest.mjs', import.meta.url));
const PR_GATE_EVAL_EXCLUDE = 'packages/im/agent/evals/**';
const AGENT_EVAL_CONFIG = 'packages/im/agent/evals/vitest.config.ts';
const SCRIPTED_EVAL = 'packages/im/agent/evals/agent.eval.ts';
const FRAMEWORK_TEST = 'packages/im/agent/evals/framework/framework.test.ts';
const DISCOVERY_TEST = 'packages/im/agent/tests/agent-evals-vitest-discovery.test.ts';

/** Model credentials must not reach a discovery process, even though it does not execute tests. */
const MODEL_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'ZHIN_EVAL_CONTEXT_REPORT',
  'ZHIN_EVAL_TRACE_DIR',
  'EVAL_VERBOSE',
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
    if (
      key === 'VITEST'
      || key.startsWith('VITEST_')
      || key.endsWith('_API_KEY')
      || key.endsWith('_API_TOKEN')
      || MODEL_ENV_KEYS.includes(key)
    ) delete env[key];
  }
  return env;
}

function stripAnsi(text: string): string {
  const esc = String.fromCharCode(0x1b);
  let result = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== esc) {
      result += text[i];
      continue;
    }
    if (text[i + 1] === '[') {
      i += 2;
      while (i < text.length) {
        const code = text.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) break;
        i += 1;
      }
    }
  }
  return result;
}

/**
 * Same config `eval:agent` runs (`vitest --config evals/vitest.config.ts`),
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
  const files = stripAnsi(stdout)
    .split('\n')
    .map((line) => line.trim().replaceAll('\\', '/'))
    .filter((line) => line.endsWith('.ts') || line.endsWith('.tsx'));
  return { status: result.status, files, output };
}

describe('agent eval vitest file discovery', () => {
  it('drops only the PR-gate evals exclude and still finds eval files without running them', () => {
    const rootExclude = stringList(rootConfig.test?.exclude, 'root exclude');
    const agentExclude = stringList(agentEvalConfig.test?.exclude, 'agent eval exclude');
    expect(rootExclude).toContain(PR_GATE_EVAL_EXCLUDE);
    expect(agentExclude).not.toContain(PR_GATE_EVAL_EXCLUDE);
    expect(agentExclude).toEqual(rootExclude.filter((pattern) => pattern !== PR_GATE_EVAL_EXCLUDE));
    expect(agentEvalConfig.test?.include).toEqual([
      'packages/im/agent/evals/**/*.eval.ts',
      'packages/im/agent/evals/**/*.test.ts',
    ]);

    const discovered = listTestFiles(AGENT_EVAL_CONFIG);
    expect(discovered.status, discovered.output).toBe(0);
    expect(discovered.files.some((file) => file.endsWith(SCRIPTED_EVAL))).toBe(true);
    expect(discovered.files.some((file) => file.endsWith(FRAMEWORK_TEST))).toBe(true);
    expect(discovered.files.every((file) => file.includes('packages/im/agent/evals/'))).toBe(true);
    expect(discovered.files.some((file) => file.endsWith(DISCOVERY_TEST))).toBe(false);
    expect(discovered.output).not.toContain('agent evals (scripted model)');
    expect(discovered.output).not.toContain('RAW-PAYLOAD');
    expect(discovered.output).not.toContain('GEMINI_API_KEY');

    const visible = listTestFiles('vitest.config.ts', DISCOVERY_TEST);
    expect(visible.status, visible.output).toBe(0);
    expect(visible.files).toEqual([DISCOVERY_TEST]);

    const gate = listTestFiles('vitest.config.ts', FRAMEWORK_TEST);
    expect(gate.status, gate.output).toBe(0);
    expect(gate.files).toEqual([]);
    expect(gate.output).not.toContain('RAW-PAYLOAD');
  }, 180_000);
});
