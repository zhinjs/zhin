/**
 * Dependency specifier classes shared by `zhin migrate` and the `zhin update` preview (#1250), so
 * both agree on which specifiers the user locked and which are not registry versions at all.
 */

/**
 * Non-registry sources: protocols (`link:`, `file:`, `portal:`, `catalog:`, `npm:` aliases,
 * `jsr:`, git hosts and git URLs, tarball URLs) and relative / absolute paths.
 */
const NON_REGISTRY_PROTOCOL = /^(?:link:|file:|portal:|catalog:|npm:|jsr:|git\+|git:|github:|gitlab:|bitbucket:|gist:|https?:|\.{0,2}\/)/u;

/**
 * The GitHub shorthand `user/repo` or `user/repo#ref` (npm and pnpm resolve it from GitHub). A
 * registry range never contains `/`, and `@scope/name` starts with `@`, so neither matches.
 */
const GITHUB_SHORTHAND = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+(?:#\S*)?$/u;

/** An exact version (`1.2.3`, `=1.2.3`, `v1.2.3-beta.1`): an upgrade keeps it exact. */
export function isExactVersionSpecifier(specifier: string): boolean {
  return /^=?v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/u.test(specifier.trim());
}

/** Not a registry version of the package: an alias, a path, git, a tarball, `jsr:`, `catalog:`, … */
export function isNonRegistrySpecifier(specifier: string): boolean {
  const value = specifier.trim();
  return NON_REGISTRY_PROTOCOL.test(value) || GITHUB_SHORTHAND.test(value);
}

/**
 * A specifier the user deliberately locked: exact versions, aliases, links, paths, git and tarballs.
 * Ranges (^, ~, >=, *, x) and dist-tags are considered "follow upstream" and may move to latest.
 */
export function isPinnedSpecifier(specifier: string): boolean {
  return isExactVersionSpecifier(specifier) || isNonRegistrySpecifier(specifier);
}

/** Local sources a workspace member's dependency keeps (`workspace:`, `link:`, `file:`, …): never rewritten. */
export function isLocalDependencySpecifier(specifier: string): boolean {
  return specifier.trim().startsWith('workspace:') || isNonRegistrySpecifier(specifier);
}
