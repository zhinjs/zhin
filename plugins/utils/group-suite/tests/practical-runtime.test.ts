import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sqliteRuntimeArguments } from '../../../../packages/toolkit/testing/tests/sqlite-runtime.mjs';

const sqliteArguments = sqliteRuntimeArguments();

it.skipIf(sqliteArguments === undefined).each(['group', 'group-text'])('accepts group management, persistent scoped keywords, welcome and statistics (%s)', async (mode) => {
  const script = fileURLToPath(new URL('../../../../packages/toolkit/testing/tests/run-kit.mjs', import.meta.url));
  const result = await promisify(execFile)(process.execPath,
    [...(sqliteArguments ?? []), '--conditions=development', '--import', 'tsx', script, mode], { timeout: 30000 });
  expect(result.stdout).toContain('GROUP_ACCEPTANCE_OK');
}, 35000);
