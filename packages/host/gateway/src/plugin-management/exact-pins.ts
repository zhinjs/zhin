/**
 * Whether a project pins its Zhin packages to exact versions (#1250), so that installing a plugin
 * follows the same style (`pnpm add --save-exact`) instead of writing a `^` range next to them.
 *
 * Rule: look at every `zhin.js` / `@zhin.js/*` entry in `dependencies`, `devDependencies` and
 * `optionalDependencies`. Entries that do not name a registry version (`workspace:`, `link:`,
 * `file:`, `catalog:`, `npm:` aliases, git / URL / path sources, tags such as `latest`) say
 * nothing about the style and are skipped. The project pins exactly when at least one registry
 * entry remains and every such entry is a bare version (`1.5.0`, `1.5.0-beta.1`): no `^`, `~`,
 * `>=`, `x` or `*` range.
 */

type DependencyMaps = Readonly<{
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
  optionalDependencies?: Readonly<Record<string, string>>;
}>;

const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
/** A semver range (`^1`, `~1.2`, `>=1 <2`, `1.x`, `*`, `1.2.3 || 2`) — a registry version, not exact. */
const VERSION_RANGE = /^(?:[\^~<>=*]|\d+(?:\.(?:\d+|[xX*]))?(?:\.(?:\d+|[xX*]))?\s*(?:$|[-|\s]))/u;

function isZhinPackage(name: string): boolean {
  return name === 'zhin.js' || name.startsWith('@zhin.js/');
}

/** `exact`: a bare version; `range`: any other semver range; `other`: not a registry version. */
function versionStyle(spec: string): 'exact' | 'range' | 'other' {
  const value = spec.trim();
  if (EXACT_VERSION.test(value)) return 'exact';
  if (value === '' || value === '*' || value === 'x' || VERSION_RANGE.test(value)) return 'range';
  return 'other';
}

export function projectPinsExactZhinVersions(project: DependencyMaps | undefined): boolean {
  if (!project) return false;
  const styles = [project.dependencies, project.devDependencies, project.optionalDependencies]
    .flatMap(map => Object.entries(map ?? {}))
    .filter(([name, spec]) => isZhinPackage(name) && typeof spec === 'string')
    .map(([, spec]) => versionStyle(spec))
    .filter(style => style !== 'other');
  return styles.length > 0 && styles.every(style => style === 'exact');
}

/** An npm registry request (`name`, `name@version`, `name@tag`), not a git / path / URL source. */
export function isRegistryPackageRequest(request: string): boolean {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:@[^\s/:]+)?$/u.test(request.trim());
}
