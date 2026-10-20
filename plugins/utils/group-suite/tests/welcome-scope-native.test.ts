import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('validates welcome scope and isolated instances through native PluginTestKit, HMR and config rollback', async () => {
  const script = fileURLToPath(new URL('./welcome-scope-native.mjs', import.meta.url));
  const result = await promisify(execFile)(process.execPath, ['--conditions=development', '--import', 'tsx', script], { timeout: 30000 });
  expect(result.stdout).toContain('WELCOME_SCOPE_NATIVE_OK');
}, 35000);
