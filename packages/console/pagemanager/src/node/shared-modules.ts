import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

/**
 * Shared-module version handshake (ADR 0063 D3).
 *
 * The Console registers the modules it shares with plugin pages in
 * `globalThis.__ZHIN_CONSOLE_SHARED_MODULES__` (`Map<id, module>`) and, for versioned ones, their
 * versions in `globalThis.__ZHIN_CONSOLE_SHARED_MODULE_VERSIONS__` (`Map<id, version>`). A plugin
 * page declares the range it was built for in `peerDependencies`; the proxy module that
 * `buildHostProxyModule` generates compares the two when the page loads:
 *
 * - major version incompatible → the import throws (the page does not load, with a clear message);
 * - older within the same major (e.g. a lower minor) → console warning plus an issue record the
 *   Console can show on the page;
 * - named exports the page imports but the host module lacks → reported by name, and each one
 *   throws when used instead of being a silent `undefined`.
 *
 * The constants below must stay equal to the ones exported by `@zhin.js/console-ui`
 * (`client/shared-module.ts`); `tests/client-build/shared-modules.test.ts` checks that.
 */
export const CONSOLE_SHARED_MODULE_VERSIONS_KEY = "__ZHIN_CONSOLE_SHARED_MODULE_VERSIONS__";
export const CONSOLE_SHARED_MODULE_ISSUES_KEY = "__ZHIN_CONSOLE_SHARED_MODULE_ISSUES__";
export const CONSOLE_SHARED_MODULE_ISSUE_EVENT = "zhin:console-shared-module-issue";
export const CONSOLE_UI_MODULE = "@zhin.js/console-ui";

/** Shared modules whose versions the Console registers and whose peer ranges are checked. */
export const VERSIONED_SHARED_MODULES: ReadonlySet<string> = new Set([CONSOLE_UI_MODULE]);

export type VersionTuple = readonly [number, number, number];

export interface RangeComparator {
  readonly op: ">=" | ">" | "<" | "<=" | "=";
  readonly version: VersionTuple;
}

/**
 * A peer range compiled on the server into data the browser-side check can evaluate:
 * `sets` are OR-ed comparator sets (each AND-ed); `majors` are the `[lowest, highest]` major
 * versions each set allows (`null` = unbounded).
 */
export interface CompiledPeerRange {
  readonly range: string;
  readonly sets: readonly (readonly RangeComparator[])[];
  readonly majors: readonly (readonly [number, number | null])[];
}

/** What a plugin page asks of one shared module; travels as query parameters of the `/esm/*` URL. */
export interface SharedModuleRequest {
  /** The plugin's `peerDependencies` range. */
  readonly range?: string;
  /** Package name of the plugin page. */
  readonly consumer?: string;
  /** Named exports the page imports. */
  readonly imports?: readonly string[];
}

export type SharedModuleVersionVerdict = "ok" | "major" | "minor" | "range";

const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+].*)?$/u;

interface Partial3 {
  readonly parts: readonly (number | undefined)[];
}

function parsePartial(text: string): Partial3 | undefined {
  const match = PARTIAL.exec(text.trim());
  if (!match) return undefined;
  const parts: (number | undefined)[] = [];
  for (const raw of match.slice(1, 4)) {
    if (raw === undefined || /^[xX*]$/u.test(raw)) break;
    parts.push(Number(raw));
  }
  return { parts };
}

function full(parts: readonly (number | undefined)[]): VersionTuple {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Exclusive upper bound right after the given partial (`1` → 2.0.0, `1.2` → 1.3.0, `1.2.3` → 1.2.4). */
function nextAfter(parts: readonly (number | undefined)[]): VersionTuple {
  if (parts.length >= 3) return [parts[0]!, parts[1]!, parts[2]! + 1];
  if (parts.length === 2) return [parts[0]!, parts[1]! + 1, 0];
  return [parts[0]! + 1, 0, 0];
}

function comparatorsFor(token: string): RangeComparator[] | undefined {
  const operator = /^(>=|<=|>|<|=|\^|~)?\s*(.*)$/u.exec(token)!;
  const op = operator[1] ?? "";
  const partial = parsePartial(operator[2] ?? "");
  if (!partial) return undefined;
  const { parts } = partial;
  if (parts.length === 0) {
    // `*`, `x`, `>=*` …: anything (`<*` matches nothing; treat it as unsupported).
    return op === "<" || op === ">" ? undefined : [];
  }
  const lower = full(parts);
  switch (op) {
    case "^": {
      const [major, minor, patch] = lower;
      let upper: VersionTuple;
      if (major > 0 || parts.length === 1) upper = [major + 1, 0, 0];
      else if (minor > 0 || parts.length === 2) upper = [0, minor + 1, 0];
      else upper = [0, 0, patch + 1];
      return [{ op: ">=", version: lower }, { op: "<", version: upper }];
    }
    case "~":
      return [{ op: ">=", version: lower }, { op: "<", version: parts.length === 1 ? [lower[0] + 1, 0, 0] : [lower[0], lower[1] + 1, 0] }];
    case ">=":
      return [{ op: ">=", version: lower }];
    case ">":
      return [parts.length === 3 ? { op: ">", version: lower } : { op: ">=", version: nextAfter(parts) }];
    case "<":
      return [{ op: "<", version: lower }];
    case "<=":
      return [parts.length === 3 ? { op: "<=", version: lower } : { op: "<", version: nextAfter(parts) }];
    default:
      return parts.length === 3
        ? [{ op: "=", version: lower }]
        : [{ op: ">=", version: lower }, { op: "<", version: nextAfter(parts) }];
  }
}

function majorsOf(set: readonly RangeComparator[]): readonly [number, number | null] {
  let low = 0;
  let high: number | null = null;
  for (const { op, version } of set) {
    const [major, minor, patch] = version;
    if (op === ">=" || op === ">" || op === "=") low = Math.max(low, major);
    if (op === "=" || op === "<=") high = high === null ? major : Math.min(high, major);
    if (op === "<") {
      const top = minor === 0 && patch === 0 ? major - 1 : major;
      high = high === null ? top : Math.min(high, top);
    }
  }
  return [low, high];
}

/**
 * Compiles an npm semver range (`^0.1.0`, `~1.2`, `>=1.0.0 <2`, `1.x || 2.x`, `1.0.0 - 1.4`, `*`).
 * Returns `undefined` for ranges it cannot read (dist tags, URLs, `workspace:` that was not
 * resolved): those pages are loaded without a version check.
 */
export function compilePeerRange(range: string): CompiledPeerRange | undefined {
  const trimmed = range.trim();
  if (!trimmed) return undefined;
  const sets: RangeComparator[][] = [];
  for (const alternative of trimmed.split("||")) {
    const text = alternative.trim();
    const comparators: RangeComparator[] = [];
    const hyphen = /^(\S+)\s+-\s+(\S+)$/u.exec(text);
    if (hyphen) {
      const from = parsePartial(hyphen[1]!);
      const to = parsePartial(hyphen[2]!);
      if (!from || !to) return undefined;
      comparators.push({ op: ">=", version: full(from.parts) });
      if (to.parts.length === 3) comparators.push({ op: "<=", version: full(to.parts) });
      else if (to.parts.length > 0) comparators.push({ op: "<", version: nextAfter(to.parts) });
    } else if (text !== "") {
      // `>= 1.2.0` → `>=1.2.0`
      for (const token of text.replace(/(>=|<=|>|<|=|\^|~)\s+/gu, "$1").split(/\s+/u)) {
        const compiled = comparatorsFor(token);
        if (!compiled) return undefined;
        comparators.push(...compiled);
      }
    }
    sets.push(comparators);
  }
  return Object.freeze({ range: trimmed, sets, majors: sets.map(majorsOf) });
}

/**
 * Browser-side check, emitted verbatim into the generated proxy modules (plain ES2020, no
 * imports). Returns "ok", "major" (no allowed set shares the host's major), "minor" (same major,
 * older than the set's lower bound) or "range" (same major, outside the range otherwise).
 */
export const SHARED_MODULE_VERSION_CHECK_SOURCE = `function _zhinCheckSharedVersion(hostVersion, peer) {
  const m = /^v?(\\d+)\\.(\\d+)\\.(\\d+)/.exec(String(hostVersion));
  if (!m) return "range";
  const host = [Number(m[1]), Number(m[2]), Number(m[3])];
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  const test = (c) => {
    const d = cmp(host, c.version);
    return c.op === ">=" ? d >= 0 : c.op === ">" ? d > 0 : c.op === "<" ? d < 0 : c.op === "<=" ? d <= 0 : d === 0;
  };
  if (peer.sets.some((set) => set.every(test))) return "ok";
  let sameMajor = false;
  let older = false;
  peer.sets.forEach((set, index) => {
    const span = peer.majors[index];
    if (host[0] < span[0] || (span[1] !== null && host[0] > span[1])) return;
    sameMajor = true;
    if (set.some((c) => (c.op === ">=" || c.op === ">" || c.op === "=") && !test(c))) older = true;
  });
  if (!sameMajor) return "major";
  return older ? "minor" : "range";
}`;

const checkSharedVersion = new Function(`${SHARED_MODULE_VERSION_CHECK_SOURCE}\nreturn _zhinCheckSharedVersion;`)() as (
  hostVersion: string,
  peer: CompiledPeerRange,
) => SharedModuleVersionVerdict;

/** Runs the same check the proxy modules run in the browser (for tests and server-side diagnostics). */
export function classifySharedModuleVersion(hostVersion: string, range: string | CompiledPeerRange): SharedModuleVersionVerdict | undefined {
  const compiled = typeof range === "string" ? compilePeerRange(range) : range;
  return compiled ? checkSharedVersion(hostVersion, compiled) : undefined;
}

const IDENTIFIER = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/u;

/** `?peer=…&consumer=…&imports=A,B` for an `/esm/*` URL (empty when there is nothing to send). */
export function sharedModuleQuery(request: SharedModuleRequest | undefined): string {
  if (!request) return "";
  const params = new URLSearchParams();
  if (request.range) params.set("peer", request.range);
  if (request.consumer) params.set("consumer", request.consumer);
  const imports = [...new Set(request.imports ?? [])].filter((name) => IDENTIFIER.test(name)).sort();
  if (imports.length > 0) params.set("imports", imports.join(","));
  const text = params.toString();
  return text ? `&${text}` : "";
}

/** Reads a {@link SharedModuleRequest} back from the `/esm/*` query string. */
export function sharedModuleRequestFromSearchParams(params: URLSearchParams | undefined): SharedModuleRequest | undefined {
  if (!params) return undefined;
  const range = params.get("peer")?.trim().slice(0, 256) || undefined;
  const consumer = params.get("consumer")?.trim().slice(0, 214) || undefined;
  const imports = (params.get("imports") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => IDENTIFIER.test(name))
    .slice(0, 512);
  if (!range && !consumer && imports.length === 0) return undefined;
  return Object.freeze({
    ...(range ? { range } : {}),
    ...(consumer ? { consumer } : {}),
    ...(imports.length > 0 ? { imports: Object.freeze(imports) } : {}),
  });
}

/**
 * Named exports a bundled page imports from `specifier`
 * (`import { A, B as C } from "x"`, `import D, { E } from "x"`, `export { F } from "x"`).
 */
export function importedNames(code: string, specifier: string): string[] {
  const quoted = specifier.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
  const pattern = new RegExp(`(?:import|export)\\s*(?:[$_a-zA-Z][$_a-zA-Z0-9]*\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*["']${quoted}["']`, "gu");
  const names = new Set<string>();
  for (const match of code.matchAll(pattern)) {
    for (const entry of match[1]!.split(",")) {
      const name = entry.trim().replace(/^type\s+/u, "").split(/\s+as\s+/u)[0]?.trim();
      if (name && IDENTIFIER.test(name) && name !== "default") names.add(name);
    }
  }
  return [...names].sort();
}

function nearestPackageJson(fromDir: string, stopAt?: string): string | undefined {
  let dir = path.resolve(fromDir);
  const stop = stopAt ? path.resolve(stopAt) : undefined;
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir || (stop && dir === stop)) return undefined;
    dir = parent;
  }
}

function installedVersion(moduleId: string, fromDir: string): string | undefined {
  try {
    const manifestPath = createRequire(path.join(fromDir, "_virtual.js")).resolve(`${moduleId}/package.json`);
    const version = (JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown }).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The peer range a page's package declares for `moduleId`. `workspace:^` / `workspace:~` resolve
 * against the installed version (in-repo plugins); `workspace:*` and unreadable ranges give
 * `undefined` (no check).
 */
export function peerRangeForPage(
  pageSource: string,
  moduleId: string,
  projectRoot?: string,
): { readonly range?: string; readonly consumer?: string } {
  const manifestPath = nearestPackageJson(path.dirname(pageSource), projectRoot);
  if (!manifestPath) return {};
  let manifest: { name?: unknown; peerDependencies?: Record<string, unknown> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
  } catch {
    return {};
  }
  const consumer = typeof manifest.name === "string" ? manifest.name : undefined;
  const declared = manifest.peerDependencies?.[moduleId];
  if (typeof declared !== "string") return { ...(consumer ? { consumer } : {}) };
  let range: string | undefined = declared;
  const workspace = /^workspace:(.*)$/u.exec(declared);
  if (workspace) {
    const spec = workspace[1]!.trim();
    const version = installedVersion(moduleId, path.dirname(manifestPath));
    range = spec === "^" || spec === "~" ? (version ? `${spec}${version}` : undefined) : spec === "*" ? undefined : spec;
  }
  if (range !== undefined && !compilePeerRange(range)) range = undefined;
  return { ...(range ? { range } : {}), ...(consumer ? { consumer } : {}) };
}

/** Runtime named exports of `@zhin.js/console-ui` as listed in its published `exports.json`. */
export function publishedExportNames(moduleId: string, resolveDir: string): string[] {
  if (moduleId !== CONSOLE_UI_MODULE) return [];
  try {
    const file = createRequire(path.join(resolveDir, "_virtual.js")).resolve(`${moduleId}/exports.json`);
    const names = (JSON.parse(readFileSync(file, "utf8")) as { exports?: unknown }).exports;
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string" && IDENTIFIER.test(name)) : [];
  } catch {
    return [];
  }
}
