import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';

const pluginCommand = new Command('plugin')
  .description('卸载插件')
  .argument('<name>', '插件名称（npm 包名或 instanceKey）')
  .option('--remove-pkg', '同时从 package.json 中移除依赖')
  .action(async (name: string, options: { removePkg?: boolean }) => {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      logger.error('当前目录不是有效的项目');
      process.exit(1);
    }

    const { PluginManagementWorkflow } = await import('@zhin.js/gateway/plugin-management');
    await new PluginManagementWorkflow(cwd).uninstall(name, undefined, undefined, {removeDependency: options.removePkg === true});
    logger.success(`已移除插件实例 "${name}"${options.removePkg ? '（无其他引用时移除依赖）' : '（保留依赖）'}`);

    // 本地插件目录（./plugins/<name>）：默认不删，确认后删除
    const pluginDir = path.join(cwd, 'plugins', name);
    if (fs.existsSync(pluginDir)) {
      const { confirmDelete } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmDelete',
          message: `是否删除本地插件目录 "${pluginDir}"?`,
          default: false
        }
      ]);

      if (confirmDelete) {
        await fs.remove(pluginDir);
        logger.success(`已删除插件目录 "${name}"`);
      }
    }
  });

const adapterCommand = new Command('adapter')
  .description('卸载适配器')
  .argument('<name>', '适配器名称')
  .option('--remove-pkg', '同时从 package.json 中移除依赖')
  .action(async (name: string, options: { removePkg?: boolean }) => {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      logger.error('当前目录不是有效的项目');
      process.exit(1);
    }

    const { PluginManagementWorkflow } = await import('@zhin.js/gateway/plugin-management');
    const workflow = new PluginManagementWorkflow(cwd);
    const direct = await workflow.inspect(name);
    const target = direct.declared ? name : name.startsWith('@') ? name : `@zhin.js/adapter-${name.replace(/^adapter-/, '')}`;
    await workflow.uninstall(target, undefined, undefined, {removeDependency: options.removePkg === true});
    logger.success(`已移除适配器实例 "${name}"${options.removePkg ? '（无其他引用时移除依赖）' : '（保留依赖）'}`);

  });

export const uninstallCommand = new Command('uninstall')
  .description('卸载插件或适配器（系统服务请用 zhin service uninstall）')
  .addCommand(pluginCommand)
  .addCommand(adapterCommand);
