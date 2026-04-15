import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execFileSync } from 'node:child_process';

interface InstallOptions {
  save?: boolean;
  saveDev?: boolean;
  global?: boolean;
}

/**
 * 安装插件的核心逻辑
 */
async function installPluginAction(plugin: string, options: InstallOptions) {
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
    const installArgs = buildInstallArgs(pluginToInstall, pluginType, options);
    
    logger.log(`执行命令: pnpm ${installArgs.join(' ')}`);
    logger.log('');

    // 执行安装（使用 execFileSync 防止 shell 注入）
    try {
      execFileSync('pnpm', installArgs, {
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
}

export const installCommand = new Command('install')
  .description('安装插件（npm 包或 git 仓库）')
  .argument('[plugin]', '插件名称或 git 地址')
  .option('-S, --save', '安装到 dependencies（默认）', true)
  .option('-D, --save-dev', '安装到 devDependencies', false)
  .option('-g, --global', '全局安装', false)
  .action(installPluginAction);

// 别名命令
export const addCommand = new Command('add')
  .description('安装插件（install 的别名）')
  .argument('[plugin]', '插件名称或 git 地址')
  .option('-S, --save', '安装到 dependencies（默认）', true)
  .option('-D, --save-dev', '安装到 devDependencies', false)
  .option('-g, --global', '全局安装', false)
  .action(installPluginAction);

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
 * 检查是否在 workspace root
 */
function isWorkspaceRoot(): boolean {
  try {
    const cwd = process.cwd();
    const pkgJsonPath = path.join(cwd, 'package.json');
    const workspacePath = path.join(cwd, 'pnpm-workspace.yaml');
    
    // 检查是否存在 pnpm-workspace.yaml
    if (!fs.existsSync(workspacePath)) {
      return false;
    }
    
    // 检查 package.json 是否存在
    if (!fs.existsSync(pkgJsonPath)) {
      return false;
    }
    
    const pkgJson = fs.readJsonSync(pkgJsonPath);
    
    // 如果 package.json 有 workspaces 字段或者存在 pnpm-workspace.yaml，
    // 并且 package.json 中没有明确表示这是一个子包（没有 workspace:* 依赖），
    // 则认为当前在 workspace root
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 构建安装命令参数数组（不包含 pnpm 本身）
 */
function buildInstallArgs(plugin: string, type: string, options: InstallOptions): string[] {
  const parts = ['add'];

  // 添加保存选项
  if (options.saveDev) {
    parts.push('-D');
  }

  if (options.global) {
    parts.push('-g');
  } else if (isWorkspaceRoot()) {
    // 如果在 workspace root 且不是全局安装，添加 -w 标志
    parts.push('-w');
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

  return parts;
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

