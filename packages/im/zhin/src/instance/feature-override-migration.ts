/**
 * ADR 0057 §2: one-time move of the configuration file's per adapter / account feature overrides
 * (`<instance>.overrides.adapters` / `.overrides.endpoints`, ADR 0050) into the project database
 * (`feature_overrides`).
 *
 * Order (each step only after the previous one succeeded, so a failure leaves the configuration
 * file untouched and the next start retries):
 *
 * 1. Before the Runtime reads the configuration ({@link prepareFeatureOverrideMigration}): find the
 *    blocks. A block whose values hold environment references (`${…}` / `env://…`) stops startup:
 *    stored overrides are never environment-expanded, so the reference must become a literal or
 *    move to the global block first.
 * 2. Once the database is loaded ({@link FeatureOverrideMigration.complete}): write every entry
 *    that has no stored row yet (an existing row or tombstone wins; reruns are idempotent), then
 *    record `imported` in `.zhin/migrations/feature-overrides.json`.
 * 3. After the first generation started ({@link FeatureOverrideMigration.finish}): copy the file to
 *    `.zhin/backups/feature-overrides-<time>/`, remove the blocks through the configuration
 *    document (`prepare` / `commit`: atomic write, compare-and-swap on the revision read in step 1;
 *    the same path the chat-role migration of ADR 0056 uses at startup, before the gateway hands
 *    configuration writes to Console transactions), then record `done`.
 *
 * Until `done`, a block in the file is accepted (and ignored by resolution, which reads the
 * database). Afterwards an `overrides` block stops startup and is refused on every configuration
 * update ({@link LegacyFeatureOverrideConfigError}).
 *
 * Without a relational database the entries take effect in memory only (writes are refused on
 * such a store); the file keeps its blocks and the record stays pending (`memoryOnlyAt`) until a
 * relational database is configured.
 */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  FEATURE_ENABLED_KEY, FEATURE_OVERRIDES_KEY, readPluginConfigurationMap,
  type ConfigDocumentPort, type ConfigDocumentSnapshot, type RootConfigUpdateHandler, type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { containsEnvironmentReference, type FeatureOverrideStore } from './console/module.js';

export const FEATURE_OVERRIDE_UPGRADE_GUIDE = 'docs/migrations/feature-overrides.md';
export const FEATURE_OVERRIDE_MIGRATION_FILE = join('.zhin', 'migrations', 'feature-overrides.json');
export const FEATURE_OVERRIDE_BACKUP_DIRECTORY = join('.zhin', 'backups');

export interface LegacyFeatureOverride {
  /** Instance path (`rss`, `parent/child`). */
  readonly plugin: string;
  readonly level: 'adapter' | 'endpoint';
  readonly key: string;
  readonly enabled?: false;
  readonly patch: Readonly<Record<string, unknown>>;
  /** Configuration path it came from, e.g. `rss.overrides.endpoints.qq/bot-1`. */
  readonly source: string;
}

export interface LegacyFeatureOverrideConfig {
  readonly entries: readonly LegacyFeatureOverride[];
  /** `overrides` blocks to remove (`['rss', 'overrides']`). */
  readonly paths: readonly (readonly string[])[];
  /** Entries whose values hold environment references (they stop the migration). */
  readonly references: readonly string[];
}

export class LegacyFeatureOverrideConfigError extends Error {
  readonly code = 'LEGACY_FEATURE_OVERRIDES';
  constructor(readonly fields: readonly string[]) {
    super(`Configuration still has per adapter / account feature overrides: ${fields.join(', ')}. `
      + 'They live in the project database now (feature_overrides, ADR 0057): change them on the Console feature page '
      + 'or in chat with `功能 设置 <插件> <字段> <值> 账号|适配器` (`feature set <plugin> <field> <value> endpoint|adapter`), '
      + `then remove the block from the configuration file. See ${FEATURE_OVERRIDE_UPGRADE_GUIDE}.`);
    this.name = 'LegacyFeatureOverrideConfigError';
  }
}

export class FeatureOverrideMigrationReferenceError extends Error {
  readonly code = 'FEATURE_OVERRIDE_MIGRATION_REFERENCE';
  constructor(readonly fields: readonly string[]) {
    super(`Feature overrides cannot move to the project database while they reference environment variables: ${fields.join(', ')}. `
      + 'Stored overrides are never expanded: replace the ${…} / env:// value with a literal, or move the field to the plugin\'s global block, '
      + `then start again (the configuration file was not changed). See ${FEATURE_OVERRIDE_UPGRADE_GUIDE}.`);
    this.name = 'FeatureOverrideMigrationReferenceError';
  }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const INSTANCE_KEY = /^[a-z0-9][a-z0-9-]*$/u;

/** A legacy block: an object with only `adapters` / `endpoints`, each mapping keys to objects. */
function isOverrideBlock(value: unknown): value is Record<string, Record<string, unknown>> {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(key => (key === 'adapters' || key === 'endpoints') && record(value[key]));
}

/** Legacy `overrides` blocks of every declared instance and its nested child blocks. */
export function readLegacyFeatureOverrideConfig(document: RuntimeConfigDocument): LegacyFeatureOverrideConfig {
  const entries: LegacyFeatureOverride[] = [];
  const paths: string[][] = [];
  const references: string[] = [];
  let plugins: Readonly<Record<string, unknown>>;
  try { plugins = readPluginConfigurationMap(document); } catch { plugins = {}; }
  const visit = (path: readonly string[], block: unknown, depth: number): void => {
    if (!record(block) || depth > 8) return;
    const overrides = block[FEATURE_OVERRIDES_KEY];
    if (overrides !== undefined && (depth === 0 || isOverrideBlock(overrides))) {
      paths.push([...path, FEATURE_OVERRIDES_KEY]);
      if (record(overrides)) {
        for (const level of ['adapter', 'endpoint'] as const) {
          const group = overrides[`${level}s`];
          if (!record(group)) continue;
          for (const [key, entry] of Object.entries(group)) {
            if (!record(entry)) continue;
            const source = `${[...path, FEATURE_OVERRIDES_KEY, `${level}s`].join('.')}.${key}`;
            const { [FEATURE_ENABLED_KEY]: enabled, ...patch } = entry;
            if (containsEnvironmentReference(patch)) { references.push(source); continue; }
            // `enabled: true` is the inherited default and never stored.
            if (enabled !== false && Object.keys(patch).length === 0) continue;
            entries.push(Object.freeze({ plugin: path.join('/'), level, key, ...(enabled === false ? { enabled: false as const } : {}),
              patch: Object.freeze(structuredClone(patch)), source }));
          }
        }
      }
    }
    // Nested child Plugin blocks (`parent.child.overrides`).
    for (const [key, child] of Object.entries(block)) {
      if (key !== FEATURE_OVERRIDES_KEY && INSTANCE_KEY.test(key) && record(child)) visit([...path, key], child, depth + 1);
    }
  };
  for (const [alias, block] of Object.entries(plugins)) visit([alias], block, 0);
  return Object.freeze({ entries: Object.freeze(entries), paths: Object.freeze(paths), references: Object.freeze(references) });
}

interface MigrationRecord {
  readonly version: 1;
  readonly status: 'pending' | 'imported' | 'done';
  readonly entries: readonly LegacyFeatureOverride[];
  readonly startedAt: number;
  readonly importedAt?: number;
  readonly completedAt?: number;
  /** Copy of the configuration file taken before the blocks were removed (project-relative). */
  readonly backup?: string;
  /** Last start that could only apply the entries in memory (no relational database). */
  readonly memoryOnlyAt?: number;
}

async function readRecord(file: string): Promise<MigrationRecord | undefined> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return undefined; }
  const value = JSON.parse(text) as Partial<MigrationRecord>;
  if (value.version !== 1 || !['pending', 'imported', 'done'].includes(String(value.status)) || !Array.isArray(value.entries)) {
    throw new Error(`${file} is malformed; restore it or delete it after checking feature_overrides (${FEATURE_OVERRIDE_UPGRADE_GUIDE})`);
  }
  return value as MigrationRecord;
}

async function writeRecord(file: string, value: MigrationRecord): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

export interface FeatureOverrideMigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface FeatureOverrideMigration {
  /** Entries found in the configuration file (empty when there is nothing to move). */
  readonly pending: readonly LegacyFeatureOverride[];
  /** Whether the migration has completed (an `overrides` block is refused from then on). */
  readonly done: boolean;
  /** Refuses `overrides` blocks in configuration updates once the migration is done. */
  readonly configUpdate: RootConfigUpdateHandler;
  /** Imports the entries once the store is loaded (step 2). */
  complete(store: FeatureOverrideStore): Promise<void>;
  /** Backs up and removes the blocks from the configuration file (step 3); failures are logged and retried next start. */
  finish(): Promise<void>;
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, '-');
}

/**
 * Before the Runtime reads the configuration: find legacy blocks, refuse them after a completed
 * migration, and return the steps that import and remove them.
 */
export async function prepareFeatureOverrideMigration(options: Readonly<{
  projectRoot: string;
  config: ConfigDocumentPort;
  /** The configuration file (copied to the backup directory before the blocks are removed). */
  configFile: string;
  logger: FeatureOverrideMigrationLogger;
  now?: () => number;
}>): Promise<FeatureOverrideMigration> {
  const file = join(options.projectRoot, FEATURE_OVERRIDE_MIGRATION_FILE);
  const now = options.now ?? Date.now;
  const snapshot: ConfigDocumentSnapshot = await options.config.read();
  const legacy = readLegacyFeatureOverrideConfig(snapshot.document);
  const fields = legacy.paths.map(path => path.join('.'));
  let current = await readRecord(file);
  if (legacy.paths.length && current?.status === 'done') throw new LegacyFeatureOverrideConfigError(fields);
  if (legacy.references.length) throw new FeatureOverrideMigrationReferenceError(legacy.references);
  let done = current?.status === 'done';
  if (!legacy.paths.length && !done) {
    // Nothing (left) to move: a new project, or blocks removed by hand after an import.
    current = { version: 1, entries: [], ...current, status: 'done', startedAt: current?.startedAt ?? now(), completedAt: now() };
    await writeRecord(file, current);
    done = true;
  }
  let imported = false;
  const configUpdate: RootConfigUpdateHandler = Object.freeze({
    id: 'feature-overrides-in-database',
    paths: Object.freeze([]),
    validate: ({ next }: { next: RuntimeConfigDocument }) => {
      if (!done) return;
      const found = readLegacyFeatureOverrideConfig(next).paths;
      if (found.length) throw new LegacyFeatureOverrideConfigError(found.map(path => path.join('.')));
    },
    prepare: async () => undefined,
  });
  return {
    pending: legacy.paths.length ? legacy.entries : Object.freeze([]),
    get done() { return done; },
    configUpdate,
    async complete(store) {
      if (!legacy.paths.length) return;
      if (!store.persistent) {
        const added = store.seed(legacy.entries.map(entry => ({ plugin: entry.plugin, key: entry.key,
          ...(entry.enabled === false ? { enabled: false as const } : {}), patch: entry.patch, updatedBy: `migration:${entry.source}` })));
        current = { version: 1, status: 'pending', entries: legacy.entries, startedAt: current?.startedAt ?? now(), memoryOnlyAt: now() };
        await writeRecord(file, current);
        options.logger.warn(`Feature overrides: ${added} override(s) from the configuration file are held in memory only `
          + '(no relational database); the file keeps them and Console / chat writes are refused until a relational database '
          + `(sqlite / mysql / pg) is configured. See ${FEATURE_OVERRIDE_UPGRADE_GUIDE}.`);
        return;
      }
      let written = 0;
      let kept = 0;
      for (const entry of legacy.entries) {
        // An existing row or tombstone was written in the database (an earlier run, the Console): it wins.
        if (store.revisionOf(entry.plugin, entry.key) > 0) { kept += 1; continue; }
        const result = await store.write({
          plugin: entry.plugin, key: entry.key, expectedRevision: 0, updatedBy: `migration:${entry.source}`,
          next: () => ({ ...(entry.enabled === false ? { enabled: false as const } : {}), patch: entry.patch }),
        });
        if (result.status === 'saved') written += 1; else kept += 1;
      }
      current = { version: 1, status: 'imported', entries: legacy.entries, startedAt: current?.startedAt ?? now(), importedAt: now() };
      await writeRecord(file, current);
      imported = true;
      options.logger.info(`Feature overrides (ADR 0057): wrote ${written} override(s) to feature_overrides`
        + `${kept ? `, kept ${kept} already stored` : ''}; removing ${fields.join(', ')} from the configuration file next.`);
    },
    async finish() {
      if (!imported || !current) return;
      try {
        const directory = join(options.projectRoot, FEATURE_OVERRIDE_BACKUP_DIRECTORY, `feature-overrides-${stamp(new Date(now()))}`);
        await mkdir(directory, { recursive: true });
        const backup = join(directory, basename(options.configFile));
        await copyFile(options.configFile, backup);
        // Compare-and-swap on the revision read before the Runtime started: an edit since then wins.
        const prepared = await options.config.prepare(snapshot, legacy.paths.map(path => ({ op: 'remove' as const, path })));
        await prepared.commit();
        current = { ...current, status: 'done', completedAt: now(),
          backup: join(FEATURE_OVERRIDE_BACKUP_DIRECTORY, basename(directory), basename(options.configFile)) };
        await writeRecord(file, current);
        done = true;
        imported = false;
        options.logger.info(`Feature overrides (ADR 0057): removed ${fields.join(', ')} from the configuration file `
          + `(backup: ${current.backup}). Change them on the Console feature page or with the chat command from now on.`);
      } catch (error) {
        options.logger.warn(`Feature overrides: the configuration file was left unchanged (${error instanceof Error ? error.message : String(error)}); `
          + 'the overrides are already in the database and the blocks are removed on the next start.');
      }
    },
  };
}
