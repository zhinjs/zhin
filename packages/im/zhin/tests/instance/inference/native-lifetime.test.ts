import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Generous backstop only. The fixture bounds every cancellation it checks (2 s each), so the run
 * is driven by the child's own completion: loading the fixture through `tsx` takes most of the
 * time and can exceed 12 s on a loaded machine, which is not what this test measures.
 */
const CHILD_BACKSTOP_MS = 120_000;

function runFixture(): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        '--expose-gc',
        '--conditions=development',
        '--import',
        'tsx',
        resolve('packages/im/zhin/tests/instance/fixtures/inference-native-lifetime.mjs'),
      ],
      { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const backstop = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error(`native lifetime fixture did not finish within ${CHILD_BACKSTOP_MS} ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, CHILD_BACKSTOP_MS);
    child.once('error', (error) => {
      clearTimeout(backstop);
      fail(error);
    });
    // Completion signal: the child exits after printing its result (or failing an assertion).
    child.once('close', (code, signal) => {
      clearTimeout(backstop);
      done({ code, signal, stdout, stderr });
    });
  });
}

it('keeps real Host SDK, disconnect, discovery and OAuth response cancellation alive through native Fetch GC', async () => {
  const result = await runFixture();
  expect(result, result.stderr).toMatchObject({ code: 0, signal: null });
  expect(result.stdout).toContain('host-native-gc-stream-disconnect-discovery-oauth-passed');
}, CHILD_BACKSTOP_MS + 10_000);
