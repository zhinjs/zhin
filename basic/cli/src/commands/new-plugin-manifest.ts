import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_ENGINES_HINT } from '../utils/node-requirements.js';

export type PluginKind = 'normal' | 'service' | 'adapter';

/** Zhin packages a scaffolded plugin may reference (peer + dev). */
export const PLUGIN_STACK_PACKAGES = [
  'zhin.js',
  '@zhin.js/skill',
  '@zhin.js/command',
  '@zhin.js/adapter',
] as const;
export type PluginStackPackage = (typeof PLUGIN_STACK_PACKAGES)[number];
export type PluginStackRanges = Record<PluginStackPackage, string>;

/** Used when no installed copy can be found; matches `zhin.engine` / feature `api`. */
export const FALLBACK_STACK_RANGE = '^1.0.0';

/**
 * Tooling for the generated package. Kept in step with the repository root
 * devDependencies (asserted by tests/new-plugin-manifest.test.ts).
 */
export const PLUGIN_TOOLING_RANGES = {
  '@types/node': '^26.1.2',
  typescript: '^6.0.3',
  vitest: '^4.1.11',
  rimraf: '^6.1.3',
} as const;

const SEMVER_PREFIX = /^(\d+)\.(\d+)\.(\d+)/;

/** `1.1.8-beta.0` → `^1.1.8`; non-semver → undefined. */
export function caretRange(version: string | undefined): string | undefined {
  const match = version ? SEMVER_PREFIX.exec(version.trim()) : null;
  return match ? `^${match[1]}.${match[2]}.${match[3]}` : undefined;
}

/**
 * Find the version of an installed package by walking `node_modules` upwards
 * from `fromDir`. Reads package.json from disk directly, so packages whose
 * `exports` do not expose `./package.json` still resolve.
 */
export function findInstalledVersion(packageName: string, fromDir: string): string | undefined {
  let current = path.resolve(fromDir);
  while (true) {
    const manifest = path.join(current, 'node_modules', ...packageName.split('/'), 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const version = (fs.readJsonSync(manifest) as { version?: unknown }).version;
        if (typeof version === 'string') return version;
      } catch {
        /* unreadable manifest: keep walking */
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function cliPackageDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Resolve semver ranges (`^x.y.z`) for the Zhin stack. Prefers what the host
 * project (cwd) has installed, then what this CLI was installed with, and
 * finally a wide `^1.0.0`. Never returns `latest` (pnpm rejects it for peers).
 */
export function resolvePluginStackRanges(
  cwd: string,
  searchDirs: readonly string[] = [cliPackageDir()],
): PluginStackRanges {
  const ranges = {} as PluginStackRanges;
  for (const name of PLUGIN_STACK_PACKAGES) {
    let range: string | undefined;
    for (const dir of [cwd, ...searchDirs]) {
      range = caretRange(findInstalledVersion(name, dir));
      if (range) break;
    }
    ranges[name] = range ?? FALLBACK_STACK_RANGE;
  }
  return ranges;
}

/**
 * Inside this monorepo (root has pnpm-workspace.yaml + packages/im/zhin and
 * declares zhin.js), link the stack with workspace protocols instead.
 */
export function workspaceStackRanges(root: string): { peer: PluginStackRanges; dev: PluginStackRanges } | null {
  if (!fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))) return null;
  if (!fs.existsSync(path.join(root, 'packages/im/zhin/package.json'))) return null;
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = fs.readJsonSync(pkgPath) as Record<string, Record<string, string> | undefined>;
    const hasZhin =
      pkg.dependencies?.['zhin.js'] || pkg.devDependencies?.['zhin.js'] || pkg.peerDependencies?.['zhin.js'];
    if (!hasZhin) return null;
  } catch {
    return null;
  }
  const fill = (spec: string) =>
    Object.fromEntries(PLUGIN_STACK_PACKAGES.map((name) => [name, spec])) as PluginStackRanges;
  // Repository policy: peers use workspace:^, everything else workspace:*.
  return { peer: fill('workspace:^'), dev: fill('workspace:*') };
}

const OFFICIAL_SCOPE = '@zhin.js/';
const NPM_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/**
 * Default npm name: third-party plugins get an unscoped `zhin.js-<name>`
 * (the community prefix `zhin search` understands). `@zhin.js/*` is only used
 * with `--is-official`; an explicit `--package-name` wins over both.
 */
export function resolvePluginPackageName(
  pluginName: string,
  options: { isOfficial?: boolean; packageName?: string },
): string {
  if (options.packageName) {
    const name = options.packageName.trim();
    if (!NPM_NAME_PATTERN.test(name)) {
      throw new Error(`无效的 npm 包名: ${name}`);
    }
    if (name.startsWith(OFFICIAL_SCOPE) && !options.isOfficial) {
      throw new Error(`${OFFICIAL_SCOPE} 作用域保留给官方插件；第三方插件请换一个包名，或使用自己的 npm scope`);
    }
    return name;
  }
  return options.isOfficial ? `${OFFICIAL_SCOPE}${pluginName}` : `zhin.js-${pluginName}`;
}

export interface PluginManifestInput {
  pluginName: string;
  packageName: string;
  kind: PluginKind;
  description: string;
  keywords: string[];
  peerRanges: PluginStackRanges;
  devRanges: PluginStackRanges;
}

/** Capability (Feature) packages the template's convention directories use. */
export function capabilityPackages(kind: PluginKind): PluginStackPackage[] {
  const packages: PluginStackPackage[] = ['@zhin.js/skill'];
  if (kind === 'normal') packages.push('@zhin.js/command');
  if (kind === 'adapter') packages.push('@zhin.js/adapter');
  return packages;
}

/** Directories whose TypeScript the build turns into sibling JavaScript. */
export function sourceDirectories(kind: PluginKind): string[] {
  return ['src', ...(kind === 'normal' ? ['commands'] : []), ...(kind === 'adapter' ? ['adapters'] : [])];
}

/**
 * package.json for `zhin new`. Follows docs/authoring/define-plugin.md and
 * plugin-delivery.md:
 * - capability packages are optional peers (one shared copy from the host),
 *   duplicated in devDependencies so tests/tsc work standalone;
 * - npm gets JavaScript: `zhin.entry` is `./plugin.js` (the runtime falls back
 *   to `plugin.ts` in a local workspace) and `prepack` builds sibling .js files.
 */
export function createPluginManifest(input: PluginManifestInput): Record<string, unknown> {
  const { kind, peerRanges, devRanges } = input;
  const capabilities = capabilityPackages(kind);

  const peerDependencies: Record<string, string> = { 'zhin.js': peerRanges['zhin.js'] };
  const peerDependenciesMeta: Record<string, { optional: true }> = {};
  const devDependencies: Record<string, string> = {
    ...PLUGIN_TOOLING_RANGES,
    'zhin.js': devRanges['zhin.js'],
  };
  for (const name of capabilities) {
    peerDependencies[name] = peerRanges[name];
    peerDependenciesMeta[name] = { optional: true };
    devDependencies[name] = devRanges[name];
  }

  const directories = sourceDirectories(kind);
  const jsGlobs = ['plugin.js', ...directories.map((dir) => `${dir}/**/*.js`)];

  return {
    name: input.packageName,
    version: '0.1.0',
    description: input.description,
    type: 'module',
    exports: {
      './package.json': './package.json',
    },
    files: ['plugin.js', 'schema.json', ...directories, 'skills', 'README.md', 'CHANGELOG.md'],
    scripts: {
      build: 'tsc -p tsconfig.build.json',
      typecheck: 'tsc --noEmit',
      clean: `rimraf --glob ${jsGlobs.map((glob) => `"${glob}"`).join(' ')}`,
      test: 'vitest run',
      'test:watch': 'vitest',
      // npm 只拿到 JavaScript：pnpm pack / pnpm publish 前把 plugin.ts 与约定目录编译成同目录 .js
      prepack: 'pnpm run build',
    },
    keywords: input.keywords,
    author: '',
    license: 'MIT',
    peerDependencies,
    peerDependenciesMeta,
    devDependencies,
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' },
    engines: { node: NODE_ENGINES_HINT },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.js',
      engine: '^1.0.0',
      runtime: 'trusted',
      features: capabilities.map((name) => ({ package: name, api: '^1.0.0' })),
      plugins: [],
    },
  };
}

/** Type-check config (includes tests) and the emit config used by `pnpm build`. */
export function createPluginTsconfigs(kind: PluginKind): {
  tsconfig: Record<string, unknown>;
  build: Record<string, unknown>;
} {
  const sources = ['plugin.ts', ...sourceDirectories(kind).map((dir) => `${dir}/**/*`)];
  return {
    tsconfig: {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        isolatedModules: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        types: ['node'],
      },
      include: [...sources, 'tests/**/*', 'vitest.config.ts'],
      exclude: ['node_modules'],
    },
    build: {
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: false,
        allowImportingTsExtensions: false,
        // 与源码同目录输出 .js：本地运行时优先加载 .ts，从 node_modules 加载时使用 .js
        declaration: false,
        sourceMap: false,
      },
      include: sources,
      exclude: ['node_modules', 'tests', '**/*.test.ts'],
    },
  };
}
