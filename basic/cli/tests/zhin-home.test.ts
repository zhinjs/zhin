import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { tmpdir } from 'os';

describe('zhin-home', () => {
  let workDir: string;
  let fakeHome: string;

  beforeEach(async () => {
    const base = path.join(tmpdir(), `zhin-home-${Date.now()}`);
    workDir = path.join(base, 'work');
    fakeHome = path.join(base, 'home');
    await fs.ensureDir(workDir);
    await fs.ensureDir(fakeHome);
  });

  afterEach(async () => {
    await fs.remove(path.dirname(workDir));
  });

  async function writeZhinProject(dir: string) {
    await fs.writeJson(path.join(dir, 'package.json'), {
      name: 'test-bot',
      dependencies: { 'zhin.js': '^1.0.0' },
    });
  }

  it('findProjectInstance detects cwd project', async () => {
    const { findProjectInstance } = await import('../src/utils/zhin-home.js');
    await writeZhinProject(workDir);
    const project = findProjectInstance(workDir);
    expect(project?.kind).toBe('project');
    expect(project?.root).toBe(path.resolve(workDir));
  });

  it('findGlobalInstance detects ~/.zhin', async () => {
    const { findGlobalInstance } = await import('../src/utils/zhin-home.js');
    const { scaffoldGlobalHome } = await import('../src/utils/global-home-init.js');
    scaffoldGlobalHome({ homeDir: fakeHome });
    const global = findGlobalInstance(fakeHome);
    expect(global?.kind).toBe('global');
    expect(global?.root).toBe(path.join(fakeHome, '.zhin'));
  });

  it('resolveProjectOrGlobal prefers project over global', async () => {
    const { resolveProjectOrGlobal } = await import('../src/utils/zhin-home.js');
    const { scaffoldGlobalHome } = await import('../src/utils/global-home-init.js');

    await writeZhinProject(workDir);
    scaffoldGlobalHome({ homeDir: fakeHome });

    const instance = resolveProjectOrGlobal(workDir, fakeHome);
    expect(instance?.kind).toBe('project');
    expect(instance?.root).toBe(path.resolve(workDir));
  });

  it('resolveProjectOrGlobal falls back to global when cwd is not a project', async () => {
    const { resolveProjectOrGlobal } = await import('../src/utils/zhin-home.js');
    const { scaffoldGlobalHome } = await import('../src/utils/global-home-init.js');

    scaffoldGlobalHome({ homeDir: fakeHome });

    const instance = resolveProjectOrGlobal(workDir, fakeHome);
    expect(instance?.kind).toBe('global');
    expect(instance?.root).toBe(path.join(fakeHome, '.zhin'));
  });

  it('scaffoldGlobalHome creates config without overwriting existing files', async () => {
    const { scaffoldGlobalHome } = await import('../src/utils/global-home-init.js');
    const { globalZhinHome } = await import('../src/utils/zhin-home.js');

    const root = scaffoldGlobalHome({ homeDir: fakeHome });
    expect(root).toBe(globalZhinHome(fakeHome));
    expect(fs.existsSync(path.join(root, 'zhin.config.yml'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'data'))).toBe(true);

    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'custom: true\n');
    scaffoldGlobalHome({ homeDir: fakeHome });
    expect(fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf8')).toBe('custom: true\n');
  });

  it('scaffoldGlobalHome uses latest runtime dependencies', async () => {
    const { scaffoldGlobalHome } = await import('../src/utils/global-home-init.js');

    const root = scaffoldGlobalHome({ homeDir: fakeHome });
    const pkg = await fs.readJson(path.join(root, 'package.json'));

    expect(pkg.dependencies['zhin.js']).toBe('latest');
    expect(pkg.dependencies['@zhin.js/adapter-sandbox']).toBe('latest');
    expect(pkg.dependencies['@zhin.js/host-api']).toBe('latest');
    expect(pkg.dependencies['@zhin.js/host-router']).toBe('latest');
  });

  it('buildSpawnEnv sets ZHIN_PROJECT_ROOT', async () => {
    const { buildSpawnEnv, ZHIN_PROJECT_ROOT_ENV } = await import('../src/utils/zhin-home.js');
    const env = buildSpawnEnv('/tmp/zhin-runtime', { NODE_ENV: 'test' });
    expect(env[ZHIN_PROJECT_ROOT_ENV]).toBe('/tmp/zhin-runtime');
    expect(env.NODE_ENV).toBe('test');
  });
});
