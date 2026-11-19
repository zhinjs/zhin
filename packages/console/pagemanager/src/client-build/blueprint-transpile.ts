/**
 * TS → CommonJS transpilation for pure Server-Driven Blueprint pages (#1250).
 *
 * Uses the `esbuild` the page builder already depends on (`transform`, the same short-lived
 * service `bundlePageEntry` uses) instead of keeping the whole TypeScript compiler resident in
 * the instance just for `ts.transpileModule`. Options mirror the previous
 * `transpileModule({ module: CommonJS, target: ES2022 })` call: CommonJS output, ES2022 syntax,
 * type-only imports elided, ES2022 class-field semantics.
 *
 * Internal to `@zhin.js/pagemanager` (not re-exported from the package index).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { transform } from 'esbuild';

/**
 * Prepended to every transpiled module. esbuild's CommonJS output assigns
 * `module.exports = __toCommonJS(ns)` (live getters) instead of writing to `exports`; module
 * bodies here run as `fn(exports, require)` both when the builder evaluates them and inside the
 * synthesized browser chunk, so the assignment is folded into the provided `exports` object.
 * It happens before the module's own `require` calls, so circular imports see the live getters.
 *
 * - `"use strict"` comes first: esbuild's CommonJS output carries no directive (ESM is strict
 *   implicitly), and without it the server-side `new Function` evaluation would run the module
 *   sloppy (an undeclared assignment would leak onto `globalThis`). `ts.transpileModule` emitted
 *   it too.
 * - `export = <primitive or function>` replaces `module.exports` with something whose exports
 *   cannot be folded into `exports`; that throws (instead of silently exporting nothing), so the
 *   builder falls back to the bundle path with a clear reason.
 */
function commonJsExportsShim(fileName: string): string {
  const where = JSON.stringify(fileName);
  return '"use strict";\n'
    + 'var module = { get exports() { return exports; }, set exports(value) {'
    + ' if (value === exports) return;'
    + ' if (value === null || typeof value !== "object") throw new TypeError('
    + `"Blueprint module " + ${where} + " replaces module.exports with a " + (value === null ? "null" : typeof value) + " value (export =); only ES exports are supported");`
    + ' Object.defineProperties(exports, Object.getOwnPropertyDescriptors(value)); } };';
}

/** Transpile one Blueprint module to CommonJS that runs as `fn(exports, require)`. */
export async function transpileBlueprintModule(text: string, fileName: string): Promise<string> {
  const result = await transform(text, {
    loader: /\.[cm]?js$/u.test(fileName) ? 'js' : 'ts',
    format: 'cjs',
    target: 'es2022',
    sourcefile: fileName,
    // transpileModule({ target: ES2022 }) defaults useDefineForClassFields to true.
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } },
    logLevel: 'silent',
  });
  return `${commonJsExportsShim(fileName)}\n${result.code}`;
}

/**
 * Resolve a relative import of a Blueprint module to a `.ts` / `.js` file (never `.tsx` /
 * `.jsx`, which need the browser bundle path). Same candidate order as before.
 */
export function resolveBlueprintRelativeImport(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const baseDir = dirname(fromFile);
  const candidates = [
    resolve(baseDir, specifier),
    resolve(baseDir, specifier.replace(/\.js$/u, '.ts')),
    resolve(baseDir, `${specifier}.ts`),
    resolve(baseDir, `${specifier}.js`),
    resolve(baseDir, specifier, 'index.ts'),
    resolve(baseDir, specifier, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (candidate.endsWith('.tsx') || candidate.endsWith('.jsx')) continue;
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile() === true) return resolve(candidate);
  }
  return undefined;
}

export interface BlueprintModuleSource {
  readonly text: string;
  /** Transpiled CommonJS; absent when `text` fails the caller's `accept` check. */
  readonly code?: string;
}

/**
 * The `require` calls esbuild's CommonJS output generates for static imports, one statement per
 * line at the start of the line:
 *
 * - `var import_x = require("./x.js");` (named / side-effect imports)
 * - `var import_x = __toESM(require("./x.js"));` (default / namespace imports)
 * - `const x = require("./x");` (`import x = require('./x')`)
 * - `__reExport(ns, require("./x"), module.exports);` (`export * from './x'`)
 * - `require("./x");` (bare side-effect import, when esbuild keeps no binding)
 *
 * esbuild's `transform` reports no import list and its metafile lists no imports without
 * bundling, so the generated statements are matched instead of scanning every `require(` in the
 * output: a `require("…")` inside a string or template literal, or mid-expression, is not an
 * import. A multi-line template literal holding a line in exactly one of these shapes could still
 * be mistaken for one; that only prefetches an extra file of the same plugin (see
 * {@link transpileBlueprintGraph}), never changes what the evaluator runs.
 */
const REQUIRE_STATEMENT_RE =
  /^(?:(?:var|let|const) [\w$]+ = (?:require\(("(?:[^"\\\n]|\\.)*")\)|__toESM\(require\(("(?:[^"\\\n]|\\.)*")\)(?:, 1)?\));|__reExport\([\w$]+, require\(("(?:[^"\\\n]|\\.)*")\)(?:, module\.exports)?\);|require\(("(?:[^"\\\n]|\\.)*")\);)$/gmu;

/** Nearest ancestor directory of `file` holding a `package.json` (the plugin root). */
function packageRootOf(file: string): string {
  let dir = dirname(file);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dirname(file);
    dir = parent;
  }
}

function isInside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Transpile `entry` and every relative module it (transitively) requires, ahead of the
 * synchronous evaluation. Modules whose text `accept` rejects are kept untranspiled so the
 * evaluator can report them; unresolvable specifiers are left for the evaluator to reject.
 *
 * Only modules inside the entry's plugin root (nearest `package.json` directory) are
 * prefetched. A relative import leaving it is not transpiled, so the evaluator rejects it
 * ("not transpiled") and the builder falls back to the bundle path, which resolves it properly.
 *
 * Every transpile started here has finished when this resolves or rejects (the caller runs it
 * inside its esbuild service window); on failure the first error is thrown after all of them
 * settled, and no further modules are discovered once one failed.
 */
export async function transpileBlueprintGraph(
  entry: string,
  entryText: string,
  accept: (text: string) => boolean,
): Promise<ReadonlyMap<string, BlueprintModuleSource>> {
  const graph = new Map<string, BlueprintModuleSource>();
  // Each module is transpiled once; a module never awaits its imports (imports may be circular),
  // the loop below waits until no new module was discovered.
  const jobs = new Map<string, Promise<void>>();
  const root = packageRootOf(resolve(entry));
  let failure: { readonly error: unknown } | undefined;
  const visit = (file: string, rawText?: string): void => {
    if (failure || jobs.has(file)) return;
    jobs.set(file, (async () => {
      const text = rawText ?? readFileSync(file, 'utf8');
      if (!accept(text)) {
        graph.set(file, { text });
        return;
      }
      const code = await transpileBlueprintModule(text, file);
      graph.set(file, { text, code });
      for (const match of code.matchAll(REQUIRE_STATEMENT_RE)) {
        let specifier: unknown;
        try { specifier = JSON.parse(match.slice(1).find((group) => group !== undefined)!); } catch { continue; }
        if (typeof specifier !== 'string') continue;
        const target = resolveBlueprintRelativeImport(file, specifier);
        if (target && isInside(root, target)) visit(target);
      }
    })().catch((error: unknown) => {
      failure ??= { error };
    }));
  };
  visit(resolve(entry), entryText);
  let settled = 0;
  while (settled < jobs.size) {
    const batch = [...jobs.values()];
    // Jobs never reject (failures are recorded above), so every job is awaited.
    await Promise.all(batch);
    settled = batch.length;
  }
  if (failure) throw failure.error;
  return graph;
}
