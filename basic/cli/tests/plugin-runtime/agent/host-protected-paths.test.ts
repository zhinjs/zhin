import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyHostPath } from '@zhin.js/agent';
import { resolveHostProtectedPaths } from '../../../src/plugin-runtime/agent/host-protected-paths.js';

describe('resolveHostProtectedPaths (#1030 P0)', () => {
  let root: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-host-protected-')));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('adds the root plugin entry (package.json#zhin.entry) to the self files', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ zhin: { entry: 'src/main-plugin.ts' } }));
    const paths = await resolveHostProtectedPaths(root, {});
    expect(classifyHostPath(join(root, 'src/main-plugin.ts'), paths)).toBe('self');
    expect(classifyHostPath(join(root, 'plugins/x/src/main-plugin.ts'), paths)).toBeUndefined();
    expect(classifyHostPath(join(root, 'zhin.config.yml'), paths)).toBe('self');
  });

  it('denies the plugin lifecycle file wherever ZHIN_PLUGIN_LIFECYCLE_FILE points', async () => {
    const lifecycle = join(root, 'ops', 'lifecycle.json');
    const paths = await resolveHostProtectedPaths(root, { ZHIN_PLUGIN_LIFECYCLE_FILE: lifecycle });
    expect(classifyHostPath(lifecycle, paths)).toBe('deny');
    expect(classifyHostPath(join(root, '.zhin/plugin-lifecycle.json'), paths)).toBe('deny');
  });

  it('still protects the defaults when package.json is missing or the lifecycle variable is invalid', async () => {
    const paths = await resolveHostProtectedPaths(root, { ZHIN_PLUGIN_LIFECYCLE_FILE: 'relative.json' });
    expect(classifyHostPath(join(root, 'package.json'), paths)).toBe('self');
    expect(classifyHostPath(join(root, 'pnpm-lock.yaml'), paths)).toBe('deny');
  });
});
