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
  FEATURE_ADAPTER_KEY_PATTERN, FEATURE_ENABLED_KEY, FEATURE_ENDPOINT_KEY_PATTERN, FEATURE_OVERRIDES_KEY, featureKeyLevel,
  readPluginConfigurationMap,
  type ConfigDocumentPort, type ConfigDocumentSnapshot, type RootConfigUpdateHandler, type RuntimeConfigDocument,
  type RuntimeSnapshot,
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
  /**
   * Entries that never applied under the configuration-file resolver and are not imported: a key
   * that is not an adapter alias / `<alias>/<endpointId>` (`malformed_key`), or a valid key filed
   * under the other level (`wrong_level`, e.g. `adapters: { 'qq/bot-1': … }`). They are removed with
   * the block and kept in the backup copy.
   */
  readonly skipped: readonly LegacyFeatureOverrideSkip[];
}

export interface LegacyFeatureOverrideSkip {
  /** Configuration path, e.g. `rss.overrides.endpoints.qq/a/b`. */
  readonly source: string;
  readonly reason: 'malformed_key' | 'wrong_level';
}

export interface LegacyFeatureOverrideReadOptions {
  /**
   * Instance paths (`parent/child`) of the real child Plugin instances, from the Plugin tree. With
   * it only those nested blocks are read, as the configuration composer does; without it any nested
   * object under an instance-like key holding an `overrides` block counts (a pre-scan only).
   */
  readonly childInstances?: ReadonlySet<string>;
}

/** Instance paths (`parent/child`, …) of every nested child Plugin instance of a Runtime snapshot. */
export function childPluginInstancePaths(snapshot: Pick<RuntimeSnapshot, 'root' | 'tree'>): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const node of snapshot.tree.values()) {
    if (!node.parent || node.parent === snapshot.root) continue;
    const keys: string[] = [node.instanceKey];
    let parent = snapshot.tree.get(node.parent);
    let guard = 0;
    while (parent && parent.id !== snapshot.root && guard < 64) {
      keys.unshift(parent.instanceKey);
      parent = parent.parent ? snapshot.tree.get(parent.parent) : undefined;
      guard += 1;
    }
    // A node whose chain does not reach the root is not a mounted instance.
    if (parent?.id === snapshot.root) paths.add(keys.join('/'));
  }
  return paths;
}

/** Why an entry key is not importable at `level`, or undefined when it is. */
function invalidKey(level: 'adapter' | 'endpoint', key: string): LegacyFeatureOverrideSkip['reason'] | undefined {
  let derived: string | undefined;
  try { derived = featureKeyLevel(key); } catch { derived = undefined; }
  const pattern = level === 'adapter' ? FEATURE_ADAPTER_KEY_PATTERN : FEATURE_ENDPOINT_KEY_PATTERN;
  if (pattern.test(key) && derived === level) return undefined;
  const other = level === 'adapter' ? FEATURE_ENDPOINT_KEY_PATTERN : FEATURE_ADAPTER_KEY_PATTERN;
  return other.test(key) && derived !== undefined && derived !== 'global' && derived !== level ? 'wrong_level' : 'malformed_key';
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
export function readLegacyFeatureOverrideConfig(
  document: RuntimeConfigDocument,
  options: LegacyFeatureOverrideReadOptions = {},
): LegacyFeatureOverrideConfig {
  const entries: LegacyFeatureOverride[] = [];
  const paths: string[][] = [];
  const references: string[] = [];
  const skipped: LegacyFeatureOverrideSkip[] = [];
  const children = options.childInstances;
  let plugins: Readonly<Record<string, unknown>>;
  try { plugins = readPluginConfigurationMap(document); } catch { plugins = {}; }
  const visit = (path: readonly string[], block: unknown, depth: number): void => {
    if (!record(block) || depth > 8) return;
    const overrides = block[FEATURE_OVERRIDES_KEY];
    // A known child instance owns the reserved key like a top-level block; the pre-scan only trusts
    // something that looks like an override block.
    if (overrides !== undefined && (depth === 0 || children !== undefined || isOverrideBlock(overrides))) {
      paths.push([...path, FEATURE_OVERRIDES_KEY]);
      if (record(overrides)) {
        for (const level of ['adapter', 'endpoint'] as const) {
          const group = overrides[`${level}s`];
          if (!record(group)) continue;
          for (const [key, entry] of Object.entries(group)) {
            if (!record(entry)) continue;
            const source = `${[...path, FEATURE_OVERRIDES_KEY, `${level}s`].join('.')}.${key}`;
            // Such an entry never applied under the configuration-file resolver: never made live here.
            const invalid = invalidKey(level, key);
            if (invalid) { skipped.push(Object.freeze({ source, reason: invalid })); continue; }
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
    // Nested child Plugin blocks (`parent.child.overrides`): with the Plugin tree, real children only.
    for (const [key, child] of Object.entries(block)) {
      if (key === FEATURE_OVERRIDES_KEY || !INSTANCE_KEY.test(key) || !record(child)) continue;
      if (children !== undefined && !children.has([...path, key].join('/'))) continue;
      visit([...path, key], child, depth + 1);
    }
  };
  for (const [alias, block] of Object.entries(plugins)) visit([alias], block, 0);
  return Object.freeze({
    entries: Object.freeze(entries), paths: Object.freeze(paths), references: Object.freeze(references), skipped: Object.freeze(skipped),
  });
}

const NO_CHILDREN: ReadonlySet<string> = new Set();
const entryId = (entry: Pick<LegacyFeatureOverride, 'plugin' | 'key'>) => `${entry.plugin}\0${entry.key}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

function sameOverride(
  left: { readonly enabled?: false; readonly patch: Readonly<Record<string, unknown>> } | undefined,
  right: { readonly enabled?: false; readonly patch: Readonly<Record<string, unknown>> } | undefined,
): boolean {
  if (!left || !right) return !left && !right;
  return (left.enabled === false) === (right.enabled === false) && canonical(left.patch) === canonical(right.patch);
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
  /**
   * Imports the entries once the store is loaded (step 2). `snapshot` (the candidate generation)
   * names the real child Plugin instances; without it nested blocks are left for a later start.
   */
  complete(store: FeatureOverrideStore, snapshot?: Pick<RuntimeSnapshot, 'root' | 'tree'>): Promise<void>;
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
  // Pre-scan (no Plugin tree yet): top-level blocks are certain; nested ones are confirmed against
  // the Plugin tree in `complete`.
  const scan = readLegacyFeatureOverrideConfig(snapshot.document);
  const topLevel = readLegacyFeatureOverrideConfig(snapshot.document, { childInstances: NO_CHILDREN });
  const nestedCandidates = scan.paths.length > topLevel.paths.length;
  let current = await readRecord(file);
  if (topLevel.paths.length && current?.status === 'done') {
    throw new LegacyFeatureOverrideConfigError(topLevel.paths.map(path => path.join('.')));
  }
  if (topLevel.references.length) throw new FeatureOverrideMigrationReferenceError(topLevel.references);
  let done = current?.status === 'done';
  const markDone = async () => {
    // Nothing (left) to move: a new project, or blocks removed by hand after an import.
    current = { version: 1, entries: [], ...current, status: 'done', startedAt: current?.startedAt ?? now(), completedAt: now() };
    await writeRecord(file, current);
    done = true;
  };
  if (!scan.paths.length && !done) await markDone();
  /** Child instances of the last Plugin tree seen; configuration updates are checked against it. */
  let knownChildren: ReadonlySet<string> = NO_CHILDREN;
  let migrated: LegacyFeatureOverrideConfig | undefined;
  let imported = false;
  const configUpdate: RootConfigUpdateHandler = Object.freeze({
    id: 'feature-overrides-in-database',
    paths: Object.freeze([]),
    validate: ({ next }: { next: RuntimeConfigDocument }) => {
      if (!done) return;
      // The same recognition as startup: top-level blocks and real child Plugin blocks only.
      const found = readLegacyFeatureOverrideConfig(next, { childInstances: knownChildren }).paths;
      if (found.length) throw new LegacyFeatureOverrideConfigError(found.map(path => path.join('.')));
    },
    prepare: async () => undefined,
  });
  return {
    pending: scan.paths.length ? scan.entries : Object.freeze([]),
    get done() { return done; },
    configUpdate,
    async complete(store, runtimeSnapshot) {
      if (runtimeSnapshot) knownChildren = childPluginInstancePaths(runtimeSnapshot);
      if (!scan.paths.length) return;
      // Done: top-level blocks were refused in prepare; nested ones need the tree to be judged.
      if (done && !runtimeSnapshot) return;
      if (!runtimeSnapshot && nestedCandidates) {
        options.logger.warn('Feature overrides: the Plugin tree is not available yet, so nested child blocks cannot be told apart '
          + 'from plugin settings; the configuration file is left unchanged and the import runs on the next start.');
        return;
      }
      const legacy = runtimeSnapshot
        ? readLegacyFeatureOverrideConfig(snapshot.document, { childInstances: knownChildren })
        : topLevel;
      const fields = legacy.paths.map(path => path.join('.'));
      if (done) {
        if (legacy.paths.length) throw new LegacyFeatureOverrideConfigError(fields);
        return;
      }
      if (legacy.references.length) throw new FeatureOverrideMigrationReferenceError(legacy.references);
      if (!legacy.paths.length) {
        // Only plugin settings that looked like override blocks: nothing to move.
        await markDone();
        return;
      }
      for (const skip of legacy.skipped) {
        options.logger.warn(`Feature overrides: skipped ${skip.source} (${skip.reason === 'wrong_level'
          ? 'the key belongs to the other level (adapters: <alias>, endpoints: <alias>/<id>)'
          : 'not an adapter alias or <alias>/<endpointId> key'}); it never applied and is not imported. `
          + `It is removed with the block and kept in the backup copy. See ${FEATURE_OVERRIDE_UPGRADE_GUIDE}.`);
      }
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
      // An earlier start imported but could not edit the file: the file may have changed since.
      const previous = current?.status === 'imported' ? new Map(current.entries.map(entry => [entryId(entry), entry])) : undefined;
      /** Whether the stored row is still exactly what the migration wrote (nobody changed it since). */
      const migrationWritten = (plugin: string, key: string) => store.revisionOf(plugin, key) === 1
        && (store.get(plugin, key)?.updatedBy ?? '').startsWith('migration:');
      let written = 0;
      let kept = 0;
      for (const entry of legacy.entries) {
        const revision = store.revisionOf(entry.plugin, entry.key);
        const next = () => ({ ...(entry.enabled === false ? { enabled: false as const } : {}), patch: entry.patch });
        if (revision > 0) {
          const stored = store.get(entry.plugin, entry.key);
          if (previous && !sameOverride(stored, entry)) {
            const before = previous.get(entryId(entry));
            if (before && !sameOverride(before, entry) && migrationWritten(entry.plugin, entry.key)) {
              // Edited in the file after the import, never touched in the database: the file wins.
              const result = await store.write({ plugin: entry.plugin, key: entry.key, expectedRevision: 1,
                updatedBy: `migration:${entry.source}`, next });
              if (result.status === 'saved') { written += 1; continue; }
            }
            options.logger.warn(`Feature overrides: ${entry.source} differs from the stored override (revision ${revision}), `
              + 'which was changed in the database since the import; the stored value is kept and the file value is ignored.');
          }
          // An existing row or tombstone was written in the database (an earlier run, the Console): it wins.
          kept += 1;
          continue;
        }
        const result = await store.write({
          plugin: entry.plugin, key: entry.key, expectedRevision: 0, updatedBy: `migration:${entry.source}`, next,
        });
        if (result.status === 'saved') written += 1; else kept += 1;
      }
      if (previous) {
        const present = new Set(legacy.entries.map(entryId));
        for (const before of previous.values()) {
          if (present.has(entryId(before)) || !store.get(before.plugin, before.key)) continue;
          if (migrationWritten(before.plugin, before.key)) {
            // Removed from the file after the import, never touched in the database: removed here too.
            const result = await store.write({ plugin: before.plugin, key: before.key, expectedRevision: 1,
              updatedBy: `migration:${before.source}`, next: () => null });
            if (result.status === 'saved') { written += 1; continue; }
          }
          options.logger.warn(`Feature overrides: ${before.source} was removed from the configuration file after the import, `
            + 'but the stored override was changed since; it is kept (remove it on the Console feature page).');
        }
      }
      current = { version: 1, status: 'imported', entries: legacy.entries, startedAt: current?.startedAt ?? now(), importedAt: now() };
      await writeRecord(file, current);
      migrated = legacy;
      imported = true;
      options.logger.info(`Feature overrides (ADR 0057): wrote ${written} override(s) to feature_overrides`
        + `${kept ? `, kept ${kept} already stored` : ''}; removing ${fields.join(', ')} from the configuration file next.`);
    },
    async finish() {
      if (!imported || !current || !migrated) return;
      const fields = migrated.paths.map(path => path.join('.'));
      try {
        const directory = join(options.projectRoot, FEATURE_OVERRIDE_BACKUP_DIRECTORY, `feature-overrides-${stamp(new Date(now()))}`);
        await mkdir(directory, { recursive: true });
        const backup = join(directory, basename(options.configFile));
        await copyFile(options.configFile, backup);
        // Compare-and-swap on the revision read before the Runtime started: an edit since then wins.
        const prepared = await options.config.prepare(snapshot, migrated.paths.map(path => ({ op: 'remove' as const, path })));
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
