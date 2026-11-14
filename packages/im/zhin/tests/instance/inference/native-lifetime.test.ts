import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Longest silence allowed between two progress lines of the fixture. The fixture asserts its own
 * cancellation deadlines (`mustSettle`); this only catches a child that hangs outright. A total
 * wall-clock budget is not used: tsx transpiling the source graph plus the forced full GCs cost
 * several seconds of CPU and grow with machine load.
 */
const IDLE_LIMIT_MS = 30_000;

function runFixture(): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; output: string }> {
  return new Promise((done, reject) => {
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
    let output = '';
    let idle: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`native lifetime fixture made no progress for ${IDLE_LIMIT_MS} ms:\n${output}`));
      }, IDLE_LIMIT_MS);
    };
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      output += String(chunk);
      arm();
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(idle);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(idle);
      done({ code, signal, stdout, output });
    });
    arm();
  });
}

it('keeps real Host SDK, disconnect, discovery and OAuth response cancellation alive through native Fetch GC', async () => {
  const result = await runFixture();
  expect(result.code, result.output).toBe(0);
  expect(result.stdout).toContain('host-native-gc-stream-disconnect-discovery-oauth-passed');
}, 180_000);
