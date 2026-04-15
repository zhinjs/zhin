import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'node:child_process';

interface PublishOptions {
  tag?: string;
  access?: 'public' | 'restricted';
  registry?: string;
  dryRun?: boolean;
  skipBuild?: boolean;
}

export const pubCommand = new Command('pub')
  .description('发布插件到 npm')
  .argument('[plugin-name]', '插件名称（如: my-plugin）')
  .option('--tag <tag>', '发布标签', 'latest')
  .option('--access <access>', '访问级别 (public|restricted)', 'public')
  .option('--registry <url>', '自定义 npm registry')
  .option('--dry-run', '试运行，不实际发布', false)
  .option('--skip-build', '跳过构建步骤', false)
  .action(async (pluginName: string, options: PublishOptions) => {
    try {
      const pluginsDir = path.resolve(process.cwd(), 'plugins');
      
      // 检查 plugins 目录是否存在
      if (!fs.existsSync(pluginsDir)) {
        logger.error('未找到 plugins 目录，请在项目根目录运行此命令');
        process.exit(1);
      }

      // 获取所有插件
      const availablePlugins = fs.readdirSync(pluginsDir)
        .filter(name => {
          const pluginPath = path.join(pluginsDir, name);
          return fs.statSync(pluginPath).isDirectory() && 
                 fs.existsSync(path.join(pluginPath, 'package.json'));
        });

      if (availablePlugins.length === 0) {
        logger.error('未找到可发布的插件');
        process.exit(1);
      }

      // 如果没有指定插件名，让用户选择
      let selectedPlugin = pluginName;
      if (!selectedPlugin) {
        if (availablePlugins.length === 1) {
          selectedPlugin = availablePlugins[0];
          logger.info(`自动选择插件: ${selectedPlugin}`);
        } else {
          const { plugin } = await inquirer.prompt([
            {
              type: 'list',
              name: 'plugin',
              message: '请选择要发布的插件:',
              choices: availablePlugins
            }
          ]);
          selectedPlugin = plugin;
        }
      }

      // 验证插件是否存在
      const pluginDir = path.join(pluginsDir, selectedPlugin);
      if (!fs.existsSync(pluginDir)) {
        logger.error(`插件不存在: ${selectedPlugin}`);
        logger.log(`可用插件: ${availablePlugins.join(', ')}`);
        process.exit(1);
      }

      const packageJsonPath = path.join(pluginDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        logger.error(`未找到 package.json: ${packageJsonPath}`);
        process.exit(1);
      }

      // 读取 package.json
      const packageJson = await fs.readJson(packageJsonPath);
      const packageName = packageJson.name;
      const version = packageJson.version;

      logger.info(`准备发布插件: ${packageName}@${version}`);
      logger.log('');

      // 确认发布
      if (!options.dryRun) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `确认发布 ${packageName}@${version} 到 npm？`,
            default: false
          }
        ]);

        if (!confirm) {
          logger.warn('已取消发布');
          process.exit(0);
        }
      }

      // 构建插件
      if (!options.skipBuild) {
        logger.info('正在构建插件...');
        try {
          execSync('pnpm build', {
            cwd: pluginDir,
            stdio: 'inherit'
          });
          logger.success('✓ 构建完成');
        } catch (error) {
          logger.error('构建失败');
          throw error;
        }
      }

      // 构建 npm publish 命令
      const publishArgs = ['publish'];
      
      if (options.access) {
        publishArgs.push('--access', options.access);
      }
      
      if (options.tag) {
        publishArgs.push('--tag', options.tag);
      }
      
      if (options.registry) {
        publishArgs.push('--registry', options.registry);
      }
      
      if (options.dryRun) {
        publishArgs.push('--dry-run');
      }

      // 总是添加 --no-git-checks（因为 plugins 可能不是 git 根目录）
      publishArgs.push('--no-git-checks');

      // 发布插件
      logger.info(`正在发布${options.dryRun ? '（试运行）' : ''}...`);
      logger.log(`命令: pnpm ${publishArgs.join(' ')}`);
      logger.log('');

      try {
        execSync(`pnpm ${publishArgs.join(' ')}`, {
          cwd: pluginDir,
          stdio: 'inherit'
        });

        if (options.dryRun) {
          logger.success('✓ 试运行完成');
          logger.log('');
          logger.log('💡 提示: 移除 --dry-run 参数以实际发布');
        } else {
          logger.success(`✓ ${packageName}@${version} 发布成功！`);
          logger.log('');
          logger.log('📦 安装命令:');
          logger.log(`  pnpm add ${packageName}`);
          logger.log('');
          logger.log('🔗 npm 链接:');
          logger.log(`  https://www.npmjs.com/package/${packageName}`);
        }
      } catch (error) {
        logger.error('发布失败');
        throw error;
      }

    } catch (error: any) {
      logger.error(`发布失败: ${error.message}`);
      process.exit(1);
    }
  });

