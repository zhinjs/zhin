import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { build as esbuild, stop as stopEsbuild, type BuildOptions, type BuildResult, type Plugin as EsbuildPlugin } from 'esbuild';
import type ts from 'typescript';
import {
  buildBlueprintFromSpec,
  createAdapterConsolePage,
  createCommentReviewPage,
  createDeclarativePage,
  defineAdapterPage,
  defineCommentReviewPage,
  definePage,
  definePageBlueprint,
  isConsoleBlueprint,
  normalizeClientModuleArtifact,
  normalizePageMetadata,
  pageRoute,
  resolveDeclarativeText,
  type ClientModuleArtifact,
  type ConsoleAdapterPageBlueprint,
  type ConsolePageBlueprint,
} from '@zhin.js/console-contract';
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
  'export function resolveDeclarativeText(text, locale = "en") {',
  '  if (!text) return "";',
  '  if (typeof text === "string") return text;',
  '  if (locale === "en") return text.en ?? text["zh-CN"] ?? text.zh ?? "";',
  '  return text["zh-CN"] ?? text.zh ?? text.en ?? "";',
  '}',
  'export function buildBlueprintFromSpec(spec = {}) {',
  '  if (spec && spec.kind === "zhin.console.page-blueprint") {',
  '    return {',
  '      kind: "zhin.console.page-blueprint",',
  '      version: 1,',
  '      title: spec.title,',
  '      ...(spec.titleI18n ? { titleI18n: { ...spec.titleI18n } } : {}),',
  '      ...(spec.description !== undefined ? { description: spec.description } : {}),',
  '      dataSource: { action: spec.dataSource?.action ?? "status" },',
  '      sections: [...(spec.sections ?? [])],',
  '      ...(spec.spec !== undefined ? { spec: spec.spec } : {}),',
  '      ...(spec.reviewSpec !== undefined ? { reviewSpec: spec.reviewSpec } : {}),',
  '    };',
  '  }',
  '  const sections = [];',
  '  if (Array.isArray(spec.stats) && spec.stats.length > 0) {',
  '    sections.push({ type: "stats", id: "runtime-stats", title: "Runtime Stats", items: spec.stats.map((s, i) => ({ key: s.key ?? (typeof s.value === "string" ? s.value : "stat-" + i), label: resolveDeclarativeText(s.label, "en"), ...(typeof s.value === "string" ? { dataKey: s.value } : {}), ...(s.value && typeof s.value === "object" ? { expr: s.value } : {}) })) });',
  '  }',
  '  for (const [idx, sec] of (spec.sections ?? []).entries()) {',
  '    const id = sec.id ?? ("section-" + idx);',
  '    const title = resolveDeclarativeText(sec.title, "en");',
  '    if (sec.columns !== undefined || sec.items !== undefined) {',
  '      sections.push({ type: "table", id, title, ...(typeof sec.items === "string" ? { dataKey: sec.items } : {}), rowKey: sec.columns?.[0]?.key ?? "id", columns: (sec.columns ?? []).map((c) => ({ key: c.key, label: resolveDeclarativeText(c.label, "en") })) });',
  '    } else if (sec.entries !== undefined) {',
  '      sections.push({ type: "entries", id, title, ...(Array.isArray(sec.entries) ? { entries: sec.entries.map((e) => ({ label: resolveDeclarativeText(e.label, "en"), value: String(e.value ?? "") })) } : {}) });',
  '    } else {',
  '      sections.push({ type: "custom", id, ...(title ? { title } : {}) });',
  '    }',
  '  }',
  '  if (Array.isArray(spec.actions) && spec.actions.length > 0) {',
  '    sections.push({ type: "actions", id: "actions", title: "Actions", items: spec.actions.map((a) => ({ label: resolveDeclarativeText(a.label, "en"), action: a.name, name: a.name, ...(a.description !== undefined ? { description: resolveDeclarativeText(a.description, "en") } : {}), ...(a.variant !== undefined ? { variant: a.variant } : {}), ...(a.confirm !== undefined ? { confirm: a.confirm } : {}), ...(a.confirmLabel !== undefined ? { confirmLabel: a.confirmLabel } : {}), ...(a.fields !== undefined ? { fields: a.fields } : {}), ...(a.params !== undefined ? { params: a.params } : {}), ...(a.disabled !== undefined ? { disabled: a.disabled } : {}), ...(a.successMessage !== undefined ? { successMessage: a.successMessage } : {}) })) });',
  '  }',
  '  const titleI18n = typeof spec.title === "object" && spec.title !== null ? { "zh-CN": spec.title["zh-CN"] ?? spec.title.zh, ...(spec.title.en ? { en: spec.title.en } : {}) } : undefined;',
  '  return {',
  '    kind: "zhin.console.page-blueprint",',
  '    version: 1,',
  '    title: resolveDeclarativeText(spec.title, "en"),',
  '    ...(titleI18n ? { titleI18n } : {}),',
  '    ...(spec.description ? { description: resolveDeclarativeText(spec.description, "en") } : {}),',
  '    dataSource: { action: spec.statusMethod ?? "status" },',
  '    sections,',
  '    spec,',
  '    ...(spec.reviewSpec !== undefined ? { reviewSpec: spec.reviewSpec } : {}),',
  '  };',
  '}',
  'export function definePageBlueprint(spec = {}) {',
  '  const bp = buildBlueprintFromSpec(spec);',
  '  const fn = function BlueprintPage(props) {',
  '    if (typeof globalThis !== "undefined" && typeof globalThis.__ZHIN_RENDER_BLUEPRINT__ === "function" && props !== undefined) {',
  '      return globalThis.__ZHIN_RENDER_BLUEPRINT__(bp, props);',
  '    }',
  '    return bp;',
  '  };',
  '  return Object.assign(fn, bp);',
  '}',
  'export function createDeclarativePage(spec = {}) { return definePageBlueprint(spec); }',
  'export function defineAdapterPage(adapterKey) {',
  '  const bp = { kind: "zhin.console.adapter-page", version: 1, adapterKey: String(adapterKey ?? ""), dataSource: { action: "status" } };',
  '  const fn = function AdapterConsoleRoute(props) {',
  '    if (typeof globalThis !== "undefined" && typeof globalThis.__ZHIN_RENDER_ADAPTER_PAGE__ === "function" && props !== undefined) {',
  '      return globalThis.__ZHIN_RENDER_ADAPTER_PAGE__(bp, props);',
  '    }',
  '    return bp;',
  '  };',
  '  return Object.assign(fn, bp);',
  '}',
  'export function createAdapterConsolePage(adapterKey) { return defineAdapterPage(adapterKey); }',
  'export function defineCommentReviewPage(reviewSpec = {}) {',
  '  if (typeof globalThis !== "undefined" && typeof globalThis.__ZHIN_DEFINE_COMMENT_REVIEW_PAGE__ === "function") {',
  '    const delegated = globalThis.__ZHIN_DEFINE_COMMENT_REVIEW_PAGE__(reviewSpec);',
  '    if (delegated && (typeof delegated === "function" || typeof delegated === "object")) {',
  '      return Object.assign(delegated, { reviewSpec });',
  '    }',
  '  }',
  '  const zhTitle = ((reviewSpec.platform && reviewSpec.platform.zh) ? reviewSpec.platform.zh : "评论") + "评论审批";',
  '  const enTitle = ((reviewSpec.platform && reviewSpec.platform.en) ? reviewSpec.platform.en : "Comment") + " comment review";',
  '  const loginActions = reviewSpec.loginMode === "cookie-check"',
  '    ? [{ name: "login-check", label: { zh: "重新检查登录", en: "Check login again" } }]',
  '    : [',
  '        { name: "login", label: { zh: "扫码登录", en: "Sign in with QR code" }, variant: "primary" },',
  '        { name: "login-cancel", label: { zh: "取消扫码", en: "Cancel QR login" }, variant: "ghost" },',
  '        { name: "logout", label: { zh: "退出登录", en: "Sign out" }, variant: "secondary" },',
  '      ];',
  '  const bp = Object.assign(buildBlueprintFromSpec({',
  '    pluginId: reviewSpec.adapter,',
  '    title: { zh: zhTitle, "zh-CN": zhTitle, en: enTitle },',
  '    mark: reviewSpec.mark,',
  '    statusMethod: "status",',
  '    pollMs: reviewSpec.pollMs ?? 10000,',
  '    ...(reviewSpec.dictionary ? { dictionary: reviewSpec.dictionary } : {}),',
  '    stats: [',
  '      { key: "endpoints", label: { zh: "账号数", en: "Accounts" }, value: (data) => (Array.isArray(data?.endpoints) ? data.endpoints.length : 0) },',
  '      { key: "pendingDrafts", label: { zh: "待审草稿", en: "Pending drafts" }, value: (data) => (data?.endpoints ?? []).reduce((sum, ep) => sum + (typeof ep?.pendingCount === "number" ? ep.pendingCount : (ep?.drafts?.length ?? 0)), 0) },',
  '    ],',
  '    sections: [{ id: "endpoints", title: { zh: "评论账号与待审草稿", en: "Accounts & Pending Drafts" }, items: "endpoints", columns: [{ key: "id", label: { zh: "账号", en: "Account" } }, { key: "sendMode", label: { zh: "发送模式", en: "Send Mode" } }, { key: "pendingCount", label: { zh: "待审数", en: "Pending" } }] }],',
  '    actions: [',
  '      ...loginActions,',
  '      { name: "edit", label: { zh: "修改草稿", en: "Edit draft" }, fields: [{ key: "id", label: { zh: "草稿 ID", en: "Draft ID" }, required: true }, { key: "message", label: { zh: "回复内容", en: "Reply content" }, required: true }] },',
  '      { name: "send", label: { zh: "发送草稿", en: "Send draft" }, variant: "primary", fields: [{ key: "id", label: { zh: "草稿 ID", en: "Draft ID" }, required: true }] },',
  '      { name: "drop", label: { zh: "丢弃草稿", en: "Discard draft" }, variant: "danger", confirm: { zh: "确认丢弃该草稿？", en: "Discard this draft?" }, fields: [{ key: "id", label: { zh: "草稿 ID", en: "Draft ID" }, required: true }] },',
  '    ],',
  '  }), { reviewSpec });',
  '  const fn = function CommentReviewBlueprintPage(props) {',
  '    if (typeof globalThis !== "undefined" && typeof globalThis.__ZHIN_RENDER_BLUEPRINT__ === "function" && props !== undefined) {',
  '      return globalThis.__ZHIN_RENDER_BLUEPRINT__(bp, props);',
  '    }',
  '    return bp;',
  '  };',
  '  return Object.assign(fn, bp);',
  '}',
  'export function createCommentReviewPage(reviewSpec = {}) { return defineCommentReviewPage(reviewSpec); }',
].join('\n');

const require = createRequire(import.meta.url);
function tsCompiler(): typeof ts {
  return require('typescript') as typeof ts;
}

const PURE_CONSOLE_CONTRACT_EXPORTS: Readonly<Record<string, unknown>> = Object.freeze({
  definePage: (metadata: Record<string, unknown> = {}) => Object.freeze({ ...metadata }),
  normalizePageMetadata,
  normalizeClientModuleArtifact,
  resolveDeclarativeText,
  buildBlueprintFromSpec,
  definePageBlueprint,
  createDeclarativePage,
  defineAdapterPage,
  createAdapterConsolePage,
  defineCommentReviewPage,
  createCommentReviewPage,
  isConsoleBlueprint,
});

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

    // Prebuilt static client asset (`<name>.bundle.js`) — zero runtime esbuild,
    // zero Node import() of browser code for heavy interactive plugins (e.g. sandbox).
    if (String(request.feature) === pageFeature) {
      const prebuilt = await tryLoadPrebuiltBundle(absSource);
      if (prebuilt !== undefined) {
        const code = rewriteBareImportsForBrowser(prebuilt, this.#consoleBasePath, '');
        await atomicWrite(output, code);
        return Object.freeze({
          module: `${this.#publicBase}/${fileName}`,
          hash,
          metadata,
        }) as T;
      }
    }

    const extracted =
      String(request.feature) === pageFeature && !absSource.endsWith('.tsx')
        ? tryExtractPureBlueprint(text, absSource)
        : undefined;
    const blueprint = extracted?.blueprint;

    // Pure `.ts` Blueprint pages are synthesized directly from in-process `ts.transpileModule`
    // output (zero `esbuild` child process), while `.tsx` or non-blueprint pages use `bundlePageEntry`.
    const bundled = extracted
      ? synthesizePureBlueprintModule(absSource, extracted.modules, request, metadata)
      : await bundlePageEntry(absSource, this.#projectRoot, request, metadata);
    const code = rewriteBareImportsForBrowser(bundled, this.#consoleBasePath, '');
    await atomicWrite(output, code);
    return Object.freeze({
      module: `${this.#publicBase}/${fileName}`,
      hash,
      metadata,
      ...(blueprint ? { blueprint } : {}),
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
  readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  readonly icon?: string;
  readonly group?: string;
  readonly order?: number;
  readonly parent?: string;
  readonly fullWidth?: boolean;
  readonly hideInNav?: boolean;
  readonly requiredPermissions?: readonly string[];
  readonly requiredRoles?: readonly string[];
};

const PURE_BLUEPRINT_CALL_RE =
  /\b(?:definePageBlueprint|createDeclarativePage|defineAdapterPage|createAdapterConsolePage|defineCommentReviewPage|createCommentReviewPage)\s*\(/u;
const FORBIDDEN_BROWSER_IMPORT_RE =
  /from\s+['"](?:react|react-dom|@zhin\.js\/client)(?:\/[^'"]*)?['"]/u;

interface TranspiledBlueprintModule {
  readonly code: string;
  readonly imports: Readonly<Record<string, string>>;
}

interface ExtractedPureBlueprint {
  readonly blueprint: ConsolePageBlueprint | ConsoleAdapterPageBlueprint;
  readonly modules: ReadonlyMap<string, TranspiledBlueprintModule>;
}

function tryExtractPureBlueprint(
  sourceText: string,
  absSource: string,
): ExtractedPureBlueprint | undefined {
  if (!PURE_BLUEPRINT_CALL_RE.test(sourceText) || FORBIDDEN_BROWSER_IMPORT_RE.test(sourceText)) {
    return undefined;
  }
  try {
    const ts = tsCompiler();
    const evaluatedCache = new Map<string, Record<string, unknown>>();
    const modules = new Map<string, TranspiledBlueprintModule>();
    const evalModule = (filePath: string, rawText?: string): Record<string, unknown> => {
      const resolved = resolve(filePath);
      const cached = evaluatedCache.get(resolved);
      if (cached) return cached;
      const text = rawText ?? readFileSync(resolved, 'utf8');
      if (FORBIDDEN_BROWSER_IMPORT_RE.test(text)) {
        throw new Error(`Browser dependency in ${resolved}`);
      }
      const transpiled = ts.transpileModule(text, {
        fileName: resolved,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      });
      const exportsObj: Record<string, unknown> = {};
      const importMap: Record<string, string> = {};
      evaluatedCache.set(resolved, exportsObj);
      const localRequire = (specifier: string): unknown => {
        if (
          specifier === '@zhin.js/console-contract' ||
          specifier === '@zhin.js/contract' ||
          specifier === '@zhin.js/page' ||
          specifier === 'zhin.js/page'
        ) {
          importMap[specifier] = '@zhin.js/console-contract';
          return PURE_CONSOLE_CONTRACT_EXPORTS;
        }
        if (specifier.startsWith('.')) {
          const baseDir = dirname(resolved);
          const candidates = [
            resolve(baseDir, specifier),
            resolve(baseDir, specifier.replace(/\.js$/u, '.ts')),
            resolve(baseDir, `${specifier}.ts`),
            resolve(baseDir, `${specifier}.js`),
          ];
          for (const candidate of candidates) {
            if (existsSync(candidate)) {
              const target = resolve(candidate);
              importMap[specifier] = target;
              return evalModule(target);
            }
          }
        }
        throw new Error(`Unsupported import in pure blueprint page: ${specifier}`);
      };
      const fn = new Function('exports', 'require', transpiled.outputText);
      fn(exportsObj, localRequire);
      modules.set(resolved, {
        code: transpiled.outputText,
        imports: Object.freeze({ ...importMap }),
      });
      return exportsObj;
    };

    const modExports = evalModule(absSource, sourceText);
    const defaultExport = modExports.default;
    const rawBp =
      typeof defaultExport === 'function'
        ? (defaultExport as () => unknown)()
        : defaultExport;
    if (!isConsoleBlueprint(rawBp)) {
      return undefined;
    }
    const { spec: _spec, reviewSpec: _reviewSpec, ...serializableBp } =
      rawBp as unknown as Record<string, unknown>;
    return {
      blueprint: Object.freeze({
        ...serializableBp,
      }) as unknown as ConsolePageBlueprint | ConsoleAdapterPageBlueprint,
      modules,
    };
  } catch {
    return undefined;
  }
}

function synthesizePureBlueprintModule(
  absSource: string,
  modules: ReadonlyMap<string, TranspiledBlueprintModule>,
  request: ClientModuleRequest,
  metadata: unknown,
): string {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as PageMeta;
  const route = safePageRoute(request.owner, request.localName);
  const title = meta.title ?? request.localName;
  const icon = meta.icon;
  const hideInNav = meta.hideInNav === true;
  const cjsContractStub = CONSOLE_CONTRACT_STUB.replace(
    /^export function (\w+)/gmu,
    'function $1',
  ) + '\nObject.assign(exports, { definePage, defineLayout, normalizePageMetadata, normalizeClientModuleArtifact, resolveDeclarativeText, buildBlueprintFromSpec, definePageBlueprint, createDeclarativePage, defineAdapterPage, createAdapterConsolePage, defineCommentReviewPage, createCommentReviewPage });';

  const moduleEntries = [...modules.entries()].map(([id, mod]) => {
    return `${JSON.stringify(id)}: { imports: ${JSON.stringify(mod.imports)}, fn(exports, require) {\n${mod.code}\n} }`;
  });

  const registerBody = buildRegisterFunctionBody({
    owner: request.owner,
    route,
    title,
    titleI18n: meta.titleI18n,
    icon,
    group: meta.group,
    order: meta.order,
    parent: meta.parent,
    fullWidth: meta.fullWidth,
    hideInNav,
    localName: request.localName,
    requiredPermissions: meta.requiredPermissions,
    requiredRoles: meta.requiredRoles,
  });

  return [
    '// Pure Server-Driven Blueprint (zero-esbuild synthesized module)',
    'const __zhin_contract__ = (() => {',
    '  const exports = {};',
    cjsContractStub,
    '  return exports;',
    '})();',
    `const __zhin_modules__ = {\n${moduleEntries.join(',\n')}\n};`,
    'const __zhin_cache__ = {};',
    'function __zhin_require__(id) {',
    '  if (id === "@zhin.js/console-contract" || id === "@zhin.js/contract" || id === "@zhin.js/page" || id === "zhin.js/page") {',
    '    return __zhin_contract__;',
    '  }',
    '  if (__zhin_cache__[id]) return __zhin_cache__[id];',
    '  const mod = __zhin_modules__[id];',
    '  if (!mod) throw new Error("Unknown blueprint module: " + id);',
    '  const exports = {};',
    '  __zhin_cache__[id] = exports;',
    '  mod.fn(exports, (spec) => __zhin_require__(mod.imports[spec] ?? spec));',
    '  return exports;',
    '}',
    `const pageNs = __zhin_require__(${JSON.stringify(resolve(absSource))});`,
    'const Page = pageNs.default;',
    'export default Page;',
    'export const meta = pageNs.meta;',
    registerBody,
  ].join('\n');
}

async function tryLoadPrebuiltBundle(absSource: string): Promise<string | undefined> {
  const dir = dirname(absSource);
  const stem = basename(absSource, extname(absSource));
  const candidates = [
    join(dir, `${stem}.bundle.js`),
    join(dir, 'index.bundle.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFile(candidate, 'utf8');
    }
  }
  return undefined;
}

let activeEsbuildCalls = 0;
let stopEsbuildTimer: ReturnType<typeof setTimeout> | undefined;

async function runEsbuild(options: BuildOptions & { write: false }): Promise<BuildResult<{ write: false }>> {
  activeEsbuildCalls += 1;
  if (stopEsbuildTimer) {
    clearTimeout(stopEsbuildTimer);
    stopEsbuildTimer = undefined;
  }
  try {
    return await esbuild(options);
  } finally {
    activeEsbuildCalls -= 1;
    if (activeEsbuildCalls === 0) {
      stopEsbuildTimer = setTimeout(() => {
        stopEsbuildTimer = undefined;
        if (activeEsbuildCalls === 0) {
          void Promise.resolve(stopEsbuild()).catch(() => undefined);
        }
      }, 100);
      stopEsbuildTimer.unref?.();
    }
  }
}

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
    owner: request.owner,
    route,
    title,
    titleI18n: meta.titleI18n,
    icon,
    group: meta.group,
    order: meta.order,
    parent: meta.parent,
    fullWidth: meta.fullWidth,
    hideInNav,
    localName: request.localName,
    requiredPermissions: meta.requiredPermissions,
    requiredRoles: meta.requiredRoles,
  });
  const result = await runEsbuild({
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
  const result = await runEsbuild({
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
export function buildPageRegisterWrapper(
  absSource: string,
  options: {
    readonly owner?: string;
    readonly route: string;
    readonly title: string;
    readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
    readonly icon?: string;
    readonly group?: string;
    readonly order?: number;
    readonly parent?: string;
    readonly fullWidth?: boolean;
    readonly hideInNav: boolean;
    readonly localName: string;
    readonly requiredPermissions?: readonly string[];
    readonly requiredRoles?: readonly string[];
  },
): string {
  // abs path import so esbuild resolves the real page regardless of stdin dir.
  const pageImport = JSON.stringify(absSource);
  return `
import Page, * as pageNs from ${pageImport};
export { default } from ${pageImport};
export const meta = pageNs.meta;
${buildRegisterFunctionBody(options)}
`;
}

function buildRegisterFunctionBody(options: {
  readonly owner?: string;
  readonly route: string;
  readonly title: string;
  readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  readonly icon?: string;
  readonly group?: string;
  readonly order?: number;
  readonly parent?: string;
  readonly fullWidth?: boolean;
  readonly hideInNav: boolean;
  readonly localName: string;
  readonly requiredPermissions?: readonly string[];
  readonly requiredRoles?: readonly string[];
}): string {
  const owner = JSON.stringify(options.owner ?? rootPluginId());
  const route = JSON.stringify(options.route);
  const title = JSON.stringify(options.title);
  const titleI18n = options.titleI18n === undefined ? 'undefined' : JSON.stringify(options.titleI18n);
  const icon = options.icon === undefined ? 'undefined' : JSON.stringify(options.icon);
  const group = options.group === undefined ? 'undefined' : JSON.stringify(options.group);
  const order = options.order === undefined ? 'undefined' : JSON.stringify(options.order);
  const parent = options.parent === undefined ? 'undefined' : JSON.stringify(options.parent);
  const fullWidth = options.fullWidth === undefined ? 'undefined' : JSON.stringify(options.fullWidth);
  const hideInNav = options.hideInNav ? 'true' : 'false';
  const toolId = JSON.stringify(options.localName);
  const requiredPermissions = options.requiredPermissions === undefined ? 'undefined' : JSON.stringify(options.requiredPermissions);
  const requiredRoles = options.requiredRoles === undefined ? 'undefined' : JSON.stringify(options.requiredRoles);
  return `
const _owner = ${owner};
const _route = ${route};
const _localName = ${toolId};
if (typeof globalThis !== 'undefined') {
  globalThis.__ZHIN_ACTIVE_PLUGIN_ID__ = _owner;
  const _owners = globalThis.__ZHIN_PAGE_OWNERS__ ?? (globalThis.__ZHIN_PAGE_OWNERS__ = {});
  _owners[_route] = _owner;
}

export function register(api) {
  const Component = Page?.default ?? Page;
  if (typeof Component !== 'function' && (typeof Component !== 'object' || Component == null)) {
    throw new Error('Page module default export is not a React component');
  }
  function _renderBlueprint(bp, props) {
    if (typeof globalThis !== 'undefined') {
      if (bp?.kind === 'zhin.console.adapter-page' && typeof globalThis.__ZHIN_RENDER_ADAPTER_PAGE__ === 'function') {
        return globalThis.__ZHIN_RENDER_ADAPTER_PAGE__(bp, props);
      }
      if (bp?.kind === 'zhin.console.page-blueprint' && typeof globalThis.__ZHIN_RENDER_BLUEPRINT__ === 'function') {
        return globalThis.__ZHIN_RENDER_BLUEPRINT__(bp, props);
      }
    }
    const h = api.React.createElement;
    if (bp?.kind === 'zhin.console.adapter-page') {
      const adapterKey = String(bp.adapterKey ?? '');
      return h('div', { className: 'p-6 max-w-4xl mx-auto flex flex-col gap-6', 'data-adapter-key': adapterKey },
        h('div', { className: 'flex flex-col gap-1' },
          h('h1', { className: 'text-2xl font-bold' }, String(bp.title ?? (adapterKey || 'Adapter'))),
          (bp.subtitle ?? bp.description) ? h('p', { className: 'text-sm text-muted-foreground' }, String(bp.subtitle ?? bp.description)) : null,
        ),
        h('section', { className: 'p-4 rounded-lg border bg-card flex flex-col gap-2' },
          h('h2', { className: 'text-base font-semibold mb-2' }, 'Adapter Overview'),
          h('p', { className: 'text-sm text-muted-foreground' }, 'Adapter: ' + adapterKey),
        ),
      );
    }
    const sections = Array.isArray(bp.sections) ? bp.sections : [];
    return h('div', { className: 'p-6 max-w-4xl mx-auto flex flex-col gap-6' },
      h('div', { className: 'flex flex-col gap-1' },
        h('h1', { className: 'text-2xl font-bold' }, String(bp.title ?? '')),
        (bp.subtitle ?? bp.description) ? h('p', { className: 'text-sm text-muted-foreground' }, String(bp.subtitle ?? bp.description)) : null,
      ),
      ...sections.map((sec, idx) => {
        const key = sec?.id ?? String(idx);
        const secTitle = sec?.title ? h('h2', { className: 'text-base font-semibold mb-2' }, String(sec.title)) : null;
        const items = Array.isArray(sec?.items) ? sec.items : [];
        const actions = Array.isArray(sec?.actions) ? sec.actions : items;
        if (sec?.kind === 'stats' || sec?.type === 'stats') {
          return h('section', { key, className: 'p-4 rounded-lg border bg-card flex flex-col gap-2' },
            secTitle,
            h('div', { className: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' } },
              ...items.map((item, i) => h('div', { key: item?.key ?? String(i), className: 'p-3 rounded border bg-muted flex flex-col gap-1' },
                h('span', { className: 'text-xs text-muted-foreground' }, String(item?.label ?? item?.key ?? '')),
                h('strong', { className: 'text-lg font-semibold' }, String(item?.value ?? '—') + String(item?.suffix ?? '')),
              )),
            ),
          );
        }
        if (sec?.kind === 'table' || sec?.type === 'table') {
          const cols = Array.isArray(sec?.columns) ? sec.columns : [];
          const rows = Array.isArray(sec?.rows) ? sec.rows : items;
          return h('section', { key, className: 'p-4 rounded-lg border bg-card flex flex-col gap-2' },
            secTitle,
            rows.length === 0
              ? h('p', { className: 'text-sm text-muted-foreground' }, String(sec?.emptyText ?? 'No data'))
              : h('table', { className: 'w-full text-sm text-left' },
                  cols.length > 0 ? h('thead', null,
                    h('tr', null, ...cols.map((col, ci) => h('th', { key: col?.key ?? String(ci), className: 'py-2 px-3 border-b font-medium' }, String(col?.label ?? col?.key ?? '')))),
                  ) : null,
                  h('tbody', null,
                    ...rows.map((row, ri) => h('tr', { key: String(row?.[sec?.rowKey ?? 'id'] ?? ri) },
                      ...(cols.length > 0
                        ? cols.map((col, ci) => h('td', { key: col?.key ?? String(ci), className: 'py-2 px-3 border-b' }, String(row?.[col?.key] ?? '—')))
                        : Object.entries(row ?? {}).map(([rk, rv]) => h('td', { key: rk, className: 'py-2 px-3 border-b' }, String(rv ?? '—')))),
                    )),
                  ),
                ),
          );
        }
        if (sec?.kind === 'entries' || sec?.type === 'entries') {
          const entryItems = Array.isArray(sec?.entries) ? sec.entries : items;
          return h('section', { key, className: 'p-4 rounded-lg border bg-card flex flex-col gap-2' },
            secTitle,
            h('dl', { className: 'grid grid-cols-2 gap-2 text-sm' },
              ...entryItems.map((entry, ei) => h('div', { key: entry?.key ?? entry?.label ?? String(ei), className: 'contents' },
                h('dt', { className: 'text-muted-foreground' }, String(entry?.label ?? entry?.key ?? '')),
                h('dd', { className: 'font-medium m-0' }, String(entry?.value ?? '—')),
              )),
            ),
          );
        }
        if (sec?.kind === 'actions' || sec?.type === 'actions') {
          return h('section', { key, className: 'p-4 rounded-lg border bg-card flex flex-col gap-2' },
            secTitle,
            h('div', { className: 'flex flex-wrap gap-2' },
              ...actions.map((act, i) => h('button', {
                key: act?.action ?? act?.name ?? String(i),
                type: 'button',
                className: 'px-3 py-1 rounded border bg-secondary text-sm font-medium cursor-pointer',
                'data-action': String(act?.action ?? act?.name ?? ''),
              }, String(act?.label ?? act?.action ?? 'Action'))),
            ),
          );
        }
        if (sec?.kind === 'markdown' || sec?.type === 'markdown') {
          return h('section', { key, className: 'p-4 rounded-lg border bg-card flex flex-col gap-2' },
            secTitle,
            h('pre', { className: 'whitespace-pre-wrap text-sm font-mono m-0' }, String(sec?.content ?? '')),
          );
        }
        return h('section', { key, className: 'p-4 rounded-lg border bg-card flex flex-col gap-2' }, secTitle);
      }),
    );
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__ZHIN_ACTIVE_PLUGIN_ID__ = _owner;
    const _owners = globalThis.__ZHIN_PAGE_OWNERS__ ?? (globalThis.__ZHIN_PAGE_OWNERS__ = {});
    _owners[_route] = _owner;
  }
  const m = pageNs.meta && typeof pageNs.meta === 'object' ? pageNs.meta : {};
  const route = _route;
  const name = typeof m.title === 'string' && m.title ? m.title : ${title};
  const icon = m.icon ?? ${icon};
  const group = m.group ?? ${group};
  const order = typeof m.order === 'number' ? m.order : ${order};
  const parent = m.parent ?? ${parent};
  const fullWidth = typeof m.fullWidth === 'boolean' ? m.fullWidth : ${fullWidth};
  const titleI18n = m.titleI18n ?? ${titleI18n};
  const requiredPermissions = Array.isArray(m.requiredPermissions) ? m.requiredPermissions : ${requiredPermissions};
  const requiredRoles = Array.isArray(m.requiredRoles) ? m.requiredRoles : ${requiredRoles};
  const pageProps = {
    pluginId: _owner,
    owner: _owner,
    localName: _localName,
    route,
    title: name,
  };
  const isBlueprint = (v) => Boolean(v && typeof v === 'object' && (v.kind === 'zhin.console.page-blueprint' || v.kind === 'zhin.console.adapter-page'));
  const WrappedComponent = typeof Component === 'function'
    ? function ZhinPageAdapter(props) {
        if (typeof globalThis !== 'undefined') globalThis.__ZHIN_ALLOW_RAW_BLUEPRINT__ = true;
        try {
          const out = Component(props);
          if (isBlueprint(out)) {
            return _renderBlueprint(out, props);
          }
          return out;
        } finally {
          if (typeof globalThis !== 'undefined') delete globalThis.__ZHIN_ALLOW_RAW_BLUEPRINT__;
        }
      }
    : (isBlueprint(Component)
        ? function ZhinBlueprintPage(props) { return _renderBlueprint(Component, props); }
        : Component);
  const element = api.React.createElement(WrappedComponent, pageProps);
  api.addRoute({
    path: route,
    name,
    element,
    ...(parent !== undefined ? { parent } : {}),
    ...(icon != null ? { icon } : {}),
    ...(requiredPermissions !== undefined ? { requiredPermissions } : {}),
    ...(requiredRoles !== undefined ? { requiredRoles } : {}),
    meta: {
      hideInMenu: m.hideInNav === true || ${hideInNav},
      ...(titleI18n === undefined ? {} : { titleI18n }),
      ...(group !== undefined ? { group } : {}),
      ...(order !== undefined ? { order } : {}),
      ...(fullWidth !== undefined ? { fullWidth } : {}),
    },
  });
  if (typeof api.addTool === 'function') {
    api.addTool({
      id: _localName,
      name,
      path: route,
      ...(parent !== undefined ? { parent } : {}),
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
      build.onResolve({ filter: /^(?:@zhin\.js\/console-contract|@zhin\.js\/page|zhin\.js\/page)$/ }, () => ({
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
