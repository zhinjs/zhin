import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEnvStore, defineRuntimeEnvironment } from '@zhin.js/runtime';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import {
  MAX_RESPAWNS_PER_MINUTE,
  hasAgentConfiguration,
  parseStartOptions,
  planRespawn,
  processRestartExitCode,
  loadRuntimeEnvironmentLayers,
} from '../../src/plugin-runtime/start-command.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('native TypeScript relaunch respawn (exit 75)', () => {
  it('parses the optional Remote Console launch flag', () => {
    expect(parseStartOptions(['--open'])).toMatchObject({
      open: true,
      once: false,
      noWatch: false,
    });
  });

  it('does not load the optional Agent Host for explicitly disabled sections', () => {
    expect(hasAgentConfiguration({ ai: { enabled: false } })).toBe(false);
    expect(hasAgentConfiguration({ ai: { enabled: true } })).toBe(true);
    expect(hasAgentConfiguration({ assistant: {} })).toBe(true);
  });

  it.each(['workrooms', 'remoteAgents', 'remote_mesh', 'remoteMesh'])(
    'rejects removed ai.%s before the disabled-Agent short circuit',
    (legacyKey) => {
      expect(() => hasAgentConfiguration({
        ai: { enabled: false, [legacyKey]: {} },
      })).toThrow(`ai.${legacyKey}`);
    },
  );

  it('respawns on exit 75 in non-once mode and records the attempt', () => {
    const now = Date.now();
    const plan = planRespawn(processRestartExitCode, false, false, [], now);
    expect(plan.respawn).toBe(true);
    expect(plan.attempts).toEqual([now]);
  });

  it('never respawns in once mode', () => {
    const plan = planRespawn(processRestartExitCode, true, false, [], Date.now());
    expect(plan.respawn).toBe(false);
  });

  it('does not respawn for ordinary exit codes', () => {
    const now = Date.now();
    expect(planRespawn(0, false, false, [], now).respawn).toBe(false);
    expect(planRespawn(1, false, false, [], now).respawn).toBe(false);
    expect(planRespawn(null, false, false, [], now).respawn).toBe(false);
  });

  it('stops respawning once the per-minute storm budget is exhausted', () => {
    const now = Date.now();
    let attempts: readonly number[] = [];
    for (let index = 0; index < MAX_RESPAWNS_PER_MINUTE; index += 1) {
      const plan = planRespawn(processRestartExitCode, false, false, attempts, now + index * 1_000);
      expect(plan.respawn).toBe(true);
      attempts = plan.attempts;
    }
    const denied = planRespawn(processRestartExitCode, false, false, attempts, now + 60_000 - 1);
    expect(denied.respawn).toBe(false);
  });

  it('forgets attempts older than the one-minute window', () => {
    const now = Date.now();
    const stale = Array.from(
      { length: MAX_RESPAWNS_PER_MINUTE },
      (_value, index) => now - 61_000 - index,
    );
    const plan = planRespawn(processRestartExitCode, false, false, stale, now);
    expect(plan.respawn).toBe(true);
    expect(plan.attempts).toEqual([now]);
  });

  it('daemon mode respawns on crash exits', () => {
    const now = Date.now();
    expect(planRespawn(1, false, true, [], now).respawn).toBe(true);
    expect(planRespawn(1, false, false, [], now).respawn).toBe(false);
    expect(planRespawn(0, false, true, [], now).respawn).toBe(false);
    expect(planRespawn(1, true, true, [], now).respawn).toBe(false);
  });

  it('loads development dotenv files through Runtime layers without mutating process.env', async () => {
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
