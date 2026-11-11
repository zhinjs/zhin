import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const ZHIN_PROJECT_ROOT_ENV = 'ZHIN_PROJECT_ROOT';

export interface ZhinProjectInstance {
  kind: 'project';
  root: string;
}

export interface ZhinGlobalInstance {
  kind: 'global';
  root: string;
}

export type ZhinInstance = ZhinProjectInstance | ZhinGlobalInstance;

/** 全局 Zhin 实例目录（`~/.zhin`） */
export function globalZhinHome(homeDir = os.homedir()): string {
  return path.join(homeDir, '.zhin');
}

/** `package.json` 是否声明 `zhin.js` 依赖 */
export function hasZhinPackageJson(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return !!(
      pkg.dependencies?.['zhin.js'] ||
      pkg.devDependencies?.['zhin.js']
    );
  } catch {
    return false;
  }
}

export function hasNodeModules(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'node_modules'));
}

/** 当前目录是否为 Zhin 项目根 */
export function findProjectInstance(cwd = process.cwd()): ZhinProjectInstance | null {
  if (!hasZhinPackageJson(cwd)) return null;
  return { kind: 'project', root: path.resolve(cwd) };
}

/** `~/.zhin` 是否已初始化为全局实例 */
export function findGlobalInstance(homeDir = os.homedir()): ZhinGlobalInstance | null {
  const root = globalZhinHome(homeDir);
  if (!hasZhinPackageJson(root)) return null;
  return { kind: 'global', root };
}

/**
 * 选择启动目标：当前目录的 **project** 优先，否则 **global**（`~/.zhin`）。
 */
export function resolveProjectOrGlobal(
  cwd = process.cwd(),
  homeDir = os.homedir(),
): ZhinInstance | null {
  return findProjectInstance(cwd) ?? findGlobalInstance(homeDir);
}
