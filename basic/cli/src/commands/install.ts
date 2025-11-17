import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'node:child_process';

interface InstallOptions {
  save?: boolean;
  saveDev?: boolean;
  global?: boolean;
}

export const installCommand = new Command('install')
  .description('安装插件（npm 包或 git 仓库）')
  .argument('[plugin]', '插件名称或 git 地址')
  .option('-S, --save', '安装到 dependencies（默认）', true)
  .option('-D, --save-dev', '安装到 devDependencies', false)
  .option('-g, --global', '全局安装', false)
  .action(async (plugin: string, options: InstallOptions) => {
    try {
      let pluginToInstall = plugin;

      // 如果没有指定插件，交互式输入
      if (!pluginToInstall) {
        const { input } = await inquirer.prompt([
          {
            type: 'input',
            name: 'input',
            message: '请输入插件名称或 git 地址:',
            validate: (input: string) => {
              if (!input.trim()) {
                return '插件名称或地址不能为空';
              }
              return true;
            }
          }
        ]);
        pluginToInstall = input;
      }

      // 判断插件类型
      const pluginType = detectPluginType(pluginToInstall);
      
      logger.info(`检测到插件类型: ${pluginType}`);
      logger.info(`正在安装: ${pluginToInstall}`);
      logger.log('');

      // 构建安装命令
      const installCmd = buildInstallCommand(pluginToInstall, pluginType, options);
      
      logger.log(`执行命令: ${installCmd}`);
      logger.log('');

      // 执行安装
      try {
        execSync(installCmd, {
          cwd: process.cwd(),
          stdio: 'inherit'
        });

        logger.success('✓ 插件安装成功！');
        logger.log('');

        // 如果是 git 插件，提供额外说明
        if (pluginType === 'git') {
          logger.log('📝 Git 插件已安装到 node_modules/');
          logger.log('');
        }

        // 提示如何启用插件
        const pluginName = extractPluginName(pluginToInstall, pluginType);
        if (pluginName) {
          logger.log('🔌 启用插件：');
          logger.log(`在 zhin.config.ts 中添加：`);
          logger.log('');
          logger.log('  export default defineConfig({');
          logger.log('    plugins: [');
          logger.log(`      '${pluginName}'`);
          logger.log('    ]');
          logger.log('  });');
        }

      } catch (error) {
        logger.error('安装失败');
        throw error;
      }

    } catch (error: any) {
      logger.error(`安装插件失败: ${error.message}`);
      process.exit(1);
    }
  });

// 别名命令
export const addCommand = new Command('add')
  .description('安装插件（install 的别名）')
  .argument('[plugin]', '插件名称或 git 地址')
  .option('-S, --save', '安装到 dependencies（默认）', true)
  .option('-D, --save-dev', '安装到 devDependencies', false)
  .option('-g, --global', '全局安装', false)
  .action(async (plugin: string, options: InstallOptions) => {
    await installCommand.parseAsync(['node', 'zhin', 'install', plugin || '', ...buildOptionsArray(options)], { from: 'user' });
  });

/**
 * 检测插件类型
 */
function detectPluginType(plugin: string): 'npm' | 'git' | 'github' | 'gitlab' | 'bitbucket' {
  // Git 协议
  if (plugin.startsWith('git://') || plugin.startsWith('git+')) {
    return 'git';
  }

  // HTTPS/SSH git 地址
  if (plugin.includes('github.com') || plugin.includes('gitlab.com') || plugin.includes('bitbucket.org')) {
    if (plugin.includes('github.com')) return 'github';
    if (plugin.includes('gitlab.com')) return 'gitlab';
    if (plugin.includes('bitbucket.org')) return 'bitbucket';
    return 'git';
  }

  // GitHub 简写 (user/repo)
  if (/^[\w-]+\/[\w-]+$/.test(plugin)) {
    return 'github';
  }

  // 默认为 npm 包
  return 'npm';
}

/**
 * 构建安装命令
 */
function buildInstallCommand(plugin: string, type: string, options: InstallOptions): string {
  const parts = ['pnpm', 'add'];

  // 添加保存选项
  if (options.saveDev) {
    parts.push('-D');
  }

  if (options.global) {
    parts.push('-g');
  }

  // 处理不同类型的插件
  let packageSpec = plugin;

  switch (type) {
    case 'github':
      // 如果是简写形式，转换为完整 GitHub URL
      if (/^[\w-]+\/[\w-]+$/.test(plugin)) {
        packageSpec = `github:${plugin}`;
      } else if (!plugin.startsWith('git+') && !plugin.startsWith('https://')) {
        packageSpec = `git+${plugin}`;
      }
      break;

    case 'gitlab':
      if (!plugin.startsWith('git+') && !plugin.startsWith('https://')) {
        packageSpec = `git+${plugin}`;
      }
      break;

    case 'bitbucket':
      if (!plugin.startsWith('git+') && !plugin.startsWith('https://')) {
        packageSpec = `git+${plugin}`;
      }
      break;

    case 'git':
      // Git URL 直接使用
      break;

    case 'npm':
    default:
      // npm 包名直接使用
      break;
  }

  parts.push(packageSpec);

  return parts.join(' ');
}

/**
 * 提取插件名称
 */
function extractPluginName(plugin: string, type: string): string | null {
  switch (type) {
    case 'npm':
      // npm 包名可能包含 scope 和版本号
      // @scope/package@version -> @scope/package 或 package
      const match = plugin.match(/^(@?[\w-]+\/)?([^@]+)/);
      if (match) {
        const fullName = match[0].replace(/@[\d.]+.*$/, ''); // 移除版本号
        // 如果是 @zhin.js/ 开头的包，提取最后的名称
        if (fullName.startsWith('@zhin.js/')) {
          return fullName.replace('@zhin.js/', '');
        }
        return fullName;
      }
      return plugin;

    case 'github':
    case 'gitlab':
    case 'bitbucket':
      // 从 git URL 中提取仓库名
      const repoMatch = plugin.match(/\/([^/]+?)(\.git)?$/);
      if (repoMatch) {
        return repoMatch[1];
      }
      // 简写形式 user/repo
      if (/^[\w-]+\/([\w-]+)$/.test(plugin)) {
        return plugin.split('/')[1];
      }
      return null;

    case 'git':
      // 从 git URL 中提取仓库名
      const gitMatch = plugin.match(/\/([^/]+?)(\.git)?$/);
      if (gitMatch) {
        return gitMatch[1];
      }
      return null;

    default:
      return null;
  }
}

/**
 * 构建选项数组
 */
function buildOptionsArray(options: InstallOptions): string[] {
  const arr: string[] = [];
  if (options.saveDev) arr.push('-D');
  if (options.global) arr.push('-g');
  return arr;
}

