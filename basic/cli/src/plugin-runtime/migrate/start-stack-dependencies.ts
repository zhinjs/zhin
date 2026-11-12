import { existsSync, readFileSync } from 'node:fs';
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
  | { readonly kind: 'drop-dev-duplicate'; readonly name: string; readonly version: string }
  /** A scaffold placeholder (`^0.0.0`) in devDependencies; the package is added to dependencies instead. */
  | { readonly kind: 'drop-dev-placeholder'; readonly name: string; readonly version: string };

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
    } else if (!hasDeclaredVersion(development) && !hasDeclaredVersion(dependencies[name])) {
      changes.push({ kind: 'drop-dev-placeholder', name, version: development });
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

let runningCliVersion: string | undefined;
/** Version of the CLI running the migration. */
function currentCliVersion(): string {
  if (runningCliVersion) return runningCliVersion;
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    runningCliVersion = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch { runningCliVersion = '0.0.0'; }
  return runningCliVersion;
}

/** `major.minor` of the first version in a specifier (`^1.2.3`, `~1.2`, `1.2.x`, `>=1.2.0 <2`). */
function releaseLine(spec: string): readonly [number, number] | undefined {
  // One linear pass (no backtracking regex): find the first `<digits>.<digits>`.
  const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9';
  let index = 0;
  while (index < spec.length) {
    if (!isDigit(spec[index])) { index += 1; continue; }
    const majorStart = index;
    while (isDigit(spec[index])) index += 1;
    if (spec[index] !== '.' || !isDigit(spec[index + 1])) continue;
    const minorStart = index + 1;
    let minorEnd = minorStart;
    while (isDigit(spec[minorEnd])) minorEnd += 1;
    return [Number(spec.slice(majorStart, index)), Number(spec.slice(minorStart, minorEnd))];
  }
  return undefined;
}

/** First release line of `@zhin.js/gateway`: an older CLI line has no gateway of its own. */
const FIRST_GATEWAY_LINE: readonly [number, number] = [1, 1];

/**
 * The gateway follows the project CLI's release line: a dist-tag (`latest`, `next`, …) or a
 * workspace protocol is reused as is; a CLI on the release line of the CLI running the migration
 * gets the gateway range released together with it (the scaffold stack ranges); a CLI kept on
 * another line (`1.1.20` while migrating with 1.2) gets the gateway of that line (`~1.1.0`), so
 * the two are not mismatched. Unknown specifiers fall back to the scaffold range, else `latest`.
 */
export function gatewayRangeFor(cliSpec: string, runningCli: string = currentCliVersion()): string {
  const spec = cliSpec.trim();
  if (/^workspace:/u.test(spec) || /^[a-z][a-z0-9-]*$/iu.test(spec)) return spec;
  const scaffold = withScaffoldVersionRanges({ '@zhin.js/gateway': LATEST })['@zhin.js/gateway'] ?? LATEST;
  const project = hasDeclaredVersion(spec) ? releaseLine(spec) : undefined;
  const running = releaseLine(runningCli);
  if (!project || !running) return scaffold;
  if (project[0] === running[0] && project[1] === running[1]) return scaffold;
  const older = project[0] < FIRST_GATEWAY_LINE[0] || (project[0] === FIRST_GATEWAY_LINE[0] && project[1] < FIRST_GATEWAY_LINE[1]);
  if (older) return scaffold;
  return `~${project[0]}.${project[1]}.0`;
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
