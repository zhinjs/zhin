import { formatCompact, formatDisplayPath } from '@zhin.js/logger';
import { CREATE_PROJECT_COMMAND } from './create-project.js';
import { ensureGlobalHome } from './global-home-init.js';
import { logger } from './logger.js';
import {
  findGlobalInstance,
  findProjectInstance,
  hasNodeModules,
  resolveProjectOrGlobal,
  type ZhinInstance,
} from './zhin-home.js';

export type RequireZhinInstanceOptions = {
  /** 无 project / global 时自动初始化 `~/.zhin` 并安装依赖 */
  initGlobal?: boolean;
  homeDir?: string;
};

/**
 * 确定 CLI 启动目标（project 或 global）；必要时初始化全局实例。失败时 `process.exit(1)`。
 */
export async function requireZhinInstance(
  options: RequireZhinInstanceOptions = {},
): Promise<ZhinInstance> {
  const cwd = process.cwd();
  const homeDir = options.homeDir;

  let instance = resolveProjectOrGlobal(cwd, homeDir);

  if (!instance && options.initGlobal) {
    logger.info(formatCompact({ op: 'init_global_home', path: '~/.zhin' }));
    await ensureGlobalHome({ install: true, homeDir });
    instance = findGlobalInstance(homeDir) ?? findProjectInstance(cwd);
  }

  if (!instance) {
    logger.error('❌ 未找到 Zhin 项目或全局实例');
    logger.info(formatCompact({
      op: 'hint',
      hint: `在项目根目录运行，或使用 ${CREATE_PROJECT_COMMAND} 创建项目；全局模式: zhin setup --global`,
    }));
    process.exit(1);
  }

  if (!hasNodeModules(instance.root)) {
    logger.error('❌ 依赖未安装或不完整');
    if (instance.kind === 'global') {
      logger.info(formatCompact({ op: 'hint', hint: 'zhin setup --global 或在 ~/.zhin 执行 npm install' }));
    } else {
      logger.info(formatCompact({ op: 'hint', hint: 'pnpm install' }));
    }
    process.exit(1);
  }

  if (instance.kind === 'global') {
    logger.info(formatCompact({ op: 'zhin_instance', kind: 'global', path: formatDisplayPath(instance.root) }));
  }

  return instance;
}
