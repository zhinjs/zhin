import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProjectFileTree, isProjectPathAllowed, listEnvFiles, readProjectFile, saveProjectFile } from '../src/project-files.js';

it('edits formal plugin entries, capabilities and configuration without admitting legacy or blocked paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zhin-project-capabilities-'));
  try {
    const paths = ['plugin.ts', 'plugin.tsx', 'zhin.config.json', 'zhin.config.yaml', 'schema.json', 'AGENTS.md',
      'schedules/poll/index.ts', 'handlers/welcome/index.ts', 'hooks/check/index.ts', 'mcps/local/index.ts',
      'agents/group/skills/manage/tools/mute/index.ts'];
    for (const relative of paths) {
      await saveProjectFile(root, relative, 'fixture');
      await expect(readProjectFile(root, relative)).resolves.toMatchObject({ content: 'fixture' });
    }
    const tree = await buildProjectFileTree(root);
    expect(tree.map(item => item.name)).toEqual(expect.arrayContaining(['schedules', 'handlers', 'hooks', 'mcps', 'plugin.ts', 'zhin.config.json']));
    expect(isProjectPathAllowed('mcp/local/index.ts')).toBe(false);
    expect(isProjectPathAllowed('schedules/poll/node_modules/private.ts')).toBe(false);
    expect(isProjectPathAllowed('mcps/../data/secrets')).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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

describe('dotenv files stay out of the project file manager (issue #1250)', () => {
  const DOTENV_ERROR = /\.env files are not available in the project file manager.*\/ops\/env/u;

  async function withProject(run: (root: string, fixture: string) => Promise<void>): Promise<void> {
    const fixture = await mkdtemp(path.join(tmpdir(), 'zhin-project-dotenv-'));
    const root = path.join(fixture, 'project');
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      for (const name of ['.env', '.env.local', '.env.development', '.env.production', '.env.staging']) {
        await writeFile(path.join(root, name), `SECRET=${name}`);
      }
      await run(root, fixture);
    } finally { await rm(fixture, { recursive: true, force: true }); }
  }

  it('lists no dotenv file in the tree while the env inventory still sees them', async () => {
    await withProject(async (root) => {
      await writeFile(path.join(root, 'src/.env'), 'SECRET=nested');
      await writeFile(path.join(root, 'src/index.ts'), 'export {};');
      const tree = await buildProjectFileTree(root);
      expect(JSON.stringify(tree)).not.toMatch(/\.env/u);
      expect(tree.find(entry => entry.name === 'src')?.children?.map(entry => entry.name)).toEqual(['index.ts']);
      expect(await listEnvFiles(root)).toEqual([
        { name: '.env', exists: true },
        { name: '.env.development', exists: true },
        { name: '.env.production', exists: true },
      ]);
    });
  });

  const bypasses = [
    '.env', '.env.local', '.env.development', '.env.production', '.env.staging',
    // case
    '.ENV', '.Env.Local', '.env.PRODUCTION',
    // leading ./ and backslashes, duplicated separators
    './.env', '.\\.env', './/.env', 'src/./../.env', 'src\\..\\.env',
    // parent traversal
    '../project/.env', 'src/../.env', 'knowledge/../.env',
    // trailing slash, space, dot, NTFS stream
    '.env/', '.env ', '.env.', '.env. .', '.env::$DATA', '.env.local ',
    // URL encoding
    '%2Eenv', '%2eENV', '.%65nv', '%2Eenv%2Elocal', 'src/%2Eenv', '%2E%2E/.env',
    // nested in allowed directories
    'src/.env', 'plugins/demo/.env.production', 'knowledge/.env', 'src/.env/inner.txt',
    // control characters
    '.env\u0000.txt', '.env\n',
  ];

  it.each(bypasses)('refuses to read or write %j', async (relativePath) => {
    await withProject(async (root) => {
      expect(isProjectPathAllowed(relativePath)).toBe(false);
      await expect(readProjectFile(root, relativePath)).rejects.toThrow('Access denied');
      await expect(saveProjectFile(root, relativePath, 'SECRET=overwritten')).rejects.toThrow('Access denied');
      for (const name of ['.env', '.env.local', '.env.development', '.env.production', '.env.staging']) {
        expect(await readFile(path.join(root, name), 'utf8')).toBe(`SECRET=${name}`);
      }
      await expect(readFile(path.join(root, 'src/.env'))).rejects.toThrow();
    });
  });

  it('names /ops/env in the error for direct dotenv paths', async () => {
    await withProject(async (root) => {
      for (const relativePath of ['.env', '.ENV.local', './.env.production', '%2Eenv', '.env ', 'src/.env']) {
        await expect(readProjectFile(root, relativePath)).rejects.toThrow(DOTENV_ERROR);
        await expect(saveProjectFile(root, relativePath, 'x')).rejects.toThrow(DOTENV_ERROR);
      }
    });
  });

  it('refuses links that resolve to a dotenv file or directory', async () => {
    await withProject(async (root, fixture) => {
      await symlink('../.env', path.join(root, 'src/config.txt'));
      await symlink(path.join(root, '.env.local'), path.join(root, 'src/absolute.txt'));
      await symlink(path.join(root, '.env.production'), path.join(root, 'README.md'));
      await mkdir(path.join(root, '.env.d'));
      await writeFile(path.join(root, '.env.d/secret.txt'), 'SECRET=dir');
      await symlink('../.env.d', path.join(root, 'src/envdir'));
      await symlink(root, path.join(fixture, 'alias'));
      for (const relativePath of ['src/config.txt', 'src/absolute.txt', 'README.md', 'src/envdir/secret.txt', 'src/envdir/new.txt']) {
        await expect(readProjectFile(root, relativePath)).rejects.toThrow('Access denied');
        await expect(saveProjectFile(root, relativePath, 'SECRET=overwritten')).rejects.toThrow('Access denied');
      }
      await expect(readProjectFile(path.join(fixture, 'alias'), '.env')).rejects.toThrow(DOTENV_ERROR);
      expect(await readFile(path.join(root, '.env'), 'utf8')).toBe('SECRET=.env');
      expect(await readFile(path.join(root, '.env.local'), 'utf8')).toBe('SECRET=.env.local');
      expect(await readFile(path.join(root, '.env.production'), 'utf8')).toBe('SECRET=.env.production');
      await expect(readFile(path.join(root, '.env.d/new.txt'))).rejects.toThrow();
      const tree = JSON.stringify(await buildProjectFileTree(root));
      expect(tree).not.toContain('config.txt');
      expect(tree).not.toContain('absolute.txt');
      expect(tree).not.toContain('README.md');
      expect(tree).not.toContain('envdir');
    });
  });

  it('opens the Agent bootstrap files and the knowledge directory', async () => {
    await withProject(async (root) => {
      const paths = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'HEARTBEAT.md', 'knowledge/faq.md', 'knowledge/guides/setup.txt'];
      for (const relativePath of paths) {
        expect(isProjectPathAllowed(relativePath)).toBe(true);
        await saveProjectFile(root, relativePath, `# ${relativePath}`);
        await expect(readProjectFile(root, relativePath)).resolves.toMatchObject({ content: `# ${relativePath}` });
      }
      const tree = await buildProjectFileTree(root);
      expect(tree.map(entry => entry.name)).toEqual(expect.arrayContaining(['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'HEARTBEAT.md', 'knowledge']));
      const knowledge = tree.find(entry => entry.name === 'knowledge');
      expect(knowledge?.children?.map(entry => entry.name)).toEqual(['guides', 'faq.md']);
      expect(isProjectPathAllowed('knowledge/node_modules/x.md')).toBe(false);
      expect(isProjectPathAllowed('MEMORY.md')).toBe(false);
    });
  });

  it('refuses dot files and dot directories anywhere in the path (#1250 review)', async () => {
    await withProject(async (root) => {
      await mkdir(path.join(root, 'knowledge', '.private'), { recursive: true });
      await writeFile(path.join(root, 'knowledge', '.envrc'), 'export TOKEN=fake-envrc-secret\n');
      await writeFile(path.join(root, 'knowledge', '.npmrc'), '//registry.npmjs.org/:_authToken=fake-npm-secret\n');
      await writeFile(path.join(root, 'knowledge', '.private', 'notes.md'), 'fake-private');
      const refused = [
        'knowledge/.envrc', 'knowledge/.npmrc', 'knowledge/.private/notes.md', 'src/.git-credentials', 'skills/x/.netrc',
        'knowledge/%2Eenvrc', './knowledge/.npmrc', 'knowledge\\.npmrc', '.npmrc', '.envrc',
      ];
      for (const relativePath of refused) {
        expect(isProjectPathAllowed(relativePath), relativePath).toBe(false);
        await expect(readProjectFile(root, relativePath), relativePath).rejects.toThrow(/Access denied/u);
        await expect(saveProjectFile(root, relativePath, 'overwritten'), relativePath).rejects.toThrow(/Access denied/u);
      }
      expect(await readFile(path.join(root, 'knowledge', '.envrc'), 'utf8')).toBe('export TOKEN=fake-envrc-secret\n');
      const tree = JSON.stringify(await buildProjectFileTree(root));
      expect(tree).not.toMatch(/\.envrc|\.npmrc|\.private/u);
      // Names that merely contain a dot stay allowed.
      expect(isProjectPathAllowed('knowledge/a.b.md')).toBe(true);
      expect(isProjectPathAllowed('knowledge/./faq.md')).toBe(true);
    });
  });
});
