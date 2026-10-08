import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProjectFileTree, listEnvFiles, readProjectFile, saveProjectFile } from '../src/project-files.js';

it('denies symlink escapes for reads, overwrites, new parents, tree and env inventory', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'zhin-project-files-'));
  const root = path.join(fixture, 'project');
  const outside = path.join(fixture, 'outside');
  try {
    await mkdir(root); await mkdir(outside);
    await writeFile(path.join(outside, 'fixture.txt'), 'outside');
    await symlink(outside, path.join(root, 'src'));
    await symlink(path.join(outside, 'fixture.txt'), path.join(root, '.env'));
    await expect(readProjectFile(root, 'src/fixture.txt')).rejects.toThrow('Access denied');
    await expect(saveProjectFile(root, 'src/fixture.txt', 'overwrite')).rejects.toThrow('Access denied');
    await expect(saveProjectFile(root, 'src/new/deep.txt', 'new')).rejects.toThrow('Access denied');
    expect(await readFile(path.join(outside, 'fixture.txt'), 'utf8')).toBe('outside');
    await expect(readFile(path.join(outside, 'new/deep.txt'))).rejects.toThrow();
    expect(await buildProjectFileTree(root)).toEqual([]);
    expect(await listEnvFiles(root)).toContainEqual({ name: '.env', exists: false });
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

it('preserves internal links and denies blocked targets, nested blocked paths and dangling links', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'zhin-project-files-'));
  const root = path.join(fixture, 'project');
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'plugins/valid'), { recursive: true });
    await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'plugins/valid/file.txt'), 'internal');
    await writeFile(path.join(root, 'data/blocked.txt'), 'blocked');
    await symlink('../plugins/valid', path.join(root, 'src/internal'));
    await symlink('../data', path.join(root, 'src/blocked'));
    await symlink(path.join(fixture, 'absent'), path.join(root, 'src/dangling'));
    await expect(readProjectFile(root, 'src/internal/file.txt')).resolves.toMatchObject({ content: 'internal' });
    await saveProjectFile(root, 'src/internal/new/deep.txt', 'created');
    expect(await readFile(path.join(root, 'plugins/valid/new/deep.txt'), 'utf8')).toBe('created');
    await expect(readProjectFile(root, 'src/blocked/blocked.txt')).rejects.toThrow('Access denied');
    await expect(saveProjectFile(root, 'src/blocked/new.txt', 'overwrite')).rejects.toThrow('Access denied');
    await expect(saveProjectFile(root, 'src/data/new.txt', 'overwrite')).rejects.toThrow('Access denied');
    await expect(saveProjectFile(root, 'src/dangling/new.txt', 'overwrite')).rejects.toThrow('Access denied');
    const tree = await buildProjectFileTree(root);
    const src = tree.find((entry) => entry.name === 'src');
    expect(src?.children?.map((entry) => entry.name)).toEqual(['internal']);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

it('checks leaf links and allows a symlinked project root without admitting blocked aliases', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'zhin-project-files-'));
  const root = path.join(fixture, 'project');
  const alias = path.join(fixture, 'project-alias');
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'README.md'), 'internal');
    await writeFile(path.join(root, 'node_modules/fixture.txt'), 'blocked');
    await writeFile(path.join(fixture, 'outside.txt'), 'outside');
    await symlink(root, alias);
    await symlink(path.join(fixture, 'outside.txt'), path.join(root, 'src/outside.txt'));
    await symlink('../README.md', path.join(root, 'src/readme.txt'));
    await symlink('node_modules/fixture.txt', path.join(root, '.env.production'));
    await expect(readProjectFile(alias, 'src/readme.txt')).resolves.toMatchObject({ content: 'internal' });
    await expect(saveProjectFile(alias, 'src/outside.txt', 'overwrite')).rejects.toThrow('Access denied');
    expect(await readFile(path.join(fixture, 'outside.txt'), 'utf8')).toBe('outside');
    await expect(readProjectFile(alias, '.env.production')).rejects.toThrow('Access denied');
    expect(await listEnvFiles(alias)).toContainEqual({ name: '.env.production', exists: false });
    const src = (await buildProjectFileTree(alias)).find((entry) => entry.name === 'src');
    expect(src?.children?.map((entry) => entry.name)).toEqual(['readme.txt']);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
