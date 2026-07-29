const WORKSPACE_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
];

/**
 * Resolve workspace packages that must be packed together before any member is
 * published. Dependencies are returned before their consumers.
 *
 * @param {ReadonlyArray<{ name: string, manifest: Record<string, unknown> }>} packages
 * @param {ReadonlyArray<string>} rootNames
 */
export function resolveWorkspacePackClosure(packages, rootNames) {
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  const visited = new Set();
  const visiting = new Set();
  const result = [];

  function visit(name) {
    if (visited.has(name)) return;
    const entry = byName.get(name);
    if (!entry) throw new Error(`Workspace package not found: ${name}`);
    if (visiting.has(name)) return;
    visiting.add(name);
    for (const dependencyName of workspaceDependencyNames(entry.manifest, byName)) {
      visit(dependencyName);
    }
    visiting.delete(name);
    visited.add(name);
    result.push(entry);
  }

  for (const rootName of rootNames) visit(rootName);
  return result;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {Map<string, unknown>} workspaceByName
 */
export function workspaceDependencyNames(manifest, workspaceByName) {
  const names = [];
  for (const field of WORKSPACE_FIELDS) {
    const dependencies = manifest[field];
    if (!dependencies || typeof dependencies !== 'object') continue;
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (
        typeof specifier === 'string'
        && specifier.startsWith('workspace:')
        && workspaceByName.has(name)
      ) {
        names.push(name);
      }
    }
  }
  return [...new Set(names)].sort();
}

/**
 * Point every packed workspace package at its local tarball so unpublished
 * transitive versions are resolved from the same publish candidate.
 *
 * @param {Record<string, unknown>} manifest
 * @param {ReadonlyArray<{ name: string }>} packClosure
 * @param {Map<string, { tarball: string }>} packedPackages
 */
export function withWorkspaceTarballOverrides(
  manifest,
  packClosure,
  packedPackages,
) {
  const packedOverrides = {};
  for (const { name } of packClosure) {
    const packed = packedPackages.get(name);
    if (!packed) throw new Error(`Packed workspace artifact is missing: ${name}`);
    packedOverrides[name] = `file:${packed.tarball}`;
  }

  const pnpm = manifest.pnpm && typeof manifest.pnpm === 'object'
    ? manifest.pnpm
    : {};
  const overrides = pnpm.overrides && typeof pnpm.overrides === 'object'
    ? pnpm.overrides
    : {};

  return {
    ...manifest,
    pnpm: {
      ...pnpm,
      overrides: {
        ...overrides,
        ...packedOverrides,
      },
    },
  };
}
