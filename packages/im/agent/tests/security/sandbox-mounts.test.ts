import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHostProtectedPaths, toProtectedPathData } from '../../src/security/host-config-paths.js';
import {
  NODE_MODULES_SCAN_DEPTH,
  NODE_MODULES_SCAN_MAX_HITS,
  computeReadOnlyOverlays,
  missingMountPointDirs,
  overlayDockerArgs,
  removeMountPointDirs,
} from '../../src/security/sandbox-mounts.js';
import { buildDockerRunArgs } from '../../src/security/sandbox-docker.js';

let root: string;
const touch = (rel: string, body = 'x') => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
};
const targets = (overlays: ReturnType<typeof computeReadOnlyOverlays>) =>
  Object.fromEntries(overlays.map(o => [o.target, o.kind]));

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-ro-')));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('computeReadOnlyOverlays', () => {
  it('binds existing A+B paths and tmpfs-es missing directories, never missing files', async () => {
    touch('AGENTS.md');
    touch('package.json', '{}');
    touch('pnpm-lock.yaml');
    touch('.env.local');
    touch('src/index.ts');
    fs.mkdirSync(path.join(root, '.git'));
    const paths = await createHostProtectedPaths({ projectRoot: root });
    const t = targets(computeReadOnlyOverlays(root, toProtectedPathData(paths)));
    expect(t['AGENTS.md']).toBe('bind-file');
    expect(t['package.json']).toBe('bind-file');
    expect(t['pnpm-lock.yaml']).toBe('bind-file');
    expect(t['.env.local']).toBe('bind-file');
    expect(t['.git']).toBe('bind-dir');
    expect(t['skills']).toBe('tmpfs-dir');
    expect(t['.agents/skills']).toBe('tmpfs-dir');
    expect(t['node_modules']).toBe('tmpfs-dir');
    // missing files get no placeholder
    expect(t['zhin.config.yml']).toBeUndefined();
    expect(t['yarn.lock']).toBeUndefined();
    expect(t['src/index.ts']).toBeUndefined();
  });

  it('does not tmpfs a missing .git', async () => {
    const paths = await createHostProtectedPaths({ projectRoot: root });
    expect(targets(computeReadOnlyOverlays(root, toProtectedPathData(paths)))['.git']).toBeUndefined();
  });

  it('includes host-declared extras and deny files inside the mount', async () => {
    touch('src/plugin.ts');
    touch('life/lifecycle.json');
    const paths = await createHostProtectedPaths({
      projectRoot: root,
      selfFiles: ['src/plugin.ts'],
      denyFiles: [path.join(root, 'life/lifecycle.json')],
    });
    const t = targets(computeReadOnlyOverlays(root, toProtectedPathData(paths)));
    expect(t['src/plugin.ts']).toBe('bind-file');
    expect(t['life/lifecycle.json']).toBe('bind-file');
  });

  it('keeps data/memory writable but protects other data children', async () => {
    fs.mkdirSync(path.join(root, 'data/memory'), { recursive: true });
    touch('data/app.db');
    const paths = await createHostProtectedPaths({ projectRoot: root });
    const t = targets(computeReadOnlyOverlays(root, toProtectedPathData(paths)));
    expect(t['data/app.db']).toBe('bind-file');
    expect(t['data/memory']).toBeUndefined();
  });

  it('only keeps entries inside the mounted directory', async () => {
    touch('AGENTS.md');
    touch('packages/a/src/x.ts');
    fs.mkdirSync(path.join(root, 'skills/foo'), { recursive: true });
    const paths = await createHostProtectedPaths({ projectRoot: root });
    const data = toProtectedPathData(paths);
    const sub = computeReadOnlyOverlays(path.join(root, 'packages/a'), data);
    // root-anchored paths are outside the mount; only the node_modules placeholder remains
    expect(sub.map(o => o.target)).toEqual(['node_modules']);
    const parent = computeReadOnlyOverlays(path.dirname(root), data);
    const rel = path.basename(root);
    expect(targets(parent)[`${rel}/AGENTS.md`]).toBe('bind-file');
    expect(targets(parent)[`${rel}/skills`]).toBe('bind-dir');
  });

  it('prunes entries below a directory overlay (skills/**, .git/**)', async () => {
    touch('skills/a/SKILL.md');
    touch('skills/a/node_modules/x/index.js');
    const paths = await createHostProtectedPaths({ projectRoot: root });
    const t = targets(computeReadOnlyOverlays(root, toProtectedPathData(paths)));
    expect(t['skills']).toBe('bind-dir');
    expect(Object.keys(t).some(k => k.startsWith('skills/'))).toBe(false);
  });

  it('scans node_modules to a bounded depth and never descends into them', () => {
    touch('a/node_modules/pkg/node_modules/inner/i.js');
    touch('a/b/c/d/e/node_modules/p.js'); // deeper than the scan bound
    touch('a/b/node_modules/p.js');
    const t = targets(computeReadOnlyOverlays(root, undefined));
    expect(NODE_MODULES_SCAN_DEPTH).toBe(4);
    expect(t['a/node_modules']).toBe('bind-dir');
    expect(t['a/b/node_modules']).toBe('bind-dir');
    expect(t['a/node_modules/pkg/node_modules']).toBeUndefined();
    expect(t['a/b/c/d/e/node_modules']).toBeUndefined();
  });

  it('caps the number of node_modules overlays', () => {
    for (let i = 0; i < NODE_MODULES_SCAN_MAX_HITS + 20; i += 1) touch(`p${i}/node_modules/x.js`);
    const count = computeReadOnlyOverlays(root, undefined).filter(o => o.target.endsWith('/node_modules')).length;
    expect(count).toBe(NODE_MODULES_SCAN_MAX_HITS);
  });

  it('fails closed without host data: conventional names relative to the mounted directory', () => {
    touch('AGENTS.md');
    touch('bun.lock');
    touch('package.json', '{}');
    fs.mkdirSync(path.join(root, '.git'));
    const t = targets(computeReadOnlyOverlays(root, undefined));
    expect(t['AGENTS.md']).toBe('bind-file');
    expect(t['bun.lock']).toBe('bind-file');
    expect(t['package.json']).toBe('bind-file');
    expect(t['.git']).toBe('bind-dir');
    expect(t['skills']).toBe('tmpfs-dir');
  });

  it('matches case-insensitively and binds the real file name', () => {
    touch('Agents.MD');
    expect(targets(computeReadOnlyOverlays(root, undefined))['Agents.MD']).toBe('bind-file');
  });

  it('returns nothing for an unreadable mount directory', () => {
    expect(computeReadOnlyOverlays(path.join(root, 'nope'), undefined)).toEqual([]);
  });
});

describe('docker argument building', () => {
  const overlays = [
    { kind: 'bind-file', target: 'AGENTS.md', source: '/host/ws/AGENTS.md' },
    { kind: 'bind-dir', target: 'a/node_modules', source: '/host/ws/a/node_modules' },
    { kind: 'tmpfs-dir', target: 'skills' },
  ] as const;

  it('appends overlays after a writable workspace mount', () => {
    const args = buildDockerRunArgs('echo hi', { filesystemAccess: 'workspace-write', readOnlyOverlays: overlays }, '/host/ws');
    const v = args.indexOf('-v');
    expect(args[v + 1]).toBe('/host/ws:/workspace:rw');
    const mounts = args.flatMap((a, i) => (a === '--mount' ? [args[i + 1]] : []));
    expect(mounts).toEqual([
      'type=bind,source=/host/ws/AGENTS.md,target=/workspace/AGENTS.md,readonly',
      'type=bind,source=/host/ws/a/node_modules,target=/workspace/a/node_modules,readonly',
      'type=tmpfs,target=/workspace/skills,tmpfs-size=4096,readonly',
    ]);
    expect(args.indexOf('--mount')).toBeGreaterThan(v);
    expect(args.slice(-3)).toEqual(['sh', '-c', 'echo hi']);
  });

  it('adds no overlays to a read-only mount', () => {
    const args = buildDockerRunArgs('ls', { filesystemAccess: 'read-only', readOnlyOverlays: overlays }, '/host/ws');
    expect(args).toContain('/host/ws:/workspace:ro');
    expect(args).not.toContain('--mount');
  });

  it('CSV-quotes paths containing commas or quotes', () => {
    const [flag, value] = overlayDockerArgs([{ kind: 'bind-file', target: 'a,b.md', source: '/h/"w",s/a,b.md' }]);
    expect(flag).toBe('--mount');
    expect(value).toBe('type=bind,"source=/h/""w"",s/a,b.md","target=/workspace/a,b.md",readonly');
  });
});

describe('mount point cleanup', () => {
  it('removes only the empty directories Docker would have created', () => {
    fs.mkdirSync(path.join(root, '.agents'));
    const overlays = [{ kind: 'tmpfs-dir', target: '.agents/skills' }, { kind: 'tmpfs-dir', target: 'skills' }] as const;
    const created = missingMountPointDirs(root, overlays);
    expect(created).toEqual([path.join(root, '.agents/skills'), path.join(root, 'skills')]);
    for (const dir of created) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'kept.txt'), 'x');
    removeMountPointDirs(created);
    expect(fs.existsSync(path.join(root, '.agents/skills'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.agents'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'skills/kept.txt'))).toBe(true);
  });
});
