import { execFileSync } from 'node:child_process';

/** One published release, as `npm view <name>@<spec> version dependencies` reports it. */
export interface RegistryRelease {
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/** Looks up a release of a package (`spec` defaults to the `latest` dist-tag); `undefined` when unavailable. */
export type RegistryLookup = (name: string, spec?: string) => RegistryRelease | undefined;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/** Parses the JSON `npm view … version dependencies --json` prints (an object, or an array for a range). */
export function parseNpmViewRelease(output: string): RegistryRelease | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { return undefined; }
  // A range that matches several versions prints one entry per version, oldest first.
  if (Array.isArray(parsed)) parsed = parsed[parsed.length - 1];
  if (typeof parsed === 'string') return SEMVER.test(parsed) ? { version: parsed, dependencies: {} } : undefined;
  if (!parsed || typeof parsed !== 'object') return undefined;
  const { version, dependencies } = parsed as { version?: unknown; dependencies?: unknown };
  if (typeof version !== 'string' || !SEMVER.test(version)) return undefined;
  const deps: Record<string, string> = {};
  if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === 'string') deps[name] = range;
    }
  }
  return { version, dependencies: deps };
}

/**
 * npm package names (validate-npm-package-name rules for new packages): optional lowercase
 * `@scope/`, URL-safe characters only, at most 214 characters. Names come from the user's
 * `package.json` and reach a shell on Windows, so anything else is never queried.
 */
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;

/** A dist-tag or exact version: no shell metacharacters (cmd.exe treats `^ < > | &` specially). */
const NPM_VIEW_SPEC = /^[0-9A-Za-z.+-]+$/u;

export function isValidNpmPackageName(name: string): boolean {
  return name.length <= 214 && NPM_PACKAGE_NAME.test(name);
}

/**
 * Queries the registry the project's npm configuration points to (mirrors included) with
 * `npm view`. Failures (offline, unknown package, timeout) yield `undefined`, never a throw.
 * An invalid package name or spec is never queried (on Windows `npm` runs through a shell, so
 * `@zhin.js/x&calc` would otherwise run a command) and yields `undefined` as well.
 */
export const npmRegistryLookup: RegistryLookup = (name, spec = 'latest') => {
  if (!isValidNpmPackageName(name) || !NPM_VIEW_SPEC.test(spec)) return undefined;
  try {
    const output = execFileSync('npm', ['view', `${name}@${spec}`, 'version', 'dependencies', '--json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    return parseNpmViewRelease(output);
  } catch {
    return undefined;
  }
};

/** Memoizes a lookup for one command run, so each package is queried once. */
export function cachedRegistryLookup(lookup: RegistryLookup): RegistryLookup {
  const cache = new Map<string, RegistryRelease | undefined>();
  return (name, spec = 'latest') => {
    const key = `${name}@${spec}`;
    if (!cache.has(key)) cache.set(key, lookup(name, spec));
    return cache.get(key);
  };
}
