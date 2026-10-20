import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isAlias, isMap, isScalar, isSeq, Pair, parseDocument, visit, type Document } from 'yaml';
import { createConfigDocument, readSourcePluginOrder } from '@zhin.js/config-file';
import { ROOT_CONFIG_FILE_NAMES, selectRootConfigFile } from '@zhin.js/plugin-runtime';
import { HOST_CONFIG_KEYS, NodePackageResolver, PackageResolutionError, ProjectGraphService, mergeChildPluginReferences, type ChildPluginReference, type ResolvedPackage } from '@zhin.js/runtime';
import { readPluginLifecycleState, resolvePluginLifecycleFile } from '../plugin-lifecycle-store.js';

const JOURNAL_DIRECTORY = '.zhin/instance-declarations-migration';
const JOURNAL_NAME = 'journal.json';
const BACKUP_DIRECTORY = '.zhin/backups';
const RESERVED = new Set([...HOST_CONFIG_KEYS, 'plugins', 'configVersion', 'disable_plugins', '__proto__', 'constructor', 'prototype']);
const hash = (source: string) => createHash('sha256').update(source).digest('hex');

type SourceState = Readonly<{ exists: boolean; source: string; digest: string; mode: number }>;
export interface InstanceMigrationFile {
  readonly path: string;
  readonly before: SourceState;
  readonly after: SourceState;
}
export interface InstanceDeclarationMigrationPlan {
  readonly root: string;
  readonly files: readonly InstanceMigrationFile[];
  /** Package manifests consulted during static resolution. No plugin entry is imported. */
  readonly guards: readonly Readonly<{ path: string; digest: string }>[];
  readonly instances: readonly Readonly<{ instanceKey: string; package: string; pluginId: string; enabled: boolean }>[];
  readonly pendingChecks: readonly string[];
}
interface JournalFile {
  path: string;
  before: { exists: boolean; digest: string; mode: number };
  after: { exists: boolean; digest: string; mode: number };
  backup: string;
  candidate: string;
}
interface Journal {
  version: 1;
  root: string;
  status: 'prepared' | 'applying' | 'completed' | 'rolling-back' | 'rolled-back';
  files: JournalFile[];
  guards: Readonly<{ path: string; digest: string }>[];
}
export interface InstanceMigrationApplyOptions {
  /** Fault-injection seam: invoked after each durable file replacement. */
  readonly afterWrite?: (index: number) => void | Promise<void>;
  /** Clock seam for the human-readable backup directory name. */
  readonly now?: () => Date;
}
export interface InstanceMigrationApplyResult {
  /** Timestamped copy of every original file, independent of the recovery journal. */
  readonly backupDirectory: string;
}

/** Static, offline and side-effect-free. Does not load schemas from executable entries. */
export async function planInstanceDeclarationMigration(
  projectRoot: string,
  options: { readonly lifecycleFile?: string } = {},
): Promise<InstanceDeclarationMigrationPlan> {
  const root = await realpath(resolve(projectRoot));
  await assertNoPendingInstanceMigration(root);
  const selected = selectRootConfigFile((await readdir(root)).filter(file => ROOT_CONFIG_FILE_NAMES.includes(file as typeof ROOT_CONFIG_FILE_NAMES[number])));
  if (!selected) throw new Error('No Root YAML/JSON configuration found; create configVersion: 2 manually.');
  const configPath = join(root, selected), packagePath = join(root, 'package.json');
  const [configBefore, packageBefore] = await Promise.all([sourceState(configPath), sourceState(packagePath)]);
  const configAst = parseStrict(configBefore.source, configPath);
  const packageAst = parseStrict(packageBefore.source, packagePath);
  const config = configAst.toJS({ maxAliasCount: 100 }) as Record<string, unknown>;
  if (config.configVersion !== undefined) throw new Error('Only an unversioned legacy configuration can be migrated; configVersion: 2 needs no conversion.');
  const legacyConfigs = configAst.get('plugins', true);
  if (legacyConfigs !== undefined && !isMap(legacyConfigs)) throw new Error('Legacy plugins must be an instance configuration map; arrays need a manual migration.');
  const lifecyclePath = options.lifecycleFile ?? resolvePluginLifecycleFile(root);
  if (!isAbsolute(lifecyclePath)) throw new Error('Lifecycle file must be an absolute path');
  if ([configPath, packagePath].includes(resolve(lifecyclePath))) throw new Error('Lifecycle file must be distinct from package.json and the Root configuration');
  const lifecycleBefore = await sourceState(lifecyclePath);
  const lifecycleAst = lifecycleBefore.exists ? parseStrict(lifecycleBefore.source, `${lifecyclePath}.json`) : undefined;
  const lifecycle = await readPluginLifecycleState(lifecyclePath);
  const resolver = await NodePackageResolver.create(root);
  const rootPackage = await resolver.root(root);
  if (rootPackage.packageJson.zhin.type !== 'plugin') throw new Error('Root package must be a Plugin');
  const guards = new Map<string, string>([[packagePath, packageBefore.digest]]);
  async function guard(pkg: ResolvedPackage): Promise<void> {
    const file = join(pkg.root, 'package.json');
    guards.set(file, (await sourceState(file)).digest);
  }
  let facade: ResolvedPackage | undefined;
  let carrier: ResolvedPackage | undefined;
  if (rootPackage.packageJson.zhin.platformFeatures !== false
    && (rootPackage.packageJson.dependencies?.['@zhin.js/core'] || rootPackage.packageJson.optionalDependencies?.['@zhin.js/core'])) {
    try { carrier = await resolver.resolve('@zhin.js/core', rootPackage); await guard(carrier); }
    catch (error) { if (!(error instanceof PackageResolutionError)) throw error; }
  }
  let inherited: readonly ChildPluginReference[] = [];
  if (rootPackage.packageJson.zhin.platformFeatures !== false
    && (rootPackage.packageJson.dependencies?.['zhin.js'] || rootPackage.packageJson.optionalDependencies?.['zhin.js'])) {
    try {
      facade = await resolver.resolve('zhin.js', rootPackage);
      // Existing platform inheritance is admitted only with its Feature carrier.
      carrier ??= await resolver.resolve('@zhin.js/core', facade);
      await guard(facade); await guard(carrier);
      if (facade.packageJson.zhin.type === 'plugin') inherited = facade.packageJson.zhin.plugins;
    } catch (error) { if (!(error instanceof PackageResolutionError)) throw error; }
  }
  const own = rootPackage.packageJson.zhin.plugins;
  const references = mergeChildPluginReferences(own, inherited);
  const ownKeys = new Set(own.map(reference => reference.instanceKey));
  const seen = new Set<string>();
  const instances: Array<{ instanceKey: string; package: string; pluginId: string; enabled: boolean }> = [];
  for (const reference of references) {
    const key = reference.instanceKey;
    if (seen.has(key) || RESERVED.has(key)) throw new Error(`Cannot migrate alias ${key}: duplicate or Host/framework field collision; keep the original identity and migrate manually.`);
    seen.add(key);
    if (reference.optional || reference.api !== undefined) throw new Error(`Cannot migrate ${key}: per-reference optional/api is not representable in v2.`);
    const owner = ownKeys.has(key) ? rootPackage : facade!;
    const pkg = await resolver.resolve(reference.package, owner);
    await guard(pkg);
    if (pkg.packageJson.zhin.type !== 'plugin') throw new Error(`${key} is not a Plugin`);
    if (pkg.packageJson.zhin.plugins.length) throw new Error(`Cannot migrate ${key}: nested plugin instances cannot be flattened without changing PluginId.`);
    // Moving a facade-relative reference must not silently change its physical implementation.
    if (owner !== rootPackage) {
      const fromRoot = await resolver.resolve(reference.package, rootPackage).catch(() => undefined);
      if (!fromRoot || fromRoot.root !== pkg.root) throw new Error(`Cannot migrate inherited ${key}: declare the original package specification in the Root dependencies first (resolution owner would change).`);
    }
    instances.push({ instanceKey: key, package: reference.package, pluginId: `root/${key}`, enabled: !lifecycle.disabled.includes(key) });
  }
  for (const key of lifecycle.disabled) if (!seen.has(key)) throw new Error(`Orphan disabled alias ${key}; resolve it before migration.`);
  if (isMap(legacyConfigs)) for (const pair of legacyConfigs.items) {
    const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
    if (!seen.has(key)) throw new Error(`Orphan plugin configuration ${key}; migration will not discard user data.`);
  }
  for (const key of Object.keys(config)) if (key !== 'plugins' && !HOST_CONFIG_KEYS.includes(key) && !seen.has(key)) {
    throw new Error(`Unknown top-level legacy field ${key}; resolve its ownership manually before migration.`);
  }
  for (const instance of instances) if (configAst.has(instance.instanceKey)) throw new Error(`Top-level field ${instance.instanceKey} already exists; cannot overwrite it.`);

  // Move the existing Pair nodes, preserving their quoting, comments and scalar values.
  const emptyDeclarations: Record<string, string> = {};
  const declaration = configAst.createNode(emptyDeclarations);
  if (!isMap(declaration) || !isMap(configAst.contents)) throw new Error('Configuration root must be an object');
  if (isMap(legacyConfigs)) {
    declaration.comment = legacyConfigs.comment;
    declaration.commentBefore = legacyConfigs.commentBefore;
    declaration.spaceBefore = legacyConfigs.spaceBefore;
  }
  const originalPairs = isMap(legacyConfigs) ? [...legacyConfigs.items] : [];
  for (const instance of instances) declaration.items.push(new Pair(configAst.createNode(instance.instanceKey), configAst.createNode(instance.package)));
  configAst.set('plugins', declaration);
  configAst.set('configVersion', 2);
  configAst.set('disable_plugins', configAst.createNode(instances.filter(instance => !instance.enabled).map(instance => instance.instanceKey)));
  for (const instance of instances) {
    const pair = originalPairs.find(item => String(isScalar(item.key) ? item.key.value : item.key) === instance.instanceKey);
    if (pair) configAst.contents.items.push(pair);
    else configAst.contents.items.push(new Pair(configAst.createNode(instance.instanceKey), configAst.createNode({})));
  }
  const configAfter = printAst(configAst, configBefore.source, configPath);
  const output = parseStrict(configAfter, configPath).toJS() as Record<string, unknown>;
  if (output.configVersion !== 2 || readSourcePluginOrder(configAfter, isJson(configPath) ? 'JSON' : 'YAML')?.join('\0') !== instances.map(instance => instance.instanceKey).join('\0')) throw new Error('Migration produced a different declaration order');
  const migratedRoot: ResolvedPackage = {
    ...rootPackage,
    packageJson: { ...rootPackage.packageJson, zhin: { ...rootPackage.packageJson.zhin, plugins: [] } },
  };
  const graph = await new ProjectGraphService({
    root: async () => migratedRoot,
    resolve: (request, owner) => resolver.resolve(request, owner),
    workspacePackages: () => resolver.workspacePackages(),
  }).inspect(root, output, instances.map(instance => instance.instanceKey));
  for (const pkg of graph.packages.values()) await guard(pkg);
  // Verify via the actual adapter without changing any source files.
  await createConfigDocument(configPath).prepareReplacement((await createConfigDocument(configPath).read()).revision, configAfter);
  packageAst.setIn(['zhin', 'plugins'], []);
  const packageAfter = printAst(packageAst, packageBefore.source, packagePath);
  const files: InstanceMigrationFile[] = [
    { path: configPath, before: configBefore, after: present(configAfter, configBefore.mode) },
    { path: packagePath, before: packageBefore, after: present(packageAfter, packageBefore.mode) },
  ];
  if (lifecycleAst) {
    lifecycleAst.set('disabled', []);
    files.push({ path: lifecyclePath, before: lifecycleBefore, after: present(printAst(lifecycleAst, lifecycleBefore.source, `${lifecyclePath}.json`), lifecycleBefore.mode) });
  }
  return Object.freeze({ root, files: Object.freeze(files), guards: Object.freeze([...guards].map(([path, digest]) => ({ path, digest }))), instances: Object.freeze(instances), pendingChecks: Object.freeze(['Executable inline Schema, Token requirements and Runtime setup remain unverified until controlled startup.']) });
}

export async function assertNoPendingInstanceMigration(root: string): Promise<void> {
  const journal = await readJournal(root);
  if (journal && !['completed', 'rolled-back'].includes(journal.status)) throw new Error('Incomplete instance-declaration migration. Keep the Bot stopped; run zhin migrate instances --recover continue or --recover rollback.');
}

export async function applyInstanceDeclarationMigration(plan: InstanceDeclarationMigrationPlan, options: InstanceMigrationApplyOptions = {}): Promise<InstanceMigrationApplyResult> {
  return withProjectLock(plan.root, async () => {
    await assertStopped(plan.root);
    await assertNoPendingInstanceMigration(plan.root);
    for (const file of plan.files) await assertState(file.path, file.before);
    for (const guard of plan.guards) if ((await sourceState(guard.path)).digest !== guard.digest) throw new Error(`Migration source changed: ${guard.path}`);
    const directory = join(plan.root, JOURNAL_DIRECTORY);
    const previous = await readJournal(plan.root);
    // A completed rollback may be retried; archive every original backup intact.
    if (previous) await rename(directory, `${directory}.${randomUUID()}.backup`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const files: JournalFile[] = [];
    const batch = randomUUID();
    for (const [index, file] of plan.files.entries()) {
      const backup = `${batch}-${index}.before`, candidate = `${batch}-${index}.after`;
      await writeFile(join(directory, backup), file.before.source, { mode: 0o600, flag: 'wx' });
      await writeFile(join(directory, candidate), file.after.source, { mode: 0o600, flag: 'wx' });
      files.push({ path: file.path, before: summary(file.before), after: summary(file.after), backup, candidate });
    }
    const journal: Journal = { version: 1, root: plan.root, status: 'prepared', files, guards: [...plan.guards] };
    await writeJournal(plan.root, journal);
    // A plain, timestamped copy users can inspect or restore by hand, written before any cutover.
    const backupDirectory = await writeHumanBackup(plan, (options.now ?? (() => new Date()))());
    await perform(plan.root, journal, 'continue', options);
    return Object.freeze({ backupDirectory });
  });
}

function backupStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function writeHumanBackup(plan: InstanceDeclarationMigrationPlan, date: Date): Promise<string> {
  const parent = join(plan.root, BACKUP_DIRECTORY);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stamp = `config-v2-${backupStamp(date)}`;
  let directory = join(parent, stamp);
  for (let attempt = 2; ; attempt++) {
    try { await mkdir(directory, { mode: 0o700 }); break; }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST') || attempt > 100) throw error;
      directory = join(parent, `${stamp}-${attempt}`);
    }
  }
  await chmod(directory, 0o700);
  const entries: Array<{ original: string; backup: string; sha256: string }> = [];
  for (const [index, file] of plan.files.entries()) {
    if (!file.before.exists) continue;
    const local = relative(plan.root, file.path);
    const name = !local || local.startsWith('..') || isAbsolute(local) ? join('external', `${index}-${basename(file.path)}`) : local;
    const target = join(directory, name);
    await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
    // Originals may contain inline credentials; keep the copy private.
    await writeFile(target, file.before.source, { mode: 0o600, flag: 'wx' });
    await chmod(target, 0o600);
    entries.push({ original: file.path, backup: name.split(sep).join('/'), sha256: file.before.digest });
  }
  const manifest = {
    kind: 'zhin-config-v2-migration-backup',
    createdAt: date.toISOString(),
    root: plan.root,
    files: entries,
    restore: [
      'Preferred: keep the Bot stopped and run `zhin migrate instances --recover rollback`.',
      'Manual: copy each backup file back to its original path, then remove .zhin/instance-declarations-migration.',
    ],
  };
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return directory;
}

/**
 * Human-readable, value-free preview of a migration plan. Only key names, package
 * specifiers and instance state are shown; configuration values (including
 * environment references) never appear, so the output is safe to paste in issues.
 */
export function formatInstanceMigrationPreview(plan: InstanceDeclarationMigrationPlan, options: { readonly mode?: 'dry-run' | 'apply' } = {}): string {
  const mode = options.mode ?? 'dry-run';
  const display = (file: string) => {
    const local = relative(plan.root, file);
    return !local || local.startsWith('..') || isAbsolute(local) ? file : local.split(sep).join('/');
  };
  const [configFile, packageFile, lifecycleFile] = plan.files;
  const lines: string[] = [
    mode === 'dry-run'
      ? 'zhin migrate instances — dry-run（仅预览，不写文件 / preview only, nothing is written）'
      : 'zhin migrate instances — apply（写入前自动备份 / backing up before writing）',
    '',
  ];
  const legacyKeys = new Map<string, string[]>();
  if (configFile?.before.exists) {
    try {
      const legacy = parseDocument(configFile.before.source).get('plugins', true);
      if (isMap(legacy)) for (const pair of legacy.items) {
        const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
        legacyKeys.set(key, isMap(pair.value) ? pair.value.items.map(item => String(isScalar(item.key) ? item.key.value : item.key)) : []);
      }
    } catch { /* planning already validated the source */ }
  }
  const quote = (value: string) => JSON.stringify(value);
  const fields = (keys: readonly string[]) => keys.length ? `{${keys.slice(0, 8).join(', ')}${keys.length > 8 ? `, … +${keys.length - 8}` : ''}}` : '{}';
  if (configFile) {
    lines.push(`${display(configFile.path)}`);
    lines.push('  + configVersion: 2');
    for (const instance of plan.instances) lines.push(`  + plugins.${instance.instanceKey}: ${quote(instance.package)}`);
    for (const instance of plan.instances) {
      const keys = legacyKeys.get(instance.instanceKey);
      if (keys === undefined) lines.push(`  + ${instance.instanceKey}: {}`);
      else lines.push(`  ~ plugins.${instance.instanceKey}.${fields(keys)} → ${instance.instanceKey}.${fields(keys)}  (moved, values unchanged / 原值搬移)`);
    }
    const disabled = plan.instances.filter(instance => !instance.enabled).map(instance => instance.instanceKey);
    lines.push(`  + disable_plugins: [${disabled.join(', ')}]`);
    lines.push('');
  }
  if (packageFile) {
    lines.push(display(packageFile.path));
    lines.push(`  - zhin.plugins (${plan.instances.length} legacy mount(s) / 旧挂载) → []`);
    lines.push('    dependencies, scripts, zhin.features/entry/engine are kept / 其余字段保持不变');
    lines.push('');
  }
  if (lifecycleFile) {
    lines.push(display(lifecycleFile.path));
    lines.push('  ~ disabled → []  (moved to disable_plugins / 已并入 disable_plugins)');
    lines.push('');
  }
  lines.push('Instances / 实例:');
  for (const instance of plan.instances) {
    lines.push(`  ${instance.instanceKey}  ${instance.package}  ${instance.enabled ? 'enabled' : 'disabled'}  ${instance.pluginId}`);
  }
  if (!plan.instances.length) lines.push('  (none)');
  if (plan.pendingChecks.length) {
    lines.push('', 'Pending checks / 待启动后验证:');
    for (const check of plan.pendingChecks) lines.push(`  - ${check}`);
  }
  if (mode === 'dry-run') {
    lines.push('', `Backup on --apply / 应用时自动备份到: ${BACKUP_DIRECTORY}/config-v2-<timestamp>/`);
  }
  return lines.join('\n');
}

export async function recoverInstanceDeclarationMigration(rootPath: string, action: 'continue' | 'rollback', options: InstanceMigrationApplyOptions = {}): Promise<void> {
  const root = await realpath(resolve(rootPath));
  await withProjectLock(root, async () => {
    await assertStopped(root);
    const journal = await readJournal(root);
    if (!journal) throw new Error('No instance-declaration migration journal exists');
    await perform(root, journal, action, options);
  }, true);
}

async function perform(root: string, journal: Journal, action: 'continue' | 'rollback', options: InstanceMigrationApplyOptions): Promise<void> {
  if (journal.root !== root || journal.version !== 1 || !Array.isArray(journal.files)) throw new Error('Invalid migration journal');
  const directory = join(root, JOURNAL_DIRECTORY);
  const states = await Promise.all(journal.files.map(async file => {
    if (!isAbsolute(file.path) || !/^[a-f0-9-]+-\d+\.before$/.test(file.backup) || !/^[a-f0-9-]+-\d+\.after$/.test(file.candidate)) throw new Error('Invalid migration journal path');
    const current = await sourceState(file.path);
    if (!matches(current, file.before) && !matches(current, file.after)) throw new Error(`File changed after migration: ${file.path}; recovery will not overwrite user edits.`);
    const target = action === 'continue' ? file.after : file.before;
    const source = await readFile(join(directory, action === 'continue' ? file.candidate : file.backup), 'utf8');
    if (hash(source) !== target.digest) throw new Error('Migration backup/candidate digest mismatch');
    return { file, current, target, source };
  }));
  // Consulted dependency manifests must still match unless they are one of our writes.
  for (const guard of journal.guards) if (!journal.files.some(file => file.path === guard.path) && (await sourceState(guard.path)).digest !== guard.digest) throw new Error(`Migration package changed: ${guard.path}`);
  journal.status = action === 'continue' ? 'applying' : 'rolling-back';
  await writeJournal(root, journal);
  for (const [index, state] of states.entries()) {
    if (!matches(state.current, state.target)) {
      await assertState(state.file.path, state.current);
      if (state.target.exists) await atomicWrite(state.file.path, state.source, state.target.mode);
      else await rm(state.file.path);
      await options.afterWrite?.(index);
    }
  }
  journal.status = action === 'continue' ? 'completed' : 'rolled-back';
  await writeJournal(root, journal);
}

function parseStrict(source: string, file: string): Document {
  if (isJson(file)) {
    try { JSON.parse(source); }
    catch { throw new Error(`Cannot migrate ${file}: Invalid JSON syntax`); }
  }
  const document = parseDocument(source, { strict: true, uniqueKeys: true, prettyErrors: false });
  if (document.errors.length) {
    // Parser messages may contain source excerpts or offending scalar values.
    // Emit only stable diagnostic codes, even when pretty formatting is off.
    const reason = document.errors.some(error => error.code === 'DUPLICATE_KEY') ? 'Mapping keys must be unique' : 'Invalid YAML syntax';
    throw new Error(`Cannot migrate ${file}: ${reason} (${document.errors.map(error => error.code).join(', ')})`);
  }
  if (!isMap(document.contents)) throw new Error(`Configuration must be an object: ${file}`);
  visit(document, (_, node) => {
    if (isAlias(node) || isMap(node) && node.items.some(pair => isScalar(pair.key) && String(pair.key.value) === '<<')) throw new Error(`YAML aliases/merge keys require a manual migration: ${file}`);
    if (isMap(node)) {
      const keys = new Set<string>();
      for (const pair of node.items) {
        if (!isScalar(pair.key)) throw new Error(`Complex mapping keys need manual migration: ${file}`);
        const key = String(pair.key.value);
        if (keys.has(key)) throw new Error(`Duplicate object key ${key}: ${file}`);
        keys.add(key);
      }
    }
  });
  return document;
}
function isJson(file: string): boolean { return extname(file).toLowerCase() === '.json'; }
function printAst(document: Document, original: string, file: string): string {
  if (!isJson(file)) {
    const source = document.toString({ indent: original.match(/^( +)\S/mu)?.[1].length ?? 2, lineWidth: 0 });
    return original.includes('\r\n') ? source.replaceAll('\n', '\r\n') : source;
  }
  // YAML AST preserves ordered JSON Pair nodes; serialize without JS Object.keys.
  const indent = original.match(/\n([ \t]+)"/u)?.[1] ?? '  ';
  function render(node: unknown, level: number): string {
    const prefix = indent.repeat(level + 1), suffix = indent.repeat(level);
    if (isMap(node)) return node.items.length ? `{\n${node.items.map(pair => `${prefix}${JSON.stringify(String(isScalar(pair.key) ? pair.key.value : pair.key))}: ${render(pair.value, level + 1)}`).join(',\n')}\n${suffix}}` : '{}';
    if (isSeq(node)) return node.items.length ? `[\n${node.items.map(item => `${prefix}${render(item, level + 1)}`).join(',\n')}\n${suffix}]` : '[]';
    return JSON.stringify(isScalar(node) ? node.value : node) ?? 'null';
  }
  const source = `${render(document.contents, 0)}\n`;
  return original.includes('\r\n') ? source.replaceAll('\n', '\r\n') : source;
}
function summary(state: SourceState) { return { exists: state.exists, digest: state.digest, mode: state.mode }; }
function present(source: string, mode = 0o600): SourceState { return { exists: true, source, digest: hash(source), mode }; }
function matches(current: Pick<SourceState, 'exists' | 'digest' | 'mode'>, expected: Pick<SourceState, 'exists' | 'digest' | 'mode'>) { return current.exists === expected.exists && current.digest === expected.digest && current.mode === expected.mode; }
async function sourceState(file: string): Promise<SourceState> {
  try {
    if ((await lstat(file)).isSymbolicLink()) throw new Error(`Migration does not replace symbolic links: ${file}`);
    const source = await readFile(file, 'utf8');
    return present(source, (await stat(file)).mode);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { exists: false, source: '', digest: hash(''), mode: 0o600 };
    throw error;
  }
}
async function assertState(file: string, expected: Pick<SourceState, 'exists' | 'digest' | 'mode'>) {
  if (!matches(await sourceState(file), expected)) throw new Error(`Migration source changed: ${file}`);
}
async function atomicWrite(file: string, source: string, mode: number): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, source, { mode, flag: 'wx' });
    // Creation mode is masked by process.umask; restore the captured bits before cutover.
    await chmod(temporary, mode & 0o7777);
    await rename(temporary, file);
  }
  finally { await rm(temporary, { force: true }); }
}
async function writeJournal(root: string, journal: Journal) { await atomicWrite(join(root, JOURNAL_DIRECTORY, JOURNAL_NAME), `${JSON.stringify(journal, null, 2)}\n`, 0o600); }
async function readJournal(root: string): Promise<Journal | undefined> {
  try { return JSON.parse(await readFile(join(root, JOURNAL_DIRECTORY, JOURNAL_NAME), 'utf8')) as Journal; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
}
async function assertStopped(root: string) {
  let source: string;
  try { source = await readFile(join(root, '.zhin.pid'), 'utf8'); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error; }
  const pid = Number(source.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid .zhin.pid; confirm the Bot is stopped before migration.');
  try { process.kill(pid, 0); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return; throw error; }
  throw new Error('Stop the running Bot before migrating instance declarations.');
}
async function withProjectLock<T>(root: string, operation: () => Promise<T>, recovery = false): Promise<T> {
  await mkdir(join(root, '.zhin'), { recursive: true });
  const file = join(root, '.zhin/plugin-management.lock');
  const nonce = randomUUID();
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (!recovery || !(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw new Error('Project plugin management is locked; stop its writer before retrying.', { cause: error });
    const identity = await lstat(file);
    if (!identity.isFile()) throw new Error('Invalid migration project lock', { cause: error });
    const previous = await readFile(file, 'utf8');
    const owner = JSON.parse(previous) as { pid?: unknown };
    if (typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid migration lock owner; inspect it manually.', { cause: error });
    let exited = false;
    try { process.kill(owner.pid, 0); }
    catch (probe) { if (probe instanceof Error && 'code' in probe && probe.code === 'ESRCH') exited = true; else throw probe; }
    if (!exited) throw new Error('Migration project lock belongs to a running process.', { cause: error });
    const current = await lstat(file);
    if (current.dev !== identity.dev || current.ino !== identity.ino || await readFile(file, 'utf8') !== previous) throw new Error('Migration lock changed during recovery', { cause: error });
    await rm(file);
    handle = await open(file, 'wx', 0o600);
  }
  const marker = JSON.stringify({ pid: process.pid, nonce });
  try { await handle.writeFile(marker); return await operation(); }
  finally { await handle.close(); if (await readFile(file, 'utf8') === marker) await rm(file); }
}
