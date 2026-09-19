import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { createEnvStore, defineRuntimeEnvironment } from '@zhin.js/runtime';
import { loadRuntimeEnvironmentLayers } from '../../../src/plugin-runtime/start/environment.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('start environment', () => {
  it('loads the selected dotenv overlay without mutating process.env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-environment-'));
    temporary.push(root);
    await writeFile(join(root, '.env'), 'ZHIN_LAYER_BASE=base\nZHIN_LAYER_SHARED=base\n');
    await writeFile(join(root, '.env.development'), 'ZHIN_LAYER_SHARED=development\nZHIN_LAYER_DEV=dev\n');
    const before = process.env.ZHIN_LAYER_SHARED;

    const layers = await loadRuntimeEnvironmentLayers(root, 'development');
    const store = createEnvStore(
      rootPluginId(),
      defineRuntimeEnvironment({ name: 'development', mode: 'development', platform: 'node' }),
      layers,
    );

    expect(store.get('ZHIN_LAYER_BASE')).toBe('base');
    expect(store.get('ZHIN_LAYER_SHARED')).toBe('development');
    expect(store.get('ZHIN_LAYER_DEV')).toBe('dev');
    expect(process.env.ZHIN_LAYER_SHARED).toBe(before);
    expect(process.env.ZHIN_LAYER_BASE).toBeUndefined();
    expect(process.env.ZHIN_LAYER_DEV).toBeUndefined();
  });
});
