import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

it('keeps real Host SDK, disconnect, discovery and OAuth response cancellation alive through native Fetch GC', async () => {
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--expose-gc',
      '--conditions=development',
      '--import',
      'tsx',
      resolve('basic/cli/tests/fixtures/inference-native-lifetime.mjs'),
    ],
    { cwd: resolve('.'), timeout: 12_000 }
  );
  expect(result.stdout).toContain('host-native-gc-stream-disconnect-discovery-oauth-passed');
}, 15_000);
