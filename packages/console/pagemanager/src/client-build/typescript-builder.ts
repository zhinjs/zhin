import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { build as esbuild } from 'esbuild';
import type { Plugin as EsbuildPlugin } from 'esbuild';
import { pageRoute, type ClientModuleArtifact } from '@zhin.js/console-contract';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import {
  assertLayoutModule,
  extractPageMetadata,
} from './static-metadata.js';
import {
  ALLOWED_ESM_CANONICAL,
  rewriteBareImportsForBrowser,
} from '../node/esmForBrowser.js';
import type {
  ClientArtifactManifest,
  ClientArtifactRecord,
  ClientBuildEntry,
  ClientModuleLoader,
  TypeScriptClientBuilderOptions,
} from './types.js';

const pageFeature = 'zhin.page';
const layoutFeature = 'zhin.layout';

/** Host-shared React/router graph — never bundle (single instance via `/esm/*`). */
const BROWSER_EXTERNALS = [...ALLOWED_ESM_CANONICAL];

/**
 * Browser-only stubs for build-time contracts. Page `meta` is already extracted by
 * static-metadata; the runtime only needs `definePage`/`defineLayout` as identity so
 * we never leave a bare `@zhin.js/*` import for the browser to resolve.
 */
const CONSOLE_CONTRACT_STUB = [
  'export function definePage(metadata = {}) { return metadata; }',
  'export function defineLayout(metadata = {}) { return metadata; }',
  'export function normalizePageMetadata(_name, metadata) { return metadata; }',
  'export function normalizeClientModuleArtifact(value) { return value; }',
].join('\n');

export class TypeScriptClientBuilder implements ClientModuleLoader {
  readonly #outDir: string;
  readonly #projectRoot: string;
  readonly #publicBase: string;
  /** Console public base for rewritten bare imports (`/esm/…`); defaults to `/`. */
  readonly #consoleBasePath: string;
  readonly #manifestFile: string;

  constructor(options: TypeScriptClientBuilderOptions) {
    this.#outDir = resolve(options.outDir);
    this.#projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.#publicBase = `/${trimSlashes(options.publicBase ?? '@zhin/client')}`;
    this.#consoleBasePath = options.consoleBasePath ?? '/';
    this.#manifestFile = resolve(options.manifestFile ?? join(this.#outDir, 'pages.manifest.json'));
  }

  async load<T = unknown>(source: string, request: ClientModuleRequest): Promise<T> {
    const absSource = resolve(source);
    const text = await readFile(absSource, 'utf8');
    const metadata = metadataFor(text, absSource, request);
    const hash = contentHash(text);
    const fileName = `${safe(request.owner)}-${safe(request.localName)}-${hash}.js`;
    const output = join(this.#outDir, fileName);
    // Bundle page TSX (inlines `@zhin.js/console-contract` stubs) + wrap with
    // `export function register(api)` so Remote Console loadConsoleEntries can mount it.
    // Then rewrite React bare imports to Host `/esm/<enc>.mjs`.
    const bundled = await bundlePageEntry(absSource, this.#projectRoot, request, metadata);
    const code = rewriteBareImportsForBrowser(bundled, this.#consoleBasePath, '');
    await atomicWrite(output, code);
    return Object.freeze({
      module: `${this.#publicBase}/${fileName}`,
      hash,
      metadata,
    }) as T;
  }

  async build(entries: readonly ClientBuildEntry[]): Promise<Readonly<ClientArtifactManifest>> {
    const records: ClientArtifactRecord[] = [];
    for (const entry of [...entries].sort(compareEntry)) {
      const artifact = await this.load<ClientModuleArtifact>(entry.source, entry);
      records.push(Object.freeze({
        ...entry,
        source: manifestSource(this.#projectRoot, entry.source),
        ...artifact,
      }));
    }
    const manifest = Object.freeze({
      protocol: 1 as const,
      entries: Object.freeze(records),
    });
    await atomicWrite(this.#manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }
}

type PageMeta = {
  readonly title?: string;
  readonly icon?: string;
  readonly hideInNav?: boolean;
};

async function bundlePageEntry(
  absSource: string,
  projectRoot: string,
  request: ClientModuleRequest,
  metadata: unknown,
): Promise<string> {
  // Layout modules stay bare components (no Console shell register contract).
  if (String(request.feature) === layoutFeature) {
    return bundleSource(absSource, projectRoot);
  }
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as PageMeta;
  const route = safePageRoute(request.owner, request.localName);
  const title = meta.title ?? request.localName;
  const icon = meta.icon;
  const hideInNav = meta.hideInNav === true;
  const wrapperSource = buildPageRegisterWrapper(absSource, {
    route,
    title,
    icon,
    hideInNav,
    localName: request.localName,
  });
  const result = await esbuild({
    stdin: {
      contents: wrapperSource,
      resolveDir: dirname(absSource),
      sourcefile: `${request.localName}.register.tsx`,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
    logLevel: 'silent',
    absWorkingDir: projectRoot,
    nodePaths: [
      join(dirname(absSource), 'node_modules'),
      join(projectRoot, 'node_modules'),
    ],
    external: BROWSER_EXTERNALS,
    plugins: [consoleContractStubPlugin()],
  });
  const file = result.outputFiles?.[0];
  if (!file) throw new Error(`esbuild produced no output for ${absSource}`);
  return file.text;
}

async function bundleSource(absSource: string, projectRoot: string): Promise<string> {
  const result = await esbuild({
    entryPoints: [absSource],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
    logLevel: 'silent',
    absWorkingDir: projectRoot,
    nodePaths: [
      join(dirname(absSource), 'node_modules'),
      join(projectRoot, 'node_modules'),
    ],
    external: BROWSER_EXTERNALS,
    plugins: [consoleContractStubPlugin()],
  });
  const file = result.outputFiles?.[0];
  if (!file) throw new Error(`esbuild produced no output for ${absSource}`);
  return file.text;
}

/**
 * Wrap a convention page (default export component + optional meta) into the
 * Remote Console entry contract: `export function register(api)`.
 */
function buildPageRegisterWrapper(
  absSource: string,
  options: {
    readonly route: string;
    readonly title: string;
    readonly icon?: string;
    readonly hideInNav: boolean;
    readonly localName: string;
  },
): string {
  // abs path import so esbuild resolves the real page regardless of stdin dir.
  const pageImport = JSON.stringify(absSource);
  const route = JSON.stringify(options.route);
  const title = JSON.stringify(options.title);
  const icon = options.icon === undefined ? 'undefined' : JSON.stringify(options.icon);
  const hideInNav = options.hideInNav ? 'true' : 'false';
  const toolId = JSON.stringify(options.localName);
  return `
import Page, * as pageNs from ${pageImport};
export { default } from ${pageImport};
export { meta } from ${pageImport};

export function register(api) {
  const Component = Page?.default ?? Page;
  if (typeof Component !== 'function' && (typeof Component !== 'object' || Component == null)) {
    throw new Error('Page module default export is not a React component');
  }
  const m = pageNs.meta && typeof pageNs.meta === 'object' ? pageNs.meta : {};
  const route = ${route};
  const name = typeof m.title === 'string' && m.title ? m.title : ${title};
  const icon = m.icon ?? ${icon};
  const element = api.React.createElement(Component);
  api.addRoute({
    path: route,
    name,
    element,
    ...(icon != null ? { icon } : {}),
    meta: { hideInMenu: m.hideInNav === true || ${hideInNav} },
  });
  if (typeof api.addTool === 'function') {
    api.addTool({
      id: ${toolId},
      name,
      path: route,
      ...(icon != null ? { icon } : {}),
    });
  }
}
`;
}

/** Safe pageRoute — adversarial/invalid localName falls back to a sanitized path. */
function safePageRoute(owner: string, localName: string): string {
  try {
    return pageRoute(owner, rootPluginId(), localName);
  } catch {
    const slug = safe(localName) || 'page';
    return `/p-${slug}`;
  }
}

function consoleContractStubPlugin(): EsbuildPlugin {
  return {
    name: 'zhin-console-contract-stub',
    setup(build) {
      build.onResolve({ filter: /^@zhin\.js\/console-contract$/ }, () => ({
        path: 'zhin-console-contract-stub',
        namespace: 'zhin-virtual',
      }));
      build.onLoad({ filter: /.*/, namespace: 'zhin-virtual' }, () => ({
        contents: CONSOLE_CONTRACT_STUB,
        loader: 'js',
      }));
    },
  };
}

function manifestSource(root: string, source: string): string {
  const result = relative(root, resolve(source));
  if (!result || result === '..' || result.startsWith(`..${sep}`)) {
    throw new Error(`Client source is outside project Root: ${source}`);
  }
  return result.split(sep).join('/');
}

function metadataFor(source: string, fileName: string, request: ClientModuleRequest): unknown {
  if (request.feature === pageFeature) return extractPageMetadata(source, fileName);
  if (request.feature === layoutFeature) {
    assertLayoutModule(source, fileName);
    return undefined;
  }
  throw new Error(`Unsupported client Feature: ${request.feature}`);
}

function contentHash(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

function safe(value: string): string {
  const result = trimDashes(value.replace(/[^a-z0-9-]+/giu, '-')).toLowerCase();
  return result || 'root';
}

/** 线性裁剪首尾 `/`（等价于 /^\/+|\/+$/gu，无回溯 — js/polynomial-redos）。 */
function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start += 1;
  while (end > start && value[end - 1] === '/') end -= 1;
  return value.slice(start, end);
}

/** 线性裁剪首尾 `-`（等价于 /^-+|-+$/gu，无回溯 — js/polynomial-redos）。 */
function trimDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start += 1;
  while (end > start && value[end - 1] === '-') end -= 1;
  return value.slice(start, end);
}

function compareEntry(left: ClientBuildEntry, right: ClientBuildEntry): number {
  return left.owner.localeCompare(right.owner)
    || String(left.feature).localeCompare(String(right.feature))
    || left.localName.localeCompare(right.localName)
    || left.source.localeCompare(right.source);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temporary, content);
  await rename(temporary, path);
}
