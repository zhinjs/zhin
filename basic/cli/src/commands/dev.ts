import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import { DevLinkError, devLink, devUnlink } from '../utils/dev-link.js';
import { devLinkPlugin, devUnlinkPlugin, isZhinPluginDirectory, linkedPluginKeys } from '../utils/dev-link-plugin.js';

async function run(action: () => unknown): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof DevLinkError) {
      console.error(chalk.red(`zhin dev：${error.message}`));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

/** 开发辅助命令：外部项目联调本地 zhin 源码，或把独立插件接进 bot 热重载开发。 */
export const devCommand = new Command('dev')
  .description('开发辅助：外部项目联调本地 zhin 源码；把独立插件接进 bot 热重载开发');

devCommand
  .command('link <path>')
  .description('<path> 是独立插件目录时：链接到 bot 的 plugins/ 并写入 ./plugins/<实例名>，改插件源码即热重载；'
    + '<path> 是 zhin 源码仓库时：把当前项目依赖的 zhin.js / @zhin.js/* 全部切换到本地源码（保证每个包只有一份实例）')
  .option('--project <dir>', '目标项目（bot）目录', '.')
  .option('--as <instance>', '插件模式：实例名（默认取包名，去掉 zhin.js- / zhin-plugin- 前缀）')
  .option('--no-install', '源码仓库模式：只改清单，不执行 pnpm install')
  .action((target: string, options: { project: string; as?: string; install: boolean }) => run(async () => {
    const resolved = path.resolve(target);
    if (isZhinPluginDirectory(resolved)) {
      await devLinkPlugin(path.resolve(options.project), resolved, { instanceKey: options.as });
      return;
    }
    if (options.as) throw new DevLinkError(`--as 只用于插件目录，${resolved} 不是 zhin 插件（package.json 缺少 zhin 字段）`);
    devLink(path.resolve(options.project), { repo: resolved, noInstall: !options.install });
  }));

devCommand
  .command('unlink [instance]')
  .description('带实例名：撤销 zhin dev link <插件目录>；不带：撤销源码仓库 link，恢复 package.json / pnpm-lock.yaml 并重新安装注册表版本')
  .option('--project <dir>', '目标项目目录', '.')
  .option('--no-install', '只恢复清单，不执行 pnpm install')
  .option('--force', 'link 之后 package.json 被改动时仍然恢复（丢弃这些改动）')
  .action((instance: string | undefined, options: { project: string; install: boolean; force?: boolean }) => run(async () => {
    const project = path.resolve(options.project);
    if (instance) {
      await devUnlinkPlugin(project, instance);
      return;
    }
    const restored = devUnlink(project, { noInstall: !options.install, force: options.force });
    const plugins = linkedPluginKeys(project);
    if (!restored && plugins.length) console.log(`已链接的插件：${plugins.join(', ')}；撤销用 zhin dev unlink <实例名>`);
  }));
