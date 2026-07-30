import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { parsePackageJson, type PackageJson } from './manifest.js';

export interface ResolvedPackage {
  readonly name: string;
  readonly root: string;
  readonly packageJson: PackageJson;
  readonly source: 'workspace' | 'node_modules' | 'local';
}

export interface PackageResolver {
  root(root: string): Promise<ResolvedPackage>;
  resolve(request: string, from: ResolvedPackage): Promise<ResolvedPackage>;
  /** Load a package from an absolute package root (skips dependency declaration checks). */
  loadPackage?(packageRoot: string): Promise<ResolvedPackage>;
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
        // 注意：plugins/<x>/plugins/ 嵌套目录不再报错——顶层扫描只注册一层
        // workspace 包；更深的本地插件经 manifest 的 './' 相对路径显式引用。
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

  async loadPackage(packageRoot: string): Promise<ResolvedPackage> {
    return this.#readPackage(packageRoot, 'node_modules');
  }

  workspacePackages(): readonly ResolvedPackage[] {
    return [...this.#workspaceByName.values()];
  }

  async resolve(request: string, from: ResolvedPackage): Promise<ResolvedPackage> {
    // 解析管线（按序短路，任一步命中即返回）：
    //
    // 1. 本地路径（'./' 开头）：monorepo 本地插件目录，相对声明包根解析。
    //    目录即声明——跳过依赖声明检查，也不入 node_modules。
    if (request.startsWith('./')) return this.#resolveLocal(request, from);

    // 2. 声明检查（仅包名引用），按声明位置分级：
    //    - dependencies / optionalDependencies：硬要求，引用必须能在此声明；
    //    - peerDependencies：宽松声明——允许未安装，解析失败由引用方 optional 容错；
    //    - 三者皆无：拒绝（zhin manifest 引用必须可追溯到包依赖声明）。
    const specification = declaredDependency(request, from.packageJson);

    // 3. workspace byName：packages/* + plugins/* 顶层扫描结果优先命中。
    //    'workspace:*' 未命中时继续走 node_modules——examples 等在扫描面之外，
    //    但 pnpm 仍会把 workspace:* 链接进 node_modules。
    const workspace = this.#workspaceByName.get(request);
    if (workspace) return workspace;

    // 4. node_modules 上溯：从声明包根逐级向上查找。
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
      specification.startsWith('workspace:')
        ? `Workspace dependency ${request} declared by ${from.name} is missing`
        : `Cannot resolve ${request} from ${from.name}`,
      request,
    );
  }

  async #resolveLocal(request: string, from: ResolvedPackage): Promise<ResolvedPackage> {
    const packageRoot = join(from.root, request);
    if (await exists(join(packageRoot, 'package.json'))) {
      return this.#readPackage(packageRoot, 'local');
    }
    throw new PackageResolutionError(`Cannot resolve ${request} from ${from.name}`, request);
  }

  async #readPackage(
    packageRoot: string,
    source: ResolvedPackage['source'],
  ): Promise<ResolvedPackage> {
    const normalized = await realpath(resolve(packageRoot));
    const cached = this.#cache.get(normalized);
    if (cached) return cached;
    const file = join(normalized, 'package.json');
    const content = await readFile(file, 'utf8');
    const parsedPackageJson = parsePackageJson(JSON.parse(content) as unknown, file);
    const entry = await resolveRuntimeEntry(
      normalized,
      parsedPackageJson.zhin.entry,
      source,
    );
    const packageJson = entry === parsedPackageJson.zhin.entry
      ? parsedPackageJson
      : Object.freeze({
          ...parsedPackageJson,
          zhin: Object.freeze({
            ...parsedPackageJson.zhin,
            entry,
          }),
        });
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

async function resolveRuntimeEntry(
  packageRoot: string,
  declaredEntry: string,
  source: ResolvedPackage['source'],
): Promise<string> {
  const declared = resolve(packageRoot, declaredEntry);
  const extension = extname(declared);
  const base = declared.slice(0, -extension.length);
  const sourceCandidates = extension === '.js'
    ? [`${base}.ts`, `${base}.tsx`]
    : [declared];
  const javascriptCandidates = extension === '.ts' || extension === '.tsx'
    ? [`${base}.js`, join(packageRoot, 'lib', `${base.slice(packageRoot.length + 1)}.js`)]
    : [declared];
  const candidates = source === 'node_modules'
    ? [...javascriptCandidates, ...sourceCandidates]
    : [...sourceCandidates, ...javascriptCandidates];
  for (const candidate of new Set(candidates)) {
    if (await exists(candidate)) return `./${relative(packageRoot, candidate).replaceAll('\\', '/')}`;
  }
  return declaredEntry;
}

function declaredDependency(request: string, pkg: PackageJson): string {
  const specification = (
    pkg.dependencies?.[request]
    ?? pkg.optionalDependencies?.[request]
    // peerDependencies 是宽松声明：允许未安装。未安装时 resolve 抛
    // PackageResolutionError，由引用方的 optional 标记统一容错。
    ?? pkg.peerDependencies?.[request]
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
