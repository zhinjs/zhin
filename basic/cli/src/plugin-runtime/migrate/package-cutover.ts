import { link, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type CutoverCapability = 'command' | 'component' | 'middleware';
export type PackageCutoverMode = 'development' | 'publish';

export interface PackageCutoverPlan {
  readonly root: string;
  readonly packageFile: string;
  /** Source entry authored by the user. */
  readonly entryFile: string;
  /** Entry consumed by the Plugin Runtime manifest. */
  readonly manifestEntry: './plugin.ts' | './plugin.js';
  readonly mode: PackageCutoverMode;
  readonly buildConfigFile?: string;
  readonly buildConfigContent?: string;
  readonly buildConfigAlreadyPrepared: boolean;
  readonly capabilities: readonly CutoverCapability[];
  readonly dependencies: Readonly<Record<string, string>>;
  readonly originalPackage: string;
  readonly candidatePackage: string;
  readonly entryContent: string;
  readonly entryAlreadyPrepared: boolean;
  readonly changed: boolean;
}

const LATEST = 'latest';
const publishBuildConfig = 'tsconfig.zhin.json';

const capabilityProviders: Readonly<Record<CutoverCapability, string>> = Object.freeze({
  command: '@zhin.js/command',
  component: '@zhin.js/component',
  middleware: '@zhin.js/middleware',
});

const capabilityDirectories: Readonly<Record<CutoverCapability, string>> = Object.freeze({
  command: 'commands',
  component: 'components',
  middleware: 'middlewares',
});

const publishedFiles = Object.freeze([
  'plugin.js',
  'plugin.d.ts',
  'commands',
  'components',
  'middlewares',
  'src',
  'schema.json',
  'README.md',
]);

/** Builds a Plugin Runtime manifest without mutating legacy source. */
export class PackageCutover {
  async plan(projectRoot: string): Promise<PackageCutoverPlan> {
    const root = resolve(projectRoot);
    const packageFile = join(root, 'package.json');
    const entryFile = join(root, 'plugin.ts');
    const originalPackage = await readFile(packageFile, 'utf8');
    const value = parsePackage(packageFile, originalPackage);
    const mode = cutoverMode(value);
    const manifestEntry = mode === 'development' ? './plugin.ts' : './plugin.js';
    const entryContent = renderEntry(pluginName(value.name));
    const capabilities = await discoverCapabilities(root);
    const existingManifest = parseManifest(value.zhin, packageFile);

    if (existingManifest && !isPluginManifest(existingManifest)) {
      throw new Error(`${packageFile} already contains a zhin manifest; migrate it manually`);
    }

    if (existingManifest) {
      await assertExistingEntry(entryFile);
      await assertCompletedDependencies(root, value, existingManifest, capabilities);
    }

    const dependencies = withRuntimeDependencies(value.dependencies, capabilities, !existingManifest);
    const devDependencies = withDevelopmentDependencies(value.devDependencies);
    const candidate = createCandidatePackage(value, {
      mode,
      manifestEntry,
      capabilities,
      dependencies,
      devDependencies,
      existingManifest,
    });
    const candidatePackage = `${JSON.stringify(candidate, null, 2)}\n`;
    const buildConfigFile = mode === 'publish' ? join(root, publishBuildConfig) : undefined;
    const buildConfigContent = mode === 'publish' ? renderPublishBuildConfig() : undefined;
    const entryAlreadyPrepared = existingManifest
      ? true
      : await preparedEntry(entryFile, entryContent);
    const buildConfigAlreadyPrepared = buildConfigFile && buildConfigContent
      ? await preparedFile(buildConfigFile, buildConfigContent)
      : false;

    return freezePlan({
      root,
      packageFile,
      entryFile,
      manifestEntry,
      mode,
      buildConfigFile,
      buildConfigContent,
      buildConfigAlreadyPrepared,
      originalPackage,
      entryContent,
      capabilities,
      dependencies: Object.freeze({ ...dependencies }),
      candidatePackage,
      entryAlreadyPrepared,
      changed: candidatePackage !== originalPackage
        || !entryAlreadyPrepared
        || (mode === 'publish' && !buildConfigAlreadyPrepared),
    });
  }

  async apply(plan: PackageCutoverPlan): Promise<void> {
    if (!plan.changed) return;
    assertPlanPaths(plan);
    if (await readFile(plan.packageFile, 'utf8') !== plan.originalPackage) {
      throw new Error('package.json changed after cutover planning');
    }

    const nonce = `${process.pid}-${Date.now()}`;
    const entryTemporary = `${plan.entryFile}.zhin-cutover-${nonce}.tmp`;
    const buildConfigTemporary = plan.buildConfigFile
      ? `${plan.buildConfigFile}.zhin-cutover-${nonce}.tmp`
      : undefined;
    const packageTemporary = `${plan.packageFile}.zhin-cutover-${nonce}.tmp`;
    let publishedEntry = false;
    let publishedBuildConfig = false;
    try {
      if (!plan.entryAlreadyPrepared) {
        await mkdir(dirname(plan.entryFile), { recursive: true });
        await writeFile(entryTemporary, plan.entryContent, { flag: 'wx' });
        await link(entryTemporary, plan.entryFile);
        publishedEntry = true;
        await rm(entryTemporary);
      } else if (!plan.buildConfigFile) {
        await assertPreparedEntry(plan.entryFile, plan.entryContent);
      }

      if (plan.buildConfigFile && plan.buildConfigContent) {
        if (!plan.buildConfigAlreadyPrepared) {
          await writeFile(buildConfigTemporary!, plan.buildConfigContent, { flag: 'wx' });
          await link(buildConfigTemporary!, plan.buildConfigFile);
          publishedBuildConfig = true;
          await rm(buildConfigTemporary!);
        } else {
          await assertPreparedFile(plan.buildConfigFile, plan.buildConfigContent);
        }
      }

      // package.json is the commit record. Publishing it last keeps generated
      // files inert and makes an interrupted transaction safe to retry.
      await writeFile(packageTemporary, plan.candidatePackage, { flag: 'wx' });
      if (await readFile(plan.packageFile, 'utf8') !== plan.originalPackage) {
        throw new Error('package.json changed during cutover');
      }
      await rename(packageTemporary, plan.packageFile);
    } catch (error) {
      await Promise.allSettled([
        rm(entryTemporary, { force: true }),
        ...(buildConfigTemporary ? [rm(buildConfigTemporary, { force: true })] : []),
        rm(packageTemporary, { force: true }),
        ...(publishedEntry ? [rm(plan.entryFile, { force: true })] : []),
        ...(publishedBuildConfig && plan.buildConfigFile ? [rm(plan.buildConfigFile, { force: true })] : []),
      ]);
      throw error;
    }
  }
}

interface MutablePackage {
  readonly name: string;
  readonly private?: boolean;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly scripts?: Record<string, string>;
  readonly files?: unknown;
  readonly zhin?: unknown;
  readonly [key: string]: unknown;
}

interface PluginManifest extends Record<string, unknown> {
  readonly protocol: 1;
  readonly type: 'plugin';
  readonly entry: string;
}

function parsePackage(file: string, source: string): MutablePackage {
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new Error(`${file} is not valid JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} must contain an object`);
  }
  const candidate = value as Partial<MutablePackage>;
  if (typeof candidate.name !== 'string') throw new Error(`${file} requires a package name`);
  assertDependencyObject(file, 'dependencies', candidate.dependencies);
  assertDependencyObject(file, 'devDependencies', candidate.devDependencies);
  if (candidate.scripts !== undefined
    && (!candidate.scripts || typeof candidate.scripts !== 'object' || Array.isArray(candidate.scripts))) {
    throw new Error(`${file} scripts must be an object`);
  }
  if (candidate.files !== undefined && !Array.isArray(candidate.files)) {
    throw new Error(`${file} files must be an array when present`);
  }
  return candidate as MutablePackage;
}

function assertDependencyObject(
  file: string,
  key: 'dependencies' | 'devDependencies',
  value: unknown,
): void {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`${file} ${key} must be an object`);
  }
}

function cutoverMode(pkg: MutablePackage): PackageCutoverMode {
  return pkg.private === true ? 'development' : 'publish';
}

function pluginName(packageName: string): string {
  const local = packageName.slice(packageName.lastIndexOf('/') + 1)
    .replace(/[^a-zA-Z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(local)) {
    throw new Error(`Package name cannot become a Plugin identity: ${packageName}`);
  }
  return local;
}

function renderEntry(name: string): string {
  return [
    "import { definePlugin } from '@zhin.js/plugin-runtime';",
    '',
    `export default definePlugin({ name: '${name}' });`,
    '',
  ].join('\n');
}

function renderPublishBuildConfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      declaration: true,
      declarationMap: false,
      sourceMap: false,
      jsx: 'react-jsx',
      jsxImportSource: 'zhin.js',
      skipLibCheck: true,
    },
    include: [
      'plugin.ts',
      'commands/**/*.ts',
      'commands/**/*.tsx',
      'components/**/*.ts',
      'components/**/*.tsx',
      'middlewares/**/*.ts',
      'middlewares/**/*.tsx',
      'src/**/*.ts',
      'src/**/*.tsx',
    ],
  }, null, 2)}\n`;
}

function withRuntimeDependencies(
  existing: Record<string, string> | undefined,
  capabilities: readonly CutoverCapability[],
  scaffold: boolean,
): Record<string, string> {
  const dependencies = { ...existing };
  setRequiredDependency(dependencies, 'zhin.js');
  // 仅全新 cutover（尚无 zhin manifest）按约定目录补齐能力依赖；
  // 已迁移项目尊重作者声明——Stable Features 可由 zhin.js 挂载，不强制逐项依赖。
  if (!scaffold) return dependencies;
  setRequiredDependency(dependencies, '@zhin.js/plugin-runtime');
  setRequiredDependency(dependencies, '@zhin.js/runtime');
  for (const capability of capabilities) setRequiredDependency(dependencies, capabilityProviders[capability]);
  return dependencies;
}

function withDevelopmentDependencies(existing: Record<string, string> | undefined): Record<string, string> {
  const dependencies = { ...existing };
  setRequiredDependency(dependencies, '@zhin.js/cli');
  setRequiredDependency(dependencies, 'typescript');
  return dependencies;
}

function setRequiredDependency(dependencies: Record<string, string>, name: string): void {
  if (dependencies[name] === undefined || dependencies[name] === '^0.0.0' || dependencies[name] === '0.0.0') {
    dependencies[name] = LATEST;
  }
}

function createCandidatePackage(
  pkg: MutablePackage,
  options: {
    readonly mode: PackageCutoverMode;
    readonly manifestEntry: './plugin.ts' | './plugin.js';
    readonly capabilities: readonly CutoverCapability[];
    readonly dependencies: Record<string, string>;
    readonly devDependencies: Record<string, string>;
    readonly existingManifest?: PluginManifest;
  },
): Record<string, unknown> {
  const manifest = {
    ...(options.existingManifest ?? {}),
    protocol: 1,
    type: 'plugin',
    entry: options.manifestEntry,
    engine: '^1.0.0',
    runtime: 'trusted',
    // 已有 manifest 时尊重作者声明的 features（Stable Features 由 runtime 挂载，
    // 无需重复声明）；仅全新 cutover 才按发现的约定目录生成声明。
    features: Array.isArray(options.existingManifest?.features)
      ? options.existingManifest.features
      : options.capabilities.map((capability) => ({
        package: capabilityProviders[capability],
        api: '^1.0.0',
      })),
    plugins: Array.isArray(options.existingManifest?.plugins) ? options.existingManifest.plugins : [],
  };
  const scripts = runtimeScripts(pkg.scripts, options.mode);
  const candidate: Record<string, unknown> = {
    ...pkg,
    type: typeof pkg.type === 'string' ? pkg.type : 'module',
    dependencies: options.dependencies,
    devDependencies: options.devDependencies,
    scripts,
    zhin: manifest,
  };
  if (options.mode === 'publish') candidate.files = mergeFiles(pkg.files);
  return candidate;
}

function runtimeScripts(
  existing: Record<string, string> | undefined,
  mode: PackageCutoverMode,
): Record<string, string> {
  const scripts = { ...existing };
  replaceMissingOrLegacyScript(scripts, 'dev', 'zhin runtime start', ['zhin dev']);
  replaceMissingOrLegacyScript(scripts, 'start', 'zhin runtime start', ['zhin start']);
  replaceMissingOrLegacyScript(scripts, 'daemon', 'zhin runtime start --daemon', ['zhin start --daemon']);
  replaceMissingOrLegacyScript(
    scripts,
    'build',
    mode === 'publish' ? 'pnpm run zhin:build' : 'tsc --noEmit',
    ['zhin build'],
  );
  if (mode === 'publish') {
    scripts['zhin:build'] = 'tsc -p tsconfig.zhin.json';
    scripts.prepack = appendScript(scripts.prepack, 'pnpm run zhin:build');
    scripts.prepublishOnly = appendScript(scripts.prepublishOnly, 'pnpm run zhin:build');
  }
  return scripts;
}

function replaceMissingOrLegacyScript(
  scripts: Record<string, string>,
  name: string,
  replacement: string,
  legacy: readonly string[],
): void {
  if (scripts[name] === undefined || legacy.includes(scripts[name].trim())) scripts[name] = replacement;
}

function appendScript(existing: string | undefined, command: string): string {
  if (!existing || existing.includes(command)) return existing || command;
  return `${existing} && ${command}`;
}

function mergeFiles(current: unknown): string[] {
  const existing = Array.isArray(current) ? current.filter((file): file is string => typeof file === 'string') : [];
  return [...new Set([...existing, ...publishedFiles])];
}

async function discoverCapabilities(root: string): Promise<CutoverCapability[]> {
  const result: CutoverCapability[] = [];
  for (const capability of ['command', 'component', 'middleware'] as const) {
    if (await directoryContainsSource(join(root, capabilityDirectories[capability]))) result.push(capability);
  }
  return result;
}

async function directoryContainsSource(directory: string): Promise<boolean> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return false; }
  for (const entry of entries) {
    if (entry.isDirectory() && await directoryContainsSource(join(directory, entry.name))) return true;
    if (entry.isFile() && /\.tsx?$/u.test(entry.name)) return true;
  }
  return false;
}

function parseManifest(value: unknown, packageFile: string): PluginManifest | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${packageFile} already contains a zhin manifest; migrate it manually`);
  }
  return value as PluginManifest;
}

function isPluginManifest(value: PluginManifest): boolean {
  return value.protocol === 1
    && value.type === 'plugin'
    && (value.entry === './plugin.ts' || value.entry === './plugin.js');
}

function capabilitiesFromManifest(manifest: Record<string, unknown>): CutoverCapability[] {
  if (!Array.isArray(manifest.features)) return [];
  const byProvider = new Map(Object.entries(capabilityProviders).map(([key, value]) => [value, key]));
  return manifest.features.flatMap((feature) => {
    if (!feature || typeof feature !== 'object') return [];
    const capability = byProvider.get((feature as Record<string, unknown>).package as string);
    return capability ? [capability as CutoverCapability] : [];
  });
}

async function assertCompletedDependencies(
  root: string,
  pkg: MutablePackage,
  manifest: Record<string, unknown>,
  capabilities: readonly CutoverCapability[],
): Promise<void> {
  const declared = capabilitiesFromManifest(manifest).sort();
  const discovered = [...capabilities].sort();
  if (declared.some((value) => !discovered.includes(value))) {
    throw new Error('Existing zhin manifest does not match discovered capability directories');
  }
  const hasFacadeOrCarrier = typeof pkg.dependencies?.['zhin.js'] === 'string'
    || typeof pkg.dependencies?.['@zhin.js/core'] === 'string';
  if (!hasFacadeOrCarrier
    && (declared.length !== discovered.length
      || declared.some((value, index) => value !== discovered[index]))) {
    throw new Error('Existing zhin manifest does not match discovered capability directories');
  }
  const required = hasFacadeOrCarrier
    ? []
    : [
      '@zhin.js/plugin-runtime',
      '@zhin.js/runtime',
      'zhin.js',
      ...capabilities.map((capability) => capabilityProviders[capability]),
    ];
  const missing = required.filter((dependency) => typeof pkg.dependencies?.[dependency] !== 'string');
  if (missing.length > 0) {
    throw new Error(`Existing cutover is missing dependencies: ${missing.join(', ')}`);
  }
}

async function preparedEntry(file: string, expected: string): Promise<boolean> {
  return preparedFile(file, expected);
}

async function preparedFile(file: string, expected: string): Promise<boolean> {
  try {
    const actual = await readFile(file, 'utf8');
    if (actual !== expected) throw new Error(`${file} already exists with different content`);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function assertPreparedEntry(file: string, expected: string): Promise<void> {
  if (!await preparedEntry(file, expected)) throw new Error(`${file} is missing`);
}

async function assertPreparedFile(file: string, expected: string): Promise<void> {
  if (!await preparedFile(file, expected)) throw new Error(`${file} is missing`);
}

async function assertExistingEntry(file: string): Promise<void> {
  try {
    await readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) throw new Error(`${file} is missing`, { cause: error });
    throw error;
  }
}

function assertPlanPaths(plan: PackageCutoverPlan): void {
  const publishesJavaScript = plan.mode === 'publish';
  if (plan.packageFile !== join(plan.root, 'package.json')
    || plan.entryFile !== join(plan.root, 'plugin.ts')
    || plan.manifestEntry !== (publishesJavaScript ? './plugin.js' : './plugin.ts')
    || (publishesJavaScript !== (plan.buildConfigFile !== undefined))
    || (publishesJavaScript !== (plan.buildConfigContent !== undefined))
    || (plan.buildConfigFile !== undefined && plan.buildConfigFile !== join(plan.root, publishBuildConfig))) {
    throw new Error('Invalid package cutover paths');
  }
}

function freezePlan(plan: PackageCutoverPlan): PackageCutoverPlan {
  return Object.freeze({ ...plan, capabilities: Object.freeze([...plan.capabilities]) });
}

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
