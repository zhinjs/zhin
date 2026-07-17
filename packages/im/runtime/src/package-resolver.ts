import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parsePackageJson, type PackageJson } from './manifest.js';

export interface ResolvedPackage {
  readonly name: string;
  readonly root: string;
  readonly packageJson: PackageJson;
  readonly source: 'workspace' | 'node_modules';
}

export interface PackageResolver {
  root(root: string): Promise<ResolvedPackage>;
  resolve(request: string, from: ResolvedPackage): Promise<ResolvedPackage>;
  workspacePackages(): readonly ResolvedPackage[];
}

export class PackageResolutionError extends Error {
  constructor(message: string, readonly request?: string) {
    super(message);
    this.name = 'PackageResolutionError';
  }
}

export class NodePackageResolver implements PackageResolver {
  readonly #workspaceByName = new Map<string, ResolvedPackage>();
  readonly #cache = new Map<string, ResolvedPackage>();

  static async create(projectRoot: string): Promise<NodePackageResolver> {
    const resolver = new NodePackageResolver();
    const root = await resolver.#readPackage(projectRoot, 'workspace');
    resolver.#workspaceByName.set(root.name, root);

    for (const directory of ['packages', 'plugins']) {
      const parent = join(projectRoot, directory);
      for (const entry of await safeReadDirectories(parent)) {
        const packageRoot = join(parent, entry);
        if (await exists(join(packageRoot, 'pnpm-workspace.yaml'))) {
          throw new PackageResolutionError(
            `Nested workspace is not allowed: ${packageRoot}`,
          );
        }
        if (directory === 'plugins' && await exists(join(packageRoot, 'plugins'))) {
          throw new PackageResolutionError(
            `Nested local Plugin directory is not allowed: ${join(packageRoot, 'plugins')}`,
          );
        }
        if (!await exists(join(packageRoot, 'package.json'))) continue;
        const pkg = await resolver.#readPackage(packageRoot, 'workspace');
        if (resolver.#workspaceByName.has(pkg.name)) {
          throw new PackageResolutionError(`Duplicate workspace package: ${pkg.name}`);
        }
        resolver.#workspaceByName.set(pkg.name, pkg);
      }
    }
    return resolver;
  }

  async root(root: string): Promise<ResolvedPackage> {
    return this.#readPackage(root, 'workspace');
  }

  workspacePackages(): readonly ResolvedPackage[] {
    return [...this.#workspaceByName.values()];
  }

  async resolve(request: string, from: ResolvedPackage): Promise<ResolvedPackage> {
    const specification = declaredDependency(request, from.packageJson);
    const workspace = this.#workspaceByName.get(request);
    if (specification.startsWith('workspace:')) {
      if (workspace) return workspace;
      throw new PackageResolutionError(
        `Workspace dependency ${request} declared by ${from.name} is missing`,
        request,
      );
    }

    let current = from.root;
    while (true) {
      const packageRoot = join(current, 'node_modules', ...request.split('/'));
      if (await exists(join(packageRoot, 'package.json'))) {
        return this.#readPackage(packageRoot, 'node_modules');
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    throw new PackageResolutionError(
      `Cannot resolve ${request} from ${from.name}`,
      request,
    );
  }

  async #readPackage(
    packageRoot: string,
    source: ResolvedPackage['source'],
  ): Promise<ResolvedPackage> {
    const normalized = resolve(packageRoot);
    const cached = this.#cache.get(normalized);
    if (cached) return cached;
    const file = join(normalized, 'package.json');
    const content = await readFile(file, 'utf8');
    const packageJson = parsePackageJson(JSON.parse(content) as unknown, file);
    const result = Object.freeze({
      name: packageJson.name,
      root: normalized,
      packageJson,
      source,
    });
    this.#cache.set(normalized, result);
    return result;
  }
}

function declaredDependency(request: string, pkg: PackageJson): string {
  const specification = (
    pkg.dependencies?.[request]
    ?? pkg.optionalDependencies?.[request]
  );
  if (!specification) {
    throw new PackageResolutionError(
      `${pkg.name} references ${request} in zhin manifest but does not declare it as a package dependency`,
      request,
    );
  }
  return specification;
}

async function safeReadDirectories(parent: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
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

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
