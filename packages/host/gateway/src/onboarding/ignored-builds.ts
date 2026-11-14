/**
 * pnpm 10+ skips dependency build scripts that the project did not allow; pnpm 11 (and pnpm 10
 * with `strictDepBuilds`) then exits 1 with `ERR_PNPM_IGNORED_BUILDS` although every dependency
 * was resolved, fetched and linked. That exit is not a failed install: the packages are in place,
 * only their build scripts did not run (#1250). These helpers tell the two apart.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';

export const PNPM_IGNORED_BUILDS_CODE = 'ERR_PNPM_IGNORED_BUILDS';

/** Cap on the package-manager output kept to recognise the error (its summary comes last). */
export const IGNORED_BUILDS_OUTPUT_LIMIT = 64 * 1024;

/**
 * The packages pnpm reports in `Ignored build scripts: a@1.0.0, @scope/b@2.0.0.`; `undefined` when
 * the output does not carry `ERR_PNPM_IGNORED_BUILDS` (an empty list when the list is unreadable).
 */
export function parseIgnoredBuilds(output: string): readonly string[] | undefined {
  if (!output.includes(PNPM_IGNORED_BUILDS_CODE)) return undefined;
  const names = new Set<string>();
  for (const match of output.matchAll(/Ignored build scripts:\s*([^\n]*)/gu)) {
    for (const raw of match[1]!.split(',')) {
      const item = raw.replace(/[│|]/gu, '').trim().replace(/\.$/u, '').trim();
      const at = item.lastIndexOf('@');
      const name = at > 0 ? item.slice(0, at) : item;
      if (/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu.test(name)) names.add(name);
    }
  }
  return Object.freeze([...names]);
}

/** Package names named by an `add` invocation (`add [-w] [-D] <spec>…`); empty for other commands. */
export function addedPackageNames(args: readonly string[]): readonly string[] {
  if (args[0] !== 'add') return [];
  return args.slice(1).filter(arg => !arg.startsWith('-')).map((spec) => {
    const bare = spec.replace(/^npm:/u, '');
    const at = bare.indexOf('@', 1);
    return at > 0 ? bare.slice(0, at) : bare;
  });
}

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/**
 * Whether the dependencies of `args` are in place after pnpm reported ignored builds: pnpm wrote
 * `node_modules/.modules.yaml` (it does so after linking) and every package an `add` named is in
 * `node_modules`. Only then is the exit treated as a warning.
 */
export async function dependenciesInPlace(projectRoot: string, args: readonly string[]): Promise<boolean> {
  if (!await exists(join(projectRoot, 'node_modules', '.modules.yaml'))) return false;
  for (const name of addedPackageNames(args)) {
    if (!await exists(join(projectRoot, 'node_modules', ...name.split('/'), 'package.json'))) return false;
  }
  return true;
}

/** The hint printed for ignored builds: same allowance the scaffold writes for native packages. */
export function ignoredBuildsHint(names: readonly string[]): string {
  const list = names.length ? names.join('、') : '部分依赖';
  const example = names[0] ?? '<包名>';
  return `pnpm 跳过了 ${list} 的构建脚本（${PNPM_IGNORED_BUILDS_CODE}），依赖本身已安装。`
    + `如需运行它们的构建脚本：在 pnpm-workspace.yaml 写 allowBuilds:\n  ${example}: true\n`
    + `（pnpm < 10.26 改为 onlyBuiltDependencies 列表），再运行 pnpm rebuild ${names.join(' ') || example}；不需要构建产物的包可以不处理。`;
}
