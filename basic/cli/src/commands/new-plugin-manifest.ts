import fs from 'fs-extra';
import path from 'node:path';
import { createRequire } from 'node:module';
import { scaffoldDependencyRange, type StackVersionRanges } from '@zhin.js/scaffold-wizard';
import { NODE_ENGINES_HINT } from '../utils/node-requirements.js';

export type PluginKind = 'normal' | 'service' | 'adapter';

/** Zhin packages a scaffolded plugin may reference (peer + dev). */
export const PLUGIN_STACK_PACKAGES = [
  'zhin.js',
  '@zhin.js/skill',
  '@zhin.js/command',
  '@zhin.js/adapter',
  '@zhin.js/feature-kit',
  '@zhin.js/testing',
] as const;
export type PluginStackPackage = (typeof PLUGIN_STACK_PACKAGES)[number];
export type PluginStackRanges = Record<PluginStackPackage, string>;

/**
 * Tooling for the generated package. Kept in step with the repository root
 * devDependencies (asserted by tests/new-plugin-manifest.test.ts).
 */
export const PLUGIN_TOOLING_RANGES = {
  '@types/node': '^26.1.2',
  typescript: '^6.0.3',
  vitest: '^4.1.12',
  rimraf: '^6.1.3',
} as const;

const require = createRequire(import.meta.url);
const semver = require('semver') as {
  valid(version: string): string | null;
  gt(left: string, right: string): boolean;
  satisfies(version: string, range: string, options: { includePrerelease: boolean }): boolean;
};

/** Preserve the concrete version, including prerelease identity; never turn a beta into a stable claim. */
export function caretRange(version: string | undefined): string | undefined {
  const valid = version ? semver.valid(version.trim()) : null;
  return valid ? `^${valid}` : undefined;
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

/**
 * The CLI's existing packed release metadata sets its authoring floor. A higher compatible installed host
 * version may raise that floor, but an old host never lowers it. No project dependency is rewritten.
 * Tests may supply the same metadata shape; unknown release versions are a generation error.
 */
export function resolvePluginStackRanges(
  cwd: string,
  releaseRanges?: StackVersionRanges,
): PluginStackRanges {
  const ranges = {} as PluginStackRanges;
  for (const name of PLUGIN_STACK_PACKAGES) {
    const released = scaffoldDependencyRange(name, releaseRanges);
    const floor = released.startsWith('^') ? semver.valid(released.slice(1)) : null;
    if (!floor) throw new Error(`Cannot create plugin: release version is unavailable for ${name}`);
    const installed = caretRange(findInstalledVersion(name, cwd));
    ranges[name] = installed && semver.satisfies(installed.slice(1), released, { includePrerelease: true })
      && semver.gt(installed.slice(1), floor) ? installed : released;
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

/**
 * Server-side convention directories (docs/authoring/conventions.md) whose TypeScript the build
 * turns into sibling JavaScript. Every kind lists all of them, so adding e.g. `tools/` later does
 * not need edits to `files` / tsconfig: a forgotten entry used to drop the directory from the
 * tarball silently. Globs that match nothing are harmless. `components/` (TSX) and `pages/`
 * (Console client build) need their own build setup and are not part of the default template.
 */
export const CONVENTION_SOURCE_DIRECTORIES = [
  'commands',
  'middlewares',
  'handlers',
  'schedules',
  'tools',
  'prompt-sections',
  'hooks',
  'mcps',
  'adapters',
] as const;

/** Convention directories shipped as-is (Markdown / JSON assets). */
export const CONVENTION_ASSET_DIRECTORIES = ['skills', 'agents'] as const;

/** Library code: TypeScript in `src/` → JavaScript + `.d.ts` in `lib/` (docs/contributing/publishing.md#发布包目录规范). */
export const LIBRARY_SOURCE_DIRECTORY = 'src';

/**
 * Runtime entries the Plugin Runtime scans from the package root: `plugin.ts` plus convention
 * directories. They stay TypeScript in the repo; `prepack` writes sibling JavaScript and `postpack`
 * removes it again (same flow as the official plugins' build-plugin-runtime-entries.mjs).
 */
export function runtimeEntrySources(): string[] {
  return ['plugin.ts', ...CONVENTION_SOURCE_DIRECTORIES.map((dir) => `${dir}/**/*`)];
}

/** Generated JavaScript the tarball ships for runtime entries (never their `.ts`). */
export function runtimeEntryJsGlobs(): string[] {
  return ['plugin.js', ...CONVENTION_SOURCE_DIRECTORIES.map((dir) => `${dir}/**/*.js`)];
}

/** Path of the runtime-entry builder inside a generated plugin. */
export const RUNTIME_ENTRIES_SCRIPT_PATH = 'scripts/build-runtime-entries.mjs';

/**
 * Standalone copy of scripts/build-plugin-runtime-entries.mjs for generated plugins: transpiles
 * `plugin.ts` and convention-directory TypeScript into sibling `.js`, rewriting relative imports of
 * `src/` to `lib/` (and `.ts` specifiers to `.js`). `--clean` removes only files it generated.
 */
export const RUNTIME_ENTRIES_SCRIPT = String.raw`// Builds the Plugin Runtime entries that npm receives: plugin.ts and convention-directory
// TypeScript -> sibling .js, with relative imports of src/ rewritten to lib/ (built by tsc).
// Runs in prepack; postpack runs it with --clean. Workspace tests and HMR keep using TypeScript.
import { readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';

const MARKER = '// Generated by scripts/build-runtime-entries.mjs. Do not edit.\n';
const DIRECTORIES = ${JSON.stringify([...CONVENTION_SOURCE_DIRECTORIES])};
const root = process.cwd();

async function walk(directory, extensions, result = []) {
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await walk(file, extensions, result);
    else if (extensions.includes(extname(entry.name)) && !entry.name.endsWith('.d.ts')
      && !/\.(test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) result.push(file);
  }
  return result;
}

async function isFile(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

async function clean() {
  const candidates = [join(root, 'plugin.js')];
  for (const directory of DIRECTORIES) await walk(join(root, directory), ['.js'], candidates);
  for (const file of candidates) {
    if (await isFile(file) && (await readFile(file, 'utf8')).startsWith(MARKER)) await unlink(file);
  }
}

function rewrite(context) {
  const literal = (node) => {
    const value = node.text;
    if (!value.startsWith('.')) return node;
    const next = value.replace(/(^|\/)src\//u, '$1lib/').replace(/\.tsx?$/u, '.js');
    return next === value ? node : context.factory.createStringLiteral(next);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
        literal(node.moduleSpecifier), node.attributes);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      return context.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause,
        literal(node.moduleSpecifier), node.attributes);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      return context.factory.updateCallExpression(node, node.expression, node.typeArguments,
        [literal(node.arguments[0])]);
    }
    return ts.visitEachChild(node, visit, context);
  };
  return (sourceFile) => ts.visitNode(sourceFile, visit);
}

await clean();
if (!process.argv.includes('--clean')) {
  const sources = [];
  if (await isFile(join(root, 'plugin.ts'))) sources.push(join(root, 'plugin.ts'));
  for (const directory of DIRECTORIES) await walk(join(root, directory), ['.ts', '.tsx'], sources);
  for (const source of sources) {
    const output = ts.transpileModule(await readFile(source, 'utf8'), {
      fileName: source,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true },
      transformers: { before: [rewrite] },
      reportDiagnostics: true,
    });
    const errors = (output.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) {
      throw new Error('Cannot build ' + relative(root, source) + ': '
        + ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'));
    }
    await writeFile(source.replace(/\.tsx?$/u, '.js'), MARKER + output.outputText, 'utf8');
  }
  console.log('Built ' + sources.length + ' Plugin Runtime entries.');
}
`;

/**
 * package.json for `zhin new`. Follows docs/authoring/define-plugin.md and
 * plugin-delivery.md:
 * - capability packages are optional peers (one shared copy from the host),
 *   duplicated in devDependencies so tests/tsc work standalone;
 * - npm gets JavaScript: `zhin.entry` is `./plugin.js` (the runtime falls back
 *   to `plugin.ts` in a local workspace); `src/` builds to `lib/` with `.d.ts`,
 *   and `prepack` writes sibling .js for runtime entries (removed in `postpack`).
 */
export function createPluginManifest(input: PluginManifestInput): Record<string, unknown> {
  const { kind, peerRanges, devRanges } = input;
  const capabilities = capabilityPackages(kind);

  const peerDependencies: Record<string, string> = { 'zhin.js': peerRanges['zhin.js'] };
  const peerDependenciesMeta: Record<string, { optional: true }> = {};
  const devDependencies: Record<string, string> = {
    ...PLUGIN_TOOLING_RANGES,
    'zhin.js': devRanges['zhin.js'],
    // Typed fakes for the generated tests (no `as never`); see docs/authoring/testing.md.
    '@zhin.js/testing': devRanges['@zhin.js/testing'],
  };
  // Type augmentation is a direct contract dependency, not a Feature provider.
  if (kind === 'adapter') {
    peerDependencies['@zhin.js/feature-kit'] = peerRanges['@zhin.js/feature-kit'];
    devDependencies['@zhin.js/feature-kit'] = devRanges['@zhin.js/feature-kit'];
  }
  for (const name of capabilities) {
    peerDependencies[name] = peerRanges[name];
    peerDependenciesMeta[name] = { optional: true };
    devDependencies[name] = devRanges[name];
  }

  return {
    name: input.packageName,
    version: '0.1.0',
    description: input.description,
    type: 'module',
    // Library API (src/ → lib/ with .d.ts). The Plugin Runtime entry is zhin.entry, not exports.
    main: './lib/index.js',
    types: './lib/index.d.ts',
    exports: {
      '.': { types: './lib/index.d.ts', import: './lib/index.js' },
      './package.json': './package.json',
    },
    // Whitelist: built JavaScript + declarations and assets only; no .ts sources, tests or configs.
    files: ['lib', ...runtimeEntryJsGlobs(), 'schema.json', ...CONVENTION_ASSET_DIRECTORIES, 'README.md', 'CHANGELOG.md'],
    scripts: {
      build: 'tsc -p tsconfig.build.json',
      typecheck: 'tsc --noEmit',
      clean: `rimraf lib && node ${RUNTIME_ENTRIES_SCRIPT_PATH} --clean`,
      test: 'vitest run',
      'test:watch': 'vitest',
      // npm 只拿到 JavaScript：pack / publish 前构建 lib/，并把 plugin.ts 与约定目录编译成同目录 .js，打包后清除
      prepack: `pnpm run build && node ${RUNTIME_ENTRIES_SCRIPT_PATH}`,
      postpack: `node ${RUNTIME_ENTRIES_SCRIPT_PATH} --clean`,
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
      features: capabilities.map((name) => ({ package: name, api: name === '@zhin.js/adapter' ? '^2.0.0' : '^1.0.0' })),
      plugins: [],
    },
  };
}

/** Type-check config (includes tests) and the `lib/` emit config used by `pnpm build`. */
export function createPluginTsconfigs(_kind?: PluginKind): {
  tsconfig: Record<string, unknown>;
  build: Record<string, unknown>;
} {
  const library = `${LIBRARY_SOURCE_DIRECTORY}/**/*`;
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
      include: [library, ...runtimeEntrySources(), 'tests/**/*', 'vitest.config.ts'],
      exclude: ['node_modules', 'lib'],
    },
    build: {
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: false,
        allowImportingTsExtensions: false,
        // 库代码 src/ → lib/（.js + .d.ts）；plugin.ts 与约定目录由 prepack 的 scripts/build-runtime-entries.mjs 处理
        rootDir: `./${LIBRARY_SOURCE_DIRECTORY}`,
        outDir: './lib',
        declaration: true,
        sourceMap: false,
      },
      include: [library],
      exclude: ['node_modules', 'lib', 'tests', '**/*.test.ts'],
    },
  };
}
