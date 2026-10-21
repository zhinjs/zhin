// Resolves the `zhin` bin of the project's installed @zhin.js/cli (falling back to the shim's own).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CLI = '@zhin.js/cli';

/** The project's own @zhin.js/cli, resolved from `cwd` (what `npx zhin` pins), if installed. */
function findProjectCliPackageJson(cwd) {
  const projectRequire = createRequire(join(cwd, 'noop.js'));
  try {
    return projectRequire.resolve(`${CLI}/package.json`);
  } catch {
    // `exports` may not list ./package.json: look for the package root along Node's lookup paths.
  }
  for (const dir of projectRequire.resolve.paths(CLI) ?? []) {
    const candidate = join(dir, CLI, 'package.json');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** The @zhin.js/cli the shim itself depends on. */
function findShimCliPackageJson() {
  try {
    return createRequire(import.meta.url).resolve(`${CLI}/package.json`);
  } catch {
    // @zhin.js/cli's `exports` does not list ./package.json: resolve its entry
    // and walk up to the package root instead.
  }
  let dir = dirname(fileURLToPath(import.meta.resolve(CLI)));
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate) && JSON.parse(readFileSync(candidate, 'utf8')).name === CLI) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Cannot find the ${CLI} package root`);
    dir = parent;
  }
}

/**
 * Locate @zhin.js/cli's package.json. The project's own copy (resolved from `cwd`)
 * wins so `npx zhin` runs the version the project pins; the shim's dependency is the fallback.
 */
export function findCliPackageJson(cwd = process.cwd()) {
  return findProjectCliPackageJson(cwd) ?? findShimCliPackageJson();
}

/** Absolute path of the `zhin` bin declared by @zhin.js/cli. */
export function findCliBin(cwd = process.cwd()) {
  const manifestPath = findCliPackageJson(cwd);
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const target = typeof bin === 'string' ? bin : bin?.zhin;
  if (typeof target !== 'string') throw new Error(`${CLI} does not declare a zhin bin`);
  return resolve(dirname(manifestPath), target);
}
