import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvFile, writeEnvFile } from '../../../src/plugin-runtime/console/environment-files.js';

it('only a missing env file is empty; unreadable existing paths report failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zhin-env-read-'));
  try {
    expect(await readEnvFile(root, '.env')).toBe('');
    await writeEnvFile(root, '.env', 'FAKE_TEST_VALUE=local-only\n');
    expect(await readEnvFile(root, '.env')).toBe('FAKE_TEST_VALUE=local-only\n');
    await mkdir(join(root, '.env.production'));
    await expect(readEnvFile(root, '.env.production')).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(writeEnvFile(root, '.env.production', 'FAKE_TEST_VALUE=changed')).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(readEnvFile(root, '../.env')).rejects.toThrow('Invalid env file');
  } finally { await rm(root, { recursive: true, force: true }); }
});
