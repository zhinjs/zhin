import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sqliteRuntimeArguments } from '../../../../packages/toolkit/testing/tests/sqlite-runtime.mjs';

const sqliteArguments = sqliteRuntimeArguments();
const clientShimUrl = new URL('./client-module-shim.mjs', import.meta.url).href;

it.skipIf(sqliteArguments === undefined).each(['group', 'group-text'])('accepts group management, persistent scoped keywords, welcome and statistics (%s)', async (mode) => {
  const script = fileURLToPath(new URL('../../../../packages/toolkit/testing/tests/run-kit.mjs', import.meta.url));
  const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
  const result = await promisify(execFile)(
    process.execPath,
    [...(sqliteArguments ?? []), '--conditions=development', '--import', 'tsx', '--import', clientShimUrl, script, mode],
    {
      timeout: 30000,
      env: {
        ...process.env,
        NODE_OPTIONS: `${existingNodeOptions} --import tsx --import ${clientShimUrl}`.trim(),
      },
    },
  );
  expect(result.stdout).toContain('GROUP_ACCEPTANCE_OK');
}, 35000);
