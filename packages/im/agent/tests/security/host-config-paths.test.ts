import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyHostPath,
  createHostProtectedPaths,
  hostConfigWriteTarget,
  hostWriteImpact,
  type HostProtectedPaths,
} from '../../src/security/host-config-paths.js';

let root: string;
let outside: string;
let paths: HostProtectedPaths;

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'zhin-protected-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'zhin-outside-')));
  mkdirSync(join(root, 'plugins', 'x'), { recursive: true });
  mkdirSync(join(root, 'skills', 'demo'), { recursive: true });
  writeFileSync(join(root, 'zhin.config.yml'), 'ai: {}\n');
  writeFileSync(join(root, 'package.json'), '{}');
  symlinkSync(join(root, 'zhin.config.yml'), join(root, 'plugins', 'x', 'innocent.md'));
  symlinkSync(join(root, 'node_modules-link-target'), join(root, 'plugins', 'dangling'));
  paths = await createHostProtectedPaths({
    projectRoot: root,
    selfFiles: ['plugin.ts'],
    denyFiles: [join(root, 'state', 'lifecycle.json')],
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const classify = (rel: string) => classifyHostPath(join(root, rel), paths);

describe('classifyHostPath with an injected project root', () => {
  it.each([
    'zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json', 'config.yml', 'config.yaml',
    'package.json', 'schema.json', 'AGENTS.md', 'plugin.ts', '.pnpmfile.cjs', 'assistant.profile.yml',
    'skills/demo/SKILL.md', 'skills', '.agents/skills/x/SKILL.md', '.git/hooks/pre-commit',
  ])('B (self): %s', (rel) => {
    expect(classify(rel)).toBe('self');
  });

  it.each([
    'node_modules/zhin.js/lib/index.js', 'plugins/x/node_modules/y/index.js', 'pnpm-lock.yaml', 'package-lock.json',
    'yarn.lock', 'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json', 'state/lifecycle.json',
    // already refused by file-policy for every file tool; a root config.json candidate therefore never reaches B
    'config.json', '.env', '.env.local', '.npmrc', '.zhin/plugin-lifecycle.json', 'data/secrets.txt',
  ])('A (deny): %s', (rel) => {
    expect(classify(rel)).toBe('deny');
  });

  it.each([
    'plugins/x/package.json', 'plugins/x/zhin.config.yml', 'src/schema.json', 'docs/AGENTS.md', 'src/skills/a.ts',
    'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.build.json', 'notes.md', 'data/memory/global/today.md', 'package.json.bak',
    'plugins/x/pnpm-lock.yaml', '.gitignore',
  ])('unmanaged: %s', (rel) => {
    expect(classify(rel)).toBeUndefined();
  });

  it('does not match outside the project root', () => {
    expect(classifyHostPath(join(outside, 'package.json'), paths)).toBeUndefined();
    expect(classifyHostPath(join(outside, 'pnpm-lock.yaml'), paths)).toBeUndefined();
    // node_modules is denied anywhere.
    expect(classifyHostPath(join(outside, 'node_modules', 'a.js'), paths)).toBe('deny');
  });

  it('collapses ../ before matching', () => {
    expect(classify('plugins/x/../../package.json')).toBe('self');
    expect(classify('plugins/../pnpm-lock.yaml')).toBe('deny');
    expect(classify('package.json/../plugins/x/package.json')).toBeUndefined();
    expect(classifyHostPath('plugins/../package.json', paths)).toBe('self'); // relative: anchored at the root
  });

  it('follows symlinks', () => {
    expect(classify('plugins/x/innocent.md')).toBe('self');
    expect(classify('plugins/dangling')).toBeUndefined();
  });

  it('folds case', () => {
    expect(classify('ZHIN.CONFIG.YML')).toBe('self');
    expect(classify('Package.JSON')).toBe('self');
    expect(classify('PNPM-LOCK.YAML')).toBe('deny');
    expect(classify('Node_Modules/a.js')).toBe('deny');
    expect(classify('SKILLS/demo/SKILL.md')).toBe('self');
  });

  it('accepts windows-style separators', () => {
    expect(classifyHostPath(`${root.replace(/\//g, '\\')}\\plugins\\x\\..\\..\\package.json`, paths)).toBe('self');
  });

  it('handles empty input', () => {
    expect(classifyHostPath('', paths)).toBeUndefined();
    expect(classifyHostPath('   ', paths)).toBeUndefined();
  });
});

describe('classifyHostPath without an injected root (fail closed)', () => {
  it('matches the same names at any depth instead of gating nothing', () => {
    expect(classifyHostPath('/ws/package.json', undefined)).toBe('self');
    expect(classifyHostPath('/ws/plugins/x/package.json', undefined)).toBe('self');
    expect(classifyHostPath('/ws/zhin.config.yml', undefined)).toBe('self');
    expect(classifyHostPath('/ws/.git/hooks/post-checkout', undefined)).toBe('self');
    expect(classifyHostPath('/ws/pnpm-lock.yaml', undefined)).toBe('deny');
    expect(classifyHostPath('/ws/node_modules/a/b.js', undefined)).toBe('deny');
    expect(classifyHostPath('/ws/notes.md', undefined)).toBeUndefined();
    expect(classifyHostPath('/ws/pnpm-workspace.yaml', undefined)).toBeUndefined();
    expect(classifyHostPath('/ws/tsconfig.json', undefined)).toBeUndefined();
  });
});

describe('hostWriteImpact', () => {
  it('judges file tools by their target path', () => {
    expect(hostWriteImpact('write_file', { file_path: join(root, 'zhin.config.yml') }, paths))
      .toEqual({ level: 'self', target: join(root, 'zhin.config.yml') });
    expect(hostWriteImpact('edit_file', { file_path: join(root, 'pnpm-lock.yaml') }, paths)?.level).toBe('deny');
    expect(hostWriteImpact('delete_file', { file_path: join(root, 'node_modules/a.js') }, paths)?.level).toBe('deny');
    expect(hostWriteImpact('apply_patch', { path: join(root, 'package.json') }, paths)?.level).toBe('self');
    expect(hostWriteImpact('write_file', { file_path: join(root, 'plugins/x/package.json') }, paths)).toBeUndefined();
    expect(hostWriteImpact('write_file', { file_path: join(root, 'notes.md') }, paths)).toBeUndefined();
    // Reading config is not a self-change.
    expect(hostWriteImpact('read_file', { file_path: join(root, 'zhin.config.yml') }, paths)).toBeUndefined();
  });

  it.each([
    ['echo "a: 1" >> zhin.config.yml', 'self', 'zhin.config.yml'],
    ['echo x >zhin.config.yml', 'self', 'zhin.config.yml'],
    ['cat patch | tee -a package.json', 'self', 'package.json'],
    ["sed -i 's/ask/bypass/' zhin.config.yml", 'self', 'zhin.config.yml'],
    ['cp evil.json package.json', 'self', 'package.json'],
    ['rm package.json', 'self', 'package.json'],
    ['pnpm add left-pad', 'self', 'package.json'],
    ['git config core.hooksPath x && cp hook .git/hooks/pre-commit', 'self', '.git/hooks/pre-commit'],
    ['echo > pnpm-lock.yaml', 'deny', 'pnpm-lock.yaml'],
    ['echo KEY=1 >> .env', 'deny', '.env'],
    ['rm .zhin/state.json', 'deny', '.zhin/state.json'],
    ['rm -rf node_modules', 'deny', 'node_modules'],
    ['rm -rf node_modules && pnpm install', 'deny', 'node_modules'],
    ['echo x > node_modules/a/index.js', 'deny', 'node_modules/a/index.js'],
  ])('flags the shell command %j as %s', (command, level, target) => {
    expect(hostWriteImpact('bash', { command, cwd: root }, paths)).toEqual({ level, target });
  });

  it.each([
    'cat zhin.config.yml', 'grep apiKey package.json', 'ls node_modules', 'pnpm test', 'git status',
    'echo hello > notes.md', 'cp a.txt plugins/x/package.json', 'cat pnpm-lock.yaml | head',
  ])('lets the shell command %j through', (command) => {
    expect(hostWriteImpact('bash', { command, cwd: root }, paths)).toBeUndefined();
  });

  it('resolves shell words against the command cwd', () => {
    expect(hostWriteImpact('bash', { command: 'echo x > package.json', cwd: join(root, 'plugins', 'x') }, paths)).toBeUndefined();
    expect(hostWriteImpact('bash', { command: 'echo x > ../../package.json', cwd: join(root, 'plugins', 'x') }, paths)?.level).toBe('self');
  });

  it('exposes only the target for audit', () => {
    expect(hostConfigWriteTarget('write_file', { file_path: join(root, 'package.json') }, paths)).toBe(join(root, 'package.json'));
    expect(hostConfigWriteTarget('write_file', { file_path: join(root, 'notes.md') }, paths)).toBeUndefined();
  });
});
