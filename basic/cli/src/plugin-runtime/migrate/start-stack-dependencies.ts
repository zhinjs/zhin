import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { withScaffoldVersionRanges } from '@zhin.js/scaffold-wizard';

/**
 * A bot project runs `zhin start` in production too: the CLI starts the management gateway,
 * which supervises the instance (ADR 0054 §0). `zhin.js`, `@zhin.js/cli` and `@zhin.js/gateway`
 * therefore all belong in `dependencies` (a `--prod` install keeps them). Older projects listed
 * the CLI under `devDependencies` and had no gateway at all.
 */
export const START_STACK_PACKAGES = Object.freeze(['zhin.js', '@zhin.js/cli', '@zhin.js/gateway'] as const);

export type StartStackChange =
  | { readonly kind: 'move'; readonly name: string; readonly version: string }
  | { readonly kind: 'add'; readonly name: string; readonly version: string }
  | { readonly kind: 'drop-dev-duplicate'; readonly name: string; readonly version: string };

export interface StartStackDependencies {
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly changes: readonly StartStackChange[];
}

const LATEST = 'latest';

/** `undefined`, `0.0.0` and `^0.0.0` are scaffold placeholders, not a declared version. */
export function hasDeclaredVersion(spec: string | undefined): spec is string {
  return spec !== undefined && spec !== '^0.0.0' && spec !== '0.0.0';
}

/**
 * Puts `zhin.js`, `@zhin.js/cli` and `@zhin.js/gateway` side by side in `dependencies`:
 * a declaration found only in `devDependencies` moves with its version; a duplicate left in
 * `devDependencies` is dropped (`dependencies` wins); a missing package is added — `zhin.js`
 * and the CLI as `latest`, the gateway on the CLI's release line ({@link gatewayRangeFor}).
 */
export function withStartStackDependencies(
  existing: Readonly<Record<string, string>> | undefined,
  existingDevelopment: Readonly<Record<string, string>> | undefined,
): StartStackDependencies {
  const dependencies = { ...existing };
  const devDependencies = { ...existingDevelopment };
  const changes: StartStackChange[] = [];
  for (const name of START_STACK_PACKAGES) {
    const development = devDependencies[name];
    if (development === undefined) continue;
    if (!hasDeclaredVersion(dependencies[name]) && hasDeclaredVersion(development)) {
      dependencies[name] = development;
      changes.push({ kind: 'move', name, version: development });
    } else {
      changes.push({ kind: 'drop-dev-duplicate', name, version: development });
    }
    delete devDependencies[name];
  }
  for (const name of ['zhin.js', '@zhin.js/cli'] as const) {
    if (hasDeclaredVersion(dependencies[name])) continue;
    dependencies[name] = LATEST;
    changes.push({ kind: 'add', name, version: LATEST });
  }
  if (!hasDeclaredVersion(dependencies['@zhin.js/gateway'])) {
    const version = gatewayRangeFor(dependencies['@zhin.js/cli']!);
    dependencies['@zhin.js/gateway'] = version;
    changes.push({ kind: 'add', name: '@zhin.js/gateway', version });
  }
  return { dependencies, devDependencies, changes };
}

/**
 * The gateway follows the CLI's release line: a dist-tag (`latest`, `next`, …) or a workspace
 * protocol is reused as is; any other specifier gets the gateway range released together with
 * this CLI (the scaffold stack ranges), falling back to `latest` when none is known.
 */
export function gatewayRangeFor(cliSpec: string): string {
  const spec = cliSpec.trim();
  if (/^workspace:/u.test(spec) || /^[a-z][a-z0-9-]*$/iu.test(spec)) return spec;
  return withScaffoldVersionRanges({ '@zhin.js/gateway': LATEST })['@zhin.js/gateway'] ?? LATEST;
}

const PROJECT_CONFIG_FILES = Object.freeze([
  'zhin.config.yml',
  'zhin.config.yaml',
  'zhin.config.json',
  'zhin.config.toml',
  'zhin.config.ts',
  'zhin.config.js',
  'zhin.config.mjs',
  'zhin.config.cjs',
]);

/**
 * Whether a directory is a bot project (it has a project config next to its package.json),
 * rather than a Plugin package. A Plugin package keeps the CLI as a development tool and never
 * depends on the gateway.
 */
export function isBotProjectDirectory(directory: string): boolean {
  return PROJECT_CONFIG_FILES.some(file => existsSync(join(directory, file)));
}
