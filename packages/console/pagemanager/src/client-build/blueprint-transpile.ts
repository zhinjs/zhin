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
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { transform } from 'esbuild';

/**
 * Prepended to every transpiled module. esbuild's CommonJS output assigns
 * `module.exports = __toCommonJS(ns)` (live getters) instead of writing to `exports`; module
 * bodies here run as `fn(exports, require)` both when the builder evaluates them and inside the
 * synthesized browser chunk, so the assignment is folded into the provided `exports` object.
 * It happens before the module's own `require` calls, so circular imports see the live getters.
 */
const COMMONJS_EXPORTS_SHIM =
  'var module = { get exports() { return exports; }, set exports(value) { if (value !== exports) Object.defineProperties(exports, Object.getOwnPropertyDescriptors(value)); } };';

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
  return `${COMMONJS_EXPORTS_SHIM}\n${result.code}`;
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

const REQUIRE_CALL_RE = /\brequire\(\s*("(?:[^"\\\n]|\\.)*")\s*\)/gu;

/**
 * Transpile `entry` and every relative module it (transitively) requires, ahead of the
 * synchronous evaluation. Modules whose text `accept` rejects are kept untranspiled so the
 * evaluator can report them; unresolvable specifiers are left for the evaluator to reject.
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
  const visit = (file: string, rawText?: string): void => {
    if (jobs.has(file)) return;
    jobs.set(file, (async () => {
      const text = rawText ?? readFileSync(file, 'utf8');
      if (!accept(text)) {
        graph.set(file, { text });
        return;
      }
      const code = await transpileBlueprintModule(text, file);
      graph.set(file, { text, code });
      for (const match of code.matchAll(REQUIRE_CALL_RE)) {
        let specifier: unknown;
        try { specifier = JSON.parse(match[1]!); } catch { continue; }
        if (typeof specifier !== 'string') continue;
        const target = resolveBlueprintRelativeImport(file, specifier);
        if (target) visit(target);
      }
    })());
  };
  visit(resolve(entry), entryText);
  let settled = 0;
  while (settled < jobs.size) {
    const batch = [...jobs.values()];
    await Promise.all(batch);
    settled = batch.length;
  }
  return graph;
}
