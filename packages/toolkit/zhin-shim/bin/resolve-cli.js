// Resolves the `zhin` bin of the installed @zhin.js/cli.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CLI = '@zhin.js/cli';

/** Locate the installed @zhin.js/cli package.json. */
export function findCliPackageJson() {
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

/** Absolute path of the `zhin` bin declared by @zhin.js/cli. */
export function findCliBin() {
  const manifestPath = findCliPackageJson();
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const target = typeof bin === 'string' ? bin : bin?.zhin;
  if (typeof target !== 'string') throw new Error(`${CLI} does not declare a zhin bin`);
  return resolve(dirname(manifestPath), target);
}
