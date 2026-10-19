import {chmod, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConfigDocument} from '../src/create-config-document.js';

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});

it.each(['json', 'yml'])('preserves mode 0660 despite umask 022 for %s commit and rollback', async format => {
  const originalUmask = process.umask(0o022);
  try {
    const root = await mkdtemp(join(tmpdir(), 'zhin-config-mode-')); roots.push(root);
    const file = join(root, `zhin.config.${format}`);
    const source = format === 'json' ? '{"configVersion":2,"plugins":{}}\n' : 'configVersion: 2\nplugins: {}\n';
    await writeFile(file, source);
    await chmod(file, 0o660);
    const document = createConfigDocument(file);
    const transaction = await document.prepare(await document.read(), [{op: 'set', path: ['http'], value: {port: 8086}}]);
    await transaction.commit();
    expect((await stat(file)).mode & 0o777).toBe(0o660);
    await transaction.rollback();
    expect((await stat(file)).mode & 0o777).toBe(0o660);
    expect(await readFile(file, 'utf8')).toBe(source);
  } finally {process.umask(originalUmask);}
});
