import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConfigDocument } from '@zhin.js/runtime';
import { FeatureOverrideStore, type FeatureOverrideWrite } from '../../src/instance/console/feature-override-store.js';
import {
  FEATURE_OVERRIDE_MIGRATION_FILE, FeatureOverrideMigrationReferenceError, LegacyFeatureOverrideConfigError,
  prepareFeatureOverrideMigration, readLegacyFeatureOverrideConfig,
} from '../../src/instance/feature-override-migration.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

const LEGACY_YAML = `configVersion: 2
plugins:
  qq: "@x/qq"
  rss: "@x/rss"
  parent: "@x/parent"
# keep this comment
qq:
  endpoints:
    - id: bot-1
rss:
  maxItems: 5
  overrides:
    adapters:
      qq:
        enabled: false
        maxItems: 3
      tg:
        enabled: true
    endpoints:
      qq/bot-1:
        maxItems: 1
parent:
  label: p
  child:
    overrides:
      endpoints:
        qq/bot-1:
          enabled: false
`;

async function project(yaml = LEGACY_YAML) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-feature-override-migration-'));
  directories.push(root);
  const configFile = join(root, 'zhin.config.yml');
  await writeFile(configFile, yaml);
  return { root, configFile, config: createConfigDocument(configFile) };
}

function logger() {
  const lines: string[] = [];
  return { lines, logger: { info: (line: string) => { lines.push(`info ${line}`); }, warn: (line: string) => { lines.push(`warn ${line}`); } } };
}

const record = async (root: string) => JSON.parse(await readFile(join(root, FEATURE_OVERRIDE_MIGRATION_FILE), 'utf8')) as Record<string, any>;
const exists = async (file: string) => readFile(file).then(() => true, () => false);

async function start(root: string, configFile: string, store: FeatureOverrideStore, log = logger()) {
  const migration = await prepareFeatureOverrideMigration({ projectRoot: root, config: createConfigDocument(configFile), configFile, logger: log.logger, now: () => 1_700_000_000_000 });
  await migration.complete(store);
  await migration.finish();
  return migration;
}

describe('readLegacyFeatureOverrideConfig', () => {
  it('collects adapter / endpoint entries of top-level and nested blocks, skipping inherited enabled: true', () => {
    const legacy = readLegacyFeatureOverrideConfig({
      configVersion: 2, plugins: { rss: '@x/rss', parent: '@x/parent' },
      rss: { overrides: { adapters: { qq: { enabled: false, maxItems: 3 }, tg: { enabled: true } }, endpoints: { 'qq/bot-1': { maxItems: 1 } } } },
      parent: { child: { overrides: { endpoints: { 'qq/bot-1': { enabled: false } } } }, settings: { overrides: 'not a block' } },
    });
    expect(legacy.paths).toEqual([['rss', 'overrides'], ['parent', 'child', 'overrides']]);
    expect(legacy.entries).toEqual([
      { plugin: 'rss', level: 'adapter', key: 'qq', enabled: false, patch: { maxItems: 3 }, source: 'rss.overrides.adapters.qq' },
      { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', patch: { maxItems: 1 }, source: 'rss.overrides.endpoints.qq/bot-1' },
      { plugin: 'parent/child', level: 'endpoint', key: 'qq/bot-1', enabled: false, patch: {}, source: 'parent.child.overrides.endpoints.qq/bot-1' },
    ]);
    expect(legacy.references).toEqual([]);
  });
});

describe('prepareFeatureOverrideMigration (ADR 0057 §2)', () => {
  it('imports into the store, backs up and removes the blocks atomically, records done, then refuses the blocks', async () => {
    const { root, configFile } = await project();
    const store = new FeatureOverrideStore();
    const log = logger();
    const migration = await prepareFeatureOverrideMigration({ projectRoot: root, config: createConfigDocument(configFile), configFile, logger: log.logger, now: () => 1_700_000_000_000 });
    expect(migration.done).toBe(false);
    expect(migration.pending).toHaveLength(3);
    // Still accepted while the import is pending.
    expect(() => migration.configUpdate.validate!({ next: { configVersion: 2, plugins: { rss: '@x/rss' }, rss: { overrides: { adapters: {} } } } } as never)).not.toThrow();
    await migration.complete(store);
    expect(store.get('rss', 'qq')).toMatchObject({ level: 'adapter', enabled: false, patch: { maxItems: 3 }, updatedBy: 'migration:rss.overrides.adapters.qq' });
    expect(store.get('rss', 'qq/bot-1')).toMatchObject({ level: 'endpoint', patch: { maxItems: 1 } });
    expect(store.get('parent/child', 'qq/bot-1')).toMatchObject({ enabled: false, patch: {} });
    expect(store.get('rss', 'tg')).toBeUndefined();
    expect((await record(root)).status).toBe('imported');
    // The file is only edited after the import succeeded.
    expect(await readFile(configFile, 'utf8')).toBe(LEGACY_YAML);
    await migration.finish();
    const after = await readFile(configFile, 'utf8');
    expect(after).not.toContain('overrides');
    expect(after).toContain('# keep this comment');
    expect(after).toContain('maxItems: 5');
    expect(after).toContain('label: p');
    const done = await record(root);
    expect(done).toMatchObject({ version: 1, status: 'done', completedAt: 1_700_000_000_000 });
    expect(done.entries).toHaveLength(3);
    expect(await readFile(join(root, done.backup), 'utf8')).toBe(LEGACY_YAML);
    expect(done.backup).toMatch(/^\.zhin\/backups\/feature-overrides-[^/]+\/zhin\.config\.yml$/u);
    expect(migration.done).toBe(true);
    expect(() => migration.configUpdate.validate!({ next: { configVersion: 2, plugins: { rss: '@x/rss' }, rss: { overrides: { adapters: {} } } } } as never))
      .toThrow(LegacyFeatureOverrideConfigError);
    expect(log.lines.some(line => line.includes('removed rss.overrides, parent.child.overrides'))).toBe(true);
    // A rerun is a no-op; a block added again stops startup with a pointer to the Console / chat command.
    await start(root, configFile, store);
    expect(await readFile(configFile, 'utf8')).toBe(after);
    await writeFile(configFile, `${after}tg:\n  overrides:\n    adapters:\n      qq:\n        enabled: false\n`.replace('plugins:\n', 'plugins:\n  tg: "@x/tg"\n'));
    const error = await prepareFeatureOverrideMigration({ projectRoot: root, config: createConfigDocument(configFile), configFile, logger: logger().logger })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LegacyFeatureOverrideConfigError);
    expect((error as Error).message).toMatch(/tg\.overrides.*Console feature page.*功能 设置/su);
  });

  it('records a project without blocks as done, so a block added later is refused', async () => {
    const { root, configFile } = await project('configVersion: 2\nplugins:\n  rss: "@x/rss"\nrss:\n  maxItems: 5\n');
    const migration = await start(root, configFile, new FeatureOverrideStore());
    expect(migration.done).toBe(true);
    expect(await record(root)).toMatchObject({ status: 'done', entries: [] });
    await writeFile(configFile, 'configVersion: 2\nplugins:\n  rss: "@x/rss"\nrss:\n  overrides:\n    endpoints:\n      qq/a:\n        maxItems: 1\n');
    await expect(prepareFeatureOverrideMigration({ projectRoot: root, config: createConfigDocument(configFile), configFile, logger: logger().logger }))
      .rejects.toBeInstanceOf(LegacyFeatureOverrideConfigError);
  });

  it('leaves the file untouched when the import fails part-way and retries next start without duplicating', async () => {
    const { root, configFile } = await project();
    let failAt = 2;
    let writes = 0;
    class FlakyStore extends FeatureOverrideStore {
      override write(input: FeatureOverrideWrite) {
        writes += 1;
        if (writes === failAt) return Promise.reject(new Error('database went away'));
        return super.write(input);
      }
    }
    // One store across both starts stands for the shared database.
    const store = new FlakyStore();
    const first = await prepareFeatureOverrideMigration({ projectRoot: root, config: createConfigDocument(configFile), configFile, logger: logger().logger });
    await expect(first.complete(store)).rejects.toThrow('database went away');
    await first.finish();
    expect(await readFile(configFile, 'utf8')).toBe(LEGACY_YAML);
    expect(await exists(join(root, FEATURE_OVERRIDE_MIGRATION_FILE))).toBe(false);
    expect(store.list()).toHaveLength(1);
    expect(await exists(join(root, '.zhin', 'backups'))).toBe(false);
    failAt = 0;
    // An override changed in the Console between the two starts is kept (the database wins).
    await store.write({ plugin: 'rss', key: 'qq', next: () => ({ patch: { maxItems: 8 } }) });
    const log = logger();
    await start(root, configFile, store, log);
    expect(store.get('rss', 'qq')).toMatchObject({ patch: { maxItems: 8 }, revision: 2 });
    expect(store.list()).toHaveLength(3);
    expect(log.lines.some(line => line.includes('wrote 2 override(s)') && line.includes('kept 1 already stored'))).toBe(true);
    expect(await readFile(configFile, 'utf8')).not.toContain('overrides');
    expect((await record(root)).status).toBe('done');
  });

  it('keeps the file when it changed after the import (revision check) and finishes on the next start', async () => {
    const { root, configFile } = await project();
    const store = new FeatureOverrideStore();
    const log = logger();
    const migration = await prepareFeatureOverrideMigration({ projectRoot: root, config: createConfigDocument(configFile), configFile, logger: log.logger });
    await migration.complete(store);
    const edited = LEGACY_YAML.replace('maxItems: 5', 'maxItems: 6');
    await writeFile(configFile, edited);
    await migration.finish();
    expect(await readFile(configFile, 'utf8')).toBe(edited);
    expect((await record(root)).status).toBe('imported');
    expect(migration.done).toBe(false);
    expect(log.lines.some(line => line.startsWith('warn Feature overrides: the configuration file was left unchanged'))).toBe(true);
    const next = await start(root, configFile, store);
    expect(next.done).toBe(true);
    const after = await readFile(configFile, 'utf8');
    expect(after).toContain('maxItems: 6');
    expect(after).not.toContain('overrides');
    expect(store.list()).toHaveLength(3);
    expect((await readdir(join(root, '.zhin', 'backups'))).length).toBeGreaterThanOrEqual(1);
  });

  it('stops before any change when an entry references the environment', async () => {
    const yaml = LEGACY_YAML.replace('        maxItems: 1\n', '        title: ${RSS_TITLE}\n');
    const { root, configFile } = await project(yaml);
    const error = await prepareFeatureOverrideMigration({ projectRoot: root, config: createConfigDocument(configFile), configFile, logger: logger().logger })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FeatureOverrideMigrationReferenceError);
    expect((error as Error).message).toContain('rss.overrides.endpoints.qq/bot-1');
    expect(await readFile(configFile, 'utf8')).toBe(yaml);
    expect(await exists(join(root, FEATURE_OVERRIDE_MIGRATION_FILE))).toBe(false);
  });

  it('holds the entries in memory without a relational database and leaves the file and the record pending', async () => {
    const { root, configFile } = await project();
    const store = new FeatureOverrideStore({ database: { dialect: 'redis', started: true, models: { get: () => undefined } } as never });
    await store.load();
    const log = logger();
    const migration = await start(root, configFile, store, log);
    expect(store.get('rss', 'qq')).toMatchObject({ enabled: false, patch: { maxItems: 3 } });
    expect(await readFile(configFile, 'utf8')).toBe(LEGACY_YAML);
    expect(await record(root)).toMatchObject({ status: 'pending', memoryOnlyAt: 1_700_000_000_000 });
    expect(migration.done).toBe(false);
    expect(log.lines.some(line => line.startsWith('warn Feature overrides: 3 override(s)'))).toBe(true);
  });
});
