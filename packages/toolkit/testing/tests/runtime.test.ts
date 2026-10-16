import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// All Framework modules share the actual Node loader; Vitest does not create a second provider realm.
it('drives discovery, permissions, dispatch, send suppression, HMR rollback and config failure', async () => {
  const result = await promisify(execFile)(process.execPath,
    ['--conditions=development', '--import', 'tsx', fileURLToPath(new URL('./run-kit.mjs', import.meta.url)), 'base'],
    { timeout: 30000 });
  expect(result.stdout).toContain('KIT_ACCEPTANCE_OK');
}, 35000);
