import { build } from "esbuild";
import * as path from "node:path";
import * as os from "node:os";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { CONSOLE_SHARED_MODULES_KEY } from "@zhin.js/contract";
import {
  CONSOLE_SHARED_MODULE_ISSUE_EVENT,
  CONSOLE_SHARED_MODULE_ISSUES_KEY,
  CONSOLE_SHARED_MODULE_VERSIONS_KEY,
  CONSOLE_UI_MODULE,
  SHARED_MODULE_VERSION_CHECK_SOURCE,
  VERSIONED_SHARED_MODULES,
  compilePeerRange,
  publishedExportNames,
  sharedModuleQuery,
  type SharedModuleRequest,
} from "./shared-modules.js";

export const ALLOWED_ESM_CANONICAL = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-router",
  "react-router-dom",
  CONSOLE_UI_MODULE,
]);

/** Modules the Console provides as singletons; plugin pages get a proxy onto the Console's copy. */
const HOST_PROXIED_MODULES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-router",
  "react-router-dom",
  CONSOLE_UI_MODULE,
]);

const REACT_ROUTER_EXPORTS = [
  "Await",
  "BrowserRouter",
  "Form",
  "HashRouter",
  "Link",
  "MemoryRouter",
  "NavLink",
  "Navigate",
  "Outlet",
  "Route",
  "Router",
  "RouterProvider",
  "Routes",
  "ScrollRestoration",
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
  "createRoutesFromElements",
  "createSearchParams",
  "generatePath",
  "isRouteErrorResponse",
  "matchPath",
  "matchRoutes",
  "redirect",
  "replace",
  "resolvePath",
  "useActionData",
  "useAsyncError",
  "useAsyncValue",
  "useBeforeUnload",
  "useBlocker",
  "useFetcher",
  "useFetchers",
  "useFormAction",
  "useHref",
  "useInRouterContext",
  "useLinkClickHandler",
  "useLoaderData",
  "useLocation",
  "useMatch",
  "useMatches",
  "useNavigate",
  "useNavigation",
  "useNavigationType",
  "useOutlet",
  "useOutletContext",
  "useParams",
  "useResolvedPath",
  "useRevalidator",
  "useRouteError",
  "useRouteLoaderData",
  "useRoutes",
  "useSearchParams",
  "useSubmit",
];

/** discoverCjsExports 失败时的兜底（须与 Host Console 注册的 CJS 导出一致） */
export const KNOWN_NAMED_EXPORTS: Record<string, string[]> = {
  "react/jsx-runtime": ["Fragment", "jsx", "jsxs"],
  "react/jsx-dev-runtime": ["Fragment", "jsx", "jsxs", "jsxDEV"],
  react: [
    "Children",
    "Component",
    "Fragment",
    "Profiler",
    "PureComponent",
    "StrictMode",
    "Suspense",
    "act",
    "cache",
    "cloneElement",
    "createContext",
    "createElement",
    "createFactory",
    "createRef",
    "forwardRef",
    "isValidElement",
    "lazy",
    "memo",
    "startTransition",
    "use",
    "useActionState",
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useOptimistic",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
    "version",
  ],
  "react-dom": [
    "createPortal",
    "flushSync",
    "preconnect",
    "prefetchDNS",
    "preinit",
    "preinitModule",
    "preload",
    "preloadModule",
    "requestFormReset",
    "unstable_batchedUpdates",
    "useFormState",
    "useFormStatus",
    "version",
  ],
  "react-dom/client": ["createRoot", "hydrateRoot"],
  "react-router": REACT_ROUTER_EXPORTS,
  "react-router-dom": REACT_ROUTER_EXPORTS,
};

const esmCache = new Map<string, string>();
const tmpDir = path.join(os.tmpdir(), "zhin-console-esm");

/** `basePath` `/` must not become `//esm/...` (browser resolves to `http://esm/...`). */
export function joinConsolePublicPath(basePath: string, subpath: string): string {
  const base =
    basePath === "/" || basePath === ""
      ? ""
      : basePath.replace(/\/$/, "").replace(/^\/+/, "");
  const rest = subpath.replace(/^\/+/, "");
  return base ? `/${base}/${rest}` : `/${rest}`;
}
const esmVersionTag = Date.now().toString(36);

export function encodeSpecifierSegment(specifier: string): string {
  return encodeURIComponent(specifier).replace(/%2F/g, "~");
}

export function decodeSpecifierSegment(enc: string): string {
  return decodeURIComponent(enc.replace(/~/g, "%2F"));
}

const PEER_CANONICAL_DEPS: Readonly<Record<string, readonly string[]>> = {
  react: [],
  "react/jsx-runtime": ["react"],
  "react/jsx-dev-runtime": ["react"],
  "react-dom": ["react"],
  "react-dom/client": ["react", "react-dom"],
  "react-router": ["react", "react-dom"],
  "react-router-dom": ["react", "react-dom"],
  [CONSOLE_UI_MODULE]: ["react", "react-dom", "react/jsx-runtime"],
};

function discoverCjsExports(canonical: string, resolveDir: string): string[] {
  const candidates = [
    path.join(resolveDir, "_virtual.js"),
    import.meta.url,
  ];
  for (const base of candidates) {
    try {
      const req = createRequire(base);
      const mod = req(canonical);
      if (mod && typeof mod === "object") {
        return Object.keys(mod).filter(
          (k) => k !== "default" && k !== "__esModule" && /^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(k),
        );
      }
    } catch { /* resolve failed */ }
  }
  return [];
}

function resolveNamedExports(canonical: string, resolveDir: string, requested: readonly string[] = []): string[] {
  const discovered = VERSIONED_SHARED_MODULES.has(canonical)
    ? publishedExportNames(canonical, resolveDir)
    : discoverCjsExports(canonical, resolveDir);
  const known = KNOWN_NAMED_EXPORTS[canonical] ?? [];
  return [...new Set([...discovered, ...known, ...requested])];
}

function buildStandaloneRouterShim(): string {
  return `
function _loadLocalFallback() {
  const React = globalThis[${JSON.stringify(CONSOLE_SHARED_MODULES_KEY)}]?.get("react");
  const h = React?.createElement ?? ((t, p, ...c) => ({ type: t, props: { ...p, children: c } }));
  const Fragment = React?.Fragment ?? "div";
  const Passthrough = ({ children }) => h(Fragment, null, children);
  const Link = ({ to, href, children, ...rest }) => h("a", { href: typeof to === "string" ? to : (href ?? "#"), ...rest }, children);
  const useLocation = () => (typeof location !== "undefined"
    ? { pathname: location.pathname, search: location.search, hash: location.hash, state: null, key: "default" }
    : { pathname: "/", search: "", hash: "", state: null, key: "default" });
  const useNavigate = () => (to) => {
    if (typeof location !== "undefined" && typeof to === "string") location.href = to;
  };
  const useParams = () => ({});
  const useSearchParams = () => {
    const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    return [params, () => {}];
  };
  const mod = {
    BrowserRouter: Passthrough,
    HashRouter: Passthrough,
    MemoryRouter: Passthrough,
    Router: Passthrough,
    RouterProvider: Passthrough,
    Routes: Passthrough,
    Route: Passthrough,
    Outlet: () => null,
    Navigate: () => null,
    Link,
    NavLink: Link,
    Form: (props) => h("form", props, props?.children),
    ScrollRestoration: () => null,
    Await: Passthrough,
    createBrowserRouter: (routes) => routes,
    createHashRouter: (routes) => routes,
    createMemoryRouter: (routes) => routes,
    createRoutesFromElements: () => [],
    createSearchParams: (init) => new URLSearchParams(init),
    generatePath: (p) => p,
    isRouteErrorResponse: () => false,
    matchPath: () => null,
    matchRoutes: () => null,
    redirect: (url) => url,
    replace: (url) => url,
    resolvePath: (to) => ({ pathname: String(to), search: "", hash: "" }),
    useActionData: () => undefined,
    useAsyncError: () => undefined,
    useAsyncValue: () => undefined,
    useBeforeUnload: () => {},
    useBlocker: () => ({ state: "unblocked" }),
    useFetcher: () => ({ state: "idle", data: undefined, Form: "form", submit: () => {}, load: () => {} }),
    useFetchers: () => [],
    useFormAction: () => "",
    useHref: (to) => String(to),
    useInRouterContext: () => true,
    useLinkClickHandler: () => () => {},
    useLoaderData: () => undefined,
    useLocation,
    useMatch: () => null,
    useMatches: () => [],
    useNavigate,
    useNavigation: () => ({ state: "idle", location: undefined, formMethod: undefined, formAction: undefined, formEncType: undefined, formData: undefined }),
    useNavigationType: () => "POP",
    useOutlet: () => null,
    useOutletContext: () => undefined,
    useParams,
    useResolvedPath: (to) => ({ pathname: String(to), search: "", hash: "" }),
    useRevalidator: () => ({ revalidate: () => {}, state: "idle" }),
    useRouteError: () => undefined,
    useRouteLoaderData: () => undefined,
    useRoutes: () => null,
    useSearchParams,
    useSubmit: () => () => {},
  };
  return { default: mod, ...mod };
}`;
}

async function tryBuildLocalFallbackFunction(
  canonical: string,
  resolveDir: string,
): Promise<string | undefined> {
  const peers = new Set([...HOST_PROXIED_MODULES].filter((m) => m !== canonical));
  try {
    const result = await build({
      stdin: {
        contents: `import * as _ns from ${JSON.stringify(canonical)};\nimport _def from ${JSON.stringify(canonical)};\nexport default (_def && typeof _def === "object" ? { ..._ns, ..._def, default: _def } : { ..._ns, default: _def ?? _ns });\n`,
        resolveDir,
        loader: "js",
      },
      write: false,
      bundle: true,
      format: "iife",
      globalName: "_zhinLocalMod",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
      nodePaths: [
        path.join(resolveDir, "node_modules"),
        path.join(process.cwd(), "node_modules"),
      ],
      plugins: [
        {
          name: "zhin-shared-peers",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              if (peers.has(args.path)) {
                return { path: args.path, namespace: "zhin-shared-peer" };
              }
              return undefined;
            });
            b.onLoad({ filter: /.*/, namespace: "zhin-shared-peer" }, (args) => ({
              contents: `const m = globalThis[${JSON.stringify(CONSOLE_SHARED_MODULES_KEY)}]?.get(${JSON.stringify(args.path)}); module.exports = m?.default ?? m ?? {};`,
              loader: "js",
            }));
          },
        },
      ],
    });
    const out = result.outputFiles?.[0]?.text;
    if (!out) return undefined;
    return `function _loadLocalFallback() {\n${out}\nreturn _zhinLocalMod?.default ?? _zhinLocalMod;\n}`;
  } catch {
    if (canonical === "react-router" || canonical === "react-router-dom") {
      return buildStandaloneRouterShim();
    }
    return undefined;
  }
}

export interface HostProxyModuleOptions {
  /** What the importing page asks of this module (peer range, consumer, named imports). */
  readonly request?: SharedModuleRequest;
}

const localFallbackCache = new Map<string, Promise<string | undefined>>();

/** The local fallback bundle depends only on the module and resolve dir, not on the page asking. */
function localFallbackFunction(canonical: string, resolveDir: string): Promise<string | undefined> {
  const key = `${resolveDir}::${canonical}`;
  let pending = localFallbackCache.get(key);
  if (!pending) {
    pending = tryBuildLocalFallbackFunction(canonical, resolveDir);
    localFallbackCache.set(key, pending);
  }
  return pending;
}

export function buildHostProxyModule(
  canonical: string,
  namedExports: string[],
  localFallbackFn?: string,
  peerImports: readonly string[] = [],
  options: HostProxyModuleOptions = {},
): string {
  const versioned = VERSIONED_SHARED_MODULES.has(canonical);
  const lines = [
    ...peerImports.map((url) => `import ${JSON.stringify(url)};`),
    ...(localFallbackFn ? [localFallbackFn] : []),
    `const _sharedKey = ${JSON.stringify(CONSOLE_SHARED_MODULES_KEY)};`,
    `const _shared = globalThis[_sharedKey] ?? (globalThis[_sharedKey] = new Map());`,
    `let _m = _shared.get(${JSON.stringify(canonical)});`,
    ...(versioned ? [`const _fromHost = Boolean(_m);`] : []),
    `if (!_m && typeof _loadLocalFallback === "function") {`,
    `  _m = _loadLocalFallback();`,
    `  if (_m) _shared.set(${JSON.stringify(canonical)}, _m);`,
    `}`,
    `if (!_m) throw new Error("[zhin-console] Host module not registered: ${canonical}. Remote Console must set globalThis.${CONSOLE_SHARED_MODULES_KEY} before loading plugin entries.");`,
    `const _def = _m.default ?? _m;`,
    `export default _def;`,
  ];
  if (!versioned) {
    lines.push(...namedExports.map((n) => `export const ${n} = _m.${n} ?? _def?.${n};`));
    return lines.join("\n");
  }
  lines.push(...versionedProxyBody(canonical, namedExports, options.request));
  return lines.join("\n");
}

/**
 * Version handshake and strict named exports for a versioned shared module (ADR 0063 D3).
 * Runs only when the module came from the Console; a local fallback copy is the plugin's own.
 */
function versionedProxyBody(canonical: string, namedExports: readonly string[], request?: SharedModuleRequest): string[] {
  const peer = request?.range ? compilePeerRange(request.range) : undefined;
  const consumer = request?.consumer ?? "a plugin page";
  const label = JSON.stringify(canonical);
  return [
    `const _module = ${label};`,
    `const _consumer = ${JSON.stringify(consumer)};`,
    `const _peer = ${peer ? JSON.stringify(peer) : "null"};`,
    `const _versions = globalThis[${JSON.stringify(CONSOLE_SHARED_MODULE_VERSIONS_KEY)}];`,
    `const _hostVersion = _fromHost ? (_versions instanceof Map ? _versions.get(_module) : _versions?.[_module]) : undefined;`,
    `function _report(issue) {`,
    `  const record = { module: _module, consumer: _consumer, ...(_hostVersion ? { hostVersion: String(_hostVersion) } : {}), ...(_peer ? { range: _peer.range } : {}), ...issue };`,
    `  (issue.kind === "major" ? console.error : console.warn)("[zhin-console] " + record.message);`,
    `  const issues = globalThis[${JSON.stringify(CONSOLE_SHARED_MODULE_ISSUES_KEY)}] ?? (globalThis[${JSON.stringify(CONSOLE_SHARED_MODULE_ISSUES_KEY)}] = []);`,
    `  issues.push(record);`,
    `  try { globalThis.dispatchEvent?.(new CustomEvent(${JSON.stringify(CONSOLE_SHARED_MODULE_ISSUE_EVENT)}, { detail: record })); } catch {}`,
    `  return record;`,
    `}`,
    SHARED_MODULE_VERSION_CHECK_SOURCE,
    `if (_fromHost && _peer) {`,
    `  if (!_hostVersion) {`,
    `    _report({ kind: "unversioned", message: _module + ": the Console did not register a version; " + _consumer + " expects " + _peer.range + "." });`,
    `  } else {`,
    `    const _verdict = _zhinCheckSharedVersion(_hostVersion, _peer);`,
    `    if (_verdict === "major") {`,
    `      const issue = _report({ kind: "major", message: _consumer + " needs " + _module + " " + _peer.range + ", but the Console provides " + _hostVersion + " (incompatible major version). Update the Console or the plugin." });`,
    `      throw new Error("[zhin-console] " + issue.message);`,
    `    }`,
    `    if (_verdict === "minor") _report({ kind: "minor", message: _consumer + " expects " + _module + " " + _peer.range + ", but the Console provides the older " + _hostVersion + "; some components may be missing. Update the Console." });`,
    `    else if (_verdict === "range") _report({ kind: "range", message: _consumer + " expects " + _module + " " + _peer.range + ", but the Console provides " + _hostVersion + "." });`,
    `  }`,
    `}`,
    `const _has = (name) => (_m != null && name in Object(_m)) || (_def != null && name in Object(_def));`,
    `const _pick = (name) => (_m != null && name in Object(_m) ? _m[name] : _def[name]);`,
    `function _absent(name) {`,
    `  const message = _module + (_hostVersion ? "@" + _hostVersion : "") + " does not export \\"" + name + "\\" (needed by " + _consumer + (_peer ? ", built for " + _peer.range : "") + ").";`,
    `  return function zhinMissingSharedExport() { throw new Error("[zhin-console] " + message); };`,
    `}`,
    `const _missing = ${JSON.stringify(namedExports)}.filter((name) => !_has(name));`,
    `if (_missing.length > 0) _report({ kind: "export", missingExports: _missing, message: _module + (_hostVersion ? "@" + _hostVersion : "") + " is missing exports " + _missing.join(", ") + " needed by " + _consumer + "." });`,
    ...namedExports.map((n) => `export const ${n} = _has(${JSON.stringify(n)}) ? _pick(${JSON.stringify(n)}) : _absent(${JSON.stringify(n)});`),
  ];
}

function buildEsbuildEntrySource(canonical: string, namedExports: string[]): string {
  if (namedExports.length === 0) {
    return [
      `export * from ${JSON.stringify(canonical)};`,
      `export { default } from ${JSON.stringify(canonical)};`,
    ].join("\n");
  }
  return [
    `import _cjsMod from ${JSON.stringify(canonical)};`,
    `export default _cjsMod;`,
    ...namedExports.map((n) => `export const ${n} = _cjsMod.${n};`),
  ].join("\n");
}

export async function getOrBuildCanonicalEsmBundle(
  canonical: string,
  resolveDir: string,
  basePath: string,
  request?: SharedModuleRequest,
): Promise<string> {
  const versioned = VERSIONED_SHARED_MODULES.has(canonical);
  const cacheKey = `${basePath}::${canonical}${versioned ? sharedModuleQuery(request) : ""}`;
  const cached = esmCache.get(cacheKey);
  if (cached) return cached;

  const namedExports = resolveNamedExports(canonical, resolveDir, versioned ? request?.imports : undefined);

  if (HOST_PROXIED_MODULES.has(canonical)) {
    const peers = PEER_CANONICAL_DEPS[canonical] ?? [];
    const peerImports = peers.map(
      (peer) => `${joinConsolePublicPath(basePath, `esm/${encodeSpecifierSegment(peer)}.mjs`)}?v=${esmVersionTag}`,
    );
    const localFallbackFn = await localFallbackFunction(canonical, resolveDir);
    const code = buildHostProxyModule(canonical, namedExports, localFallbackFn, peerImports, { request: versioned ? request : undefined });
    esmCache.set(cacheKey, code);
    return code;
  }

  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  const outfile = path.join(tmpDir, `${hash}.mjs`);

  const reactExternals = [...HOST_PROXIED_MODULES];
  const entrySource = buildEsbuildEntrySource(canonical, namedExports);

  await build({
    stdin: {
      contents: entrySource,
      resolveDir,
      loader: "js",
    },
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "warning",
    external: reactExternals,
  });

  let code = readFileSync(outfile, "utf8");
  code = rewriteBareImportsForBrowser(code, basePath, "");
  esmCache.set(canonical, code);
  return code;
}

export interface RewriteBareImportsOptions {
  /** Per shared module: what the page asks of it (sent to `/esm/*` as query parameters). */
  readonly sharedModules?: Readonly<Record<string, SharedModuleRequest>>;
}

export function rewriteBareImportsForBrowser(
  code: string,
  basePath: string,
  _origin: string,
  options: RewriteBareImportsOptions = {},
): string {
  for (const canonical of ALLOWED_ESM_CANONICAL) {
    const enc = encodeSpecifierSegment(canonical);
    const query = VERSIONED_SHARED_MODULES.has(canonical) ? sharedModuleQuery(options.sharedModules?.[canonical]) : "";
    const esmUrl = `${joinConsolePublicPath(basePath, `esm/${enc}.mjs`)}?v=${esmVersionTag}${query}`;
    const pattern = new RegExp(
      `from\\s*["']${canonical.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}["']`,
      "g",
    );
    code = code.replace(pattern, `from "${esmUrl}"`);
  }
  return code;
}
