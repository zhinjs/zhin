import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('runs actual Console-generated regression through PluginTestKit, rejects wrong expected output and preserves explicit/omitted roles and unmatched input', async () => {
  const result = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('./run-scenario.mjs', import.meta.url))],
    { timeout: 100_000 });
  expect(result.stdout).toContain('CONSOLE_SCENARIO_EXPORT_RUNTIME_OK');
}, 105_000);
