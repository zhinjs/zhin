import * as path from 'node:path';

let projectRoot: string | null = null;

/**
 * 在加载主配置文件（zhin.config.*）之后立即调用。
 * 锁定「机器人项目根」（与配置文件同目录），避免后续 `process.chdir`（如嵌入 Farm 解析 console-app）
 * 导致 `loadPlugins` 仍用 `process.cwd()` 时误从 `packages/console-app` 解析 `node_modules` / `./src/plugins`。
 */
export function setZhinProjectRoot(root: string): void {
  projectRoot = path.resolve(root);
}

/**
 * 机器人项目根；未调用 set 时与 `process.cwd()` 一致（兼容测试/非 setup 入口）。
 * 也可在启动前设置环境变量 `ZHIN_PROJECT_ROOT`（由 loadConfig 读入并 set）。
 */
export function getZhinProjectRoot(): string {
  return projectRoot ?? process.cwd();
}
