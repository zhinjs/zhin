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
      resolve('packages/im/zhin/tests/instance/fixtures/inference-native-lifetime.mjs'),
    ],
    // Only a hang guard: the child compiles the instance graph cold with tsx, which alone took
    // more than 12 s on a loaded run. The behavior is asserted inside the fixture.
    { cwd: resolve('.'), timeout: 90_000 }
  );
  expect(result.stdout).toContain('host-native-gc-stream-disconnect-discovery-oauth-passed');
}, 100_000);
