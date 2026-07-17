import { link, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type CutoverCapability = 'command' | 'component' | 'middleware';

export interface PackageCutoverPlan {
  readonly root: string;
  readonly packageFile: string;
  readonly entryFile: string;
  readonly capabilities: readonly CutoverCapability[];
  readonly dependencies: Readonly<Record<string, string>>;
  readonly originalPackage: string;
  readonly candidatePackage: string;
  readonly entryContent: string;
  readonly entryAlreadyPrepared: boolean;
  readonly changed: boolean;
}

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

/** Builds a Plugin Runtime manifest without mutating legacy source. */
export class PackageCutover {
  async plan(projectRoot: string): Promise<PackageCutoverPlan> {
    const root = resolve(projectRoot);
    const packageFile = join(root, 'package.json');
    const entryFile = join(root, 'plugin.ts');
    const originalPackage = await readFile(packageFile, 'utf8');
    const value = parsePackage(packageFile, originalPackage);
    const entryContent = renderEntry(pluginName(value.name));

    if (value.zhin !== undefined) {
      if (isCompletedManifest(value.zhin)) {
        const capabilities = await discoverCapabilities(root);
        await assertCompletedDependencies(root, value, value.zhin, capabilities);
        await assertPreparedEntry(entryFile, entryContent);
        return freezePlan({
          root, packageFile, entryFile, originalPackage, entryContent,
          capabilities,
          dependencies: Object.freeze({ ...value.dependencies }),
          candidatePackage: originalPackage,
          entryAlreadyPrepared: true,
          changed: false,
        });
      }
      throw new Error(`${packageFile} already contains a zhin manifest; migrate it manually`);
    }

    const capabilities = await discoverCapabilities(root);
    const dependencies: Record<string, string> = {
      ...value.dependencies,
      '@zhin.js/plugin-runtime': '^0.0.0',
      '@zhin.js/runtime': '^1.0.0',
      'zhin.js': '^4.1.2',
    };
    for (const capability of capabilities) {
      dependencies[capabilityProviders[capability]] = '^0.0.0';
    }

    const candidate = {
      ...value,
      dependencies,
      zhin: {
        protocol: 1,
        type: 'plugin',
        entry: './plugin.ts',
        engine: '^1.0.0',
        runtime: 'trusted',
        features: capabilities.map((capability) => ({
          package: capabilityProviders[capability],
          api: '^1.0.0',
        })),
        plugins: [],
      },
    };
    const entryAlreadyPrepared = await preparedEntry(entryFile, entryContent);
    return freezePlan({
      root, packageFile, entryFile, originalPackage, entryContent, capabilities,
      dependencies: Object.freeze({ ...dependencies }),
      candidatePackage: `${JSON.stringify(candidate, null, 2)}\n`,
      entryAlreadyPrepared,
      changed: true,
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
    const packageTemporary = `${plan.packageFile}.zhin-cutover-${nonce}.tmp`;
    let publishedEntry = false;
    try {
      if (!plan.entryAlreadyPrepared) {
        await mkdir(dirname(plan.entryFile), { recursive: true });
        await writeFile(entryTemporary, plan.entryContent, { flag: 'wx' });
        await link(entryTemporary, plan.entryFile);
        publishedEntry = true;
        await rm(entryTemporary);
      } else {
        await assertPreparedEntry(plan.entryFile, plan.entryContent);
      }
      // package.json is the commit record. Publishing it last keeps a prepared
      // entry inert and makes an interrupted transaction safe to retry.
      await writeFile(packageTemporary, plan.candidatePackage, { flag: 'wx' });
      if (await readFile(plan.packageFile, 'utf8') !== plan.originalPackage) {
        throw new Error('package.json changed during cutover');
      }
      await rename(packageTemporary, plan.packageFile);
    } catch (error) {
      await Promise.allSettled([
        rm(entryTemporary, { force: true }),
        rm(packageTemporary, { force: true }),
        ...(publishedEntry ? [rm(plan.entryFile, { force: true })] : []),
      ]);
      throw error;
    }
  }
}

interface MutablePackage {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly zhin?: unknown;
  readonly [key: string]: unknown;
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
  if (candidate.dependencies !== undefined
    && (!candidate.dependencies || typeof candidate.dependencies !== 'object'
      || Array.isArray(candidate.dependencies))) {
    throw new Error(`${file} dependencies must be an object`);
  }
  return candidate as MutablePackage;
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

async function discoverCapabilities(root: string): Promise<CutoverCapability[]> {
  const result: CutoverCapability[] = [];
  for (const capability of ['command', 'component', 'middleware'] as const) {
    if (await directoryContainsSource(join(root, capabilityDirectories[capability]))) {
      result.push(capability);
    }
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


function isCompletedManifest(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
    && (value as Record<string, unknown>).protocol === 1
    && (value as Record<string, unknown>).type === 'plugin'
    && (value as Record<string, unknown>).entry === './plugin.ts';
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
  if (declared.length !== discovered.length
    || declared.some((value, index) => value !== discovered[index])) {
    throw new Error('Existing zhin manifest does not match discovered capability directories');
  }
  const required = [
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

function assertPlanPaths(plan: PackageCutoverPlan): void {
  if (plan.packageFile !== join(plan.root, 'package.json')
    || plan.entryFile !== join(plan.root, 'plugin.ts')) {
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
