import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import { DevLinkError, devLink, devUnlink } from '../utils/dev-link.js';

function run(action: () => void): void {
  try {
    action();
  } catch (error) {
    if (error instanceof DevLinkError) {
      console.error(chalk.red(`zhin dev：${error.message}`));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

/** 开发辅助命令：外部项目联调本地 zhin 源码。 */
export const devCommand = new Command('dev')
  .description('开发辅助：外部项目联调本地 zhin 源码');

devCommand
  .command('link <zhin-path>')
  .description('把当前项目依赖的 zhin.js / @zhin.js/* 全部切换到本地 zhin 源码（保证每个包只有一份实例）')
  .option('--project <dir>', '目标项目目录', '.')
  .option('--no-install', '只改清单，不执行 pnpm install')
  .action((zhinPath: string, options: { project: string; install: boolean }) => {
    run(() => {
      devLink(path.resolve(options.project), { repo: path.resolve(zhinPath), noInstall: !options.install });
    });
  });

devCommand
  .command('unlink')
  .description('撤销 zhin dev link，恢复 package.json / pnpm-lock.yaml 并重新安装注册表版本')
  .option('--project <dir>', '目标项目目录', '.')
  .option('--no-install', '只恢复清单，不执行 pnpm install')
  .option('--force', 'link 之后 package.json 被改动时仍然恢复（丢弃这些改动）')
  .action((options: { project: string; install: boolean; force?: boolean }) => {
    run(() => {
      devUnlink(path.resolve(options.project), { noInstall: !options.install, force: options.force });
    });
  });
