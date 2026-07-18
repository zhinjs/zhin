import { access } from 'node:fs/promises';
import { register } from 'node:module';
import { sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * ESM resolve hook: when a relative/absolute `.js` specifier fails and a
 * sibling `.ts` / `.tsx` exists, rewrite to that source file.
 *
 * Needed for Plugin Runtime on Node 22.6–22.17 with `--experimental-strip-types`:
 * TypeScript authoring uses `.js` import suffixes, but strip-types does not
 * remap missing `.js` → `.ts` the way `tsc`/tsx do.
 */
export async function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (
    specifier: string,
    context: { parentURL?: string },
  ) => Promise<{ url: string; shortCircuit?: boolean; format?: string }>,
): Promise<{ url: string; shortCircuit?: boolean; format?: string }> {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!shouldTryTypeScript(specifier, error)) throw error;
    const candidate = await firstExistingTypeScript(specifier, context.parentURL);
    if (!candidate) throw error;
    return nextResolve(candidate, context);
  }
}

let registered = false;

/** Register once for the current process (safe to call from CLI / RootHost). */
export function ensureTypeScriptSpecifierRemap(): void {
  if (registered) return;
  registered = true;
  register(import.meta.url);
}

function shouldTryTypeScript(specifier: string, error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') {
    return false;
  }
  if (specifier.startsWith('node:') || specifier.startsWith('data:')) return false;
  return /\.[cm]?js$/u.test(specifier) || specifier.endsWith('.jsx');
}

async function firstExistingTypeScript(
  specifier: string,
  parentURL: string | undefined,
): Promise<string | undefined> {
  const resolvedJs = resolveAgainstParent(specifier, parentURL);
  if (!resolvedJs) return undefined;

  // Prefer compiled lib/ over strip-types (.ts): many packages use syntax that
  // Node strip-only mode rejects (parameter properties, enums, etc.).
  const libCandidate = compiledLibPath(resolvedJs);
  if (libCandidate && await exists(libCandidate)) {
    return pathToFileURL(libCandidate).href;
  }

  const bases = [
    resolvedJs.replace(/\.jsx$/u, ''),
    resolvedJs.replace(/\.[cm]?js$/u, ''),
  ];
  for (const base of bases) {
    for (const ext of ['.ts', '.tsx', '.mts', '.cts'] as const) {
      const candidate = `${base}${ext}`;
      if (await exists(candidate)) return pathToFileURL(candidate).href;
    }
  }
  return undefined;
}

function compiledLibPath(sourceJsPath: string): string | undefined {
  const marker = `${sep}src${sep}`;
  const index = sourceJsPath.lastIndexOf(marker);
  if (index < 0) return undefined;
  return `${sourceJsPath.slice(0, index)}${sep}lib${sep}${sourceJsPath.slice(index + marker.length)}`;
}

function resolveAgainstParent(specifier: string, parentURL: string | undefined): string | undefined {
  try {
    if (specifier.startsWith('file:')) return fileURLToPath(specifier);
    if (!parentURL) return undefined;
    return fileURLToPath(new URL(specifier, parentURL));
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
