import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOTENV_FILE_MODE, atomicWriteFile, readDotenvFile, updateDotenvFile, writeDotenvFile } from '../src/index.js';

const posix = process.platform !== 'win32';
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'zhin-env-file-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('ADR 0057 atomic .env writes', () => {
  it('creates a new .env with mode 0600 and reads a missing one as empty', async () => {
    const file = join(root, '.env');
    expect(await readDotenvFile(file)).toBe('');
    await writeDotenvFile(file, 'A=1\n');
    expect(await readFile(file, 'utf8')).toBe('A=1\n');
    if (posix) expect((await stat(file)).mode & 0o777).toBe(DOTENV_FILE_MODE);
  });

  it('keeps the existing file mode', async () => {
    const file = join(root, '.env');
    await writeFile(file, 'A=1\n');
    if (posix) await chmod(file, 0o640);
    await writeDotenvFile(file, 'A=2\n');
    expect(await readFile(file, 'utf8')).toBe('A=2\n');
    if (posix) expect((await stat(file)).mode & 0o777).toBe(0o640);
  });

  it('leaves no partial or temporary file and releases the lock when the write fails', async () => {
    const target = join(root, '.env.production');
    await mkdir(target);
    await expect(writeDotenvFile(target, 'A=1\n')).rejects.toMatchObject({ code: 'EISDIR' });
    // A failing rename (target is a directory) keeps the original and cleans up the temporary file.
    await expect(atomicWriteFile(target, 'A=1\n')).rejects.toBeTruthy();
    expect((await readdir(root)).sort()).toEqual(['.env.production']);
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it('serializes concurrent read-modify-write updates under the config file lock', async () => {
    const file = join(root, '.env');
    await writeFile(file, 'BASE=1\n');
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      updateDotenvFile(file, current => `${current}K${index}=${index}\n`)));
    const content = await readFile(file, 'utf8');
    for (let index = 0; index < 8; index += 1) expect(content).toContain(`K${index}=${index}\n`);
    expect(content.startsWith('BASE=1\n')).toBe(true);
    expect((await readdir(root)).sort()).toEqual(['.env']);
  });

  it('does not touch the file when the update returns undefined or the same text', async () => {
    const file = join(root, '.env');
    await writeFile(file, 'A=1\n');
    const before = (await stat(file)).ino;
    expect(await updateDotenvFile(file, () => undefined)).toBe('A=1\n');
    expect(await updateDotenvFile(file, current => current)).toBe('A=1\n');
    expect((await stat(file)).ino).toBe(before);
  });
});
