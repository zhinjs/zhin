import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

export const buildCommand = new Command('build')
  .description('构建插件项目')
  .argument('[plugin]', '插件名称（默认构建所有插件）')
  .option('--clean', '清理输出目录', false)
  .option('--production', '生产构建（启用 Tree Shaking）', true)
  .option('--analyze', '分析包体积', false)
  .action(async (pluginName: string | undefined, options: { clean: boolean; production: boolean; analyze: boolean }) => {
    try {
      const cwd = process.cwd();
      
      // 检查是否是 workspace 项目
      if (!isWorkspaceProject(cwd)) {
        logger.error('当前目录不是 Zhin workspace 项目');
        process.exit(1);
      }
      
      const pluginsDir = path.join(cwd, 'plugins');
      
      if (!fs.existsSync(pluginsDir)) {
        logger.error('未找到 plugins 目录');
        process.exit(1);
      }
      
      // 如果指定了插件名称
      if (pluginName) {
        const pluginPath = path.join(pluginsDir, pluginName);
        
        if (!fs.existsSync(pluginPath)) {
          logger.error(`未找到插件: ${pluginName}`);
          process.exit(1);
        }
        
        await buildPlugin(pluginPath, pluginName, options);
      } else {
        // 构建所有插件
        const plugins = await fs.readdir(pluginsDir);
        const validPlugins = plugins.filter(p => {
          const pluginPath = path.join(pluginsDir, p);
          const stat = fs.statSync(pluginPath);
          return stat.isDirectory() && fs.existsSync(path.join(pluginPath, 'package.json'));
        });
        
        if (validPlugins.length === 0) {
          logger.warn('未找到任何插件');
          return;
        }
        
        logger.info(`找到 ${validPlugins.length} 个插件，开始构建...`);
        
        for (const plugin of validPlugins) {
          const pluginPath = path.join(pluginsDir, plugin);
          await buildPlugin(pluginPath, plugin, options);
        }
      }
      
    } catch (error) {
      logger.error(`构建失败: ${error}`);
      process.exit(1);
    }
  });

async function buildPlugin(pluginPath: string, pluginName: string, options: { clean: boolean; production: boolean; analyze: boolean }): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info(`正在构建插件: ${pluginName}...`);
    
    // 清理输出目录
    if (options.clean) {
      const libPath = path.join(pluginPath, 'lib');
      const distPath = path.join(pluginPath, 'dist');
      
      if (fs.existsSync(libPath)) {
        fs.removeSync(libPath);
        logger.info(`✓ 已清理 ${pluginName}/lib`);
      }
      
      if (fs.existsSync(distPath)) {
        fs.removeSync(distPath);
        logger.info(`✓ 已清理 ${pluginName}/dist`);
      }
    }
    
    // 设置环境变量
    const env = {
      ...process.env,
      NODE_ENV: options.production ? 'production' : 'development',
    };
    
    if (options.production) {
      logger.info(`📦 生产构建模式 (启用 Tree Shaking)`);
    }
    
    // 使用 pnpm build 构建插件
    const child = spawn('pnpm', ['build'], {
      cwd: pluginPath,
      stdio: 'inherit',
      shell: true,
      env,
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        logger.success(`✓ ${pluginName} 构建完成`);
        resolve();
      } else {
        logger.error(`✗ ${pluginName} 构建失败，退出码: ${code}`);
        reject(new Error(`Build failed with code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      logger.error(`✗ ${pluginName} 构建失败: ${error.message}`);
      reject(error);
    });
  });
}

function isWorkspaceProject(cwd: string): boolean {
  const workspaceYamlPath = path.join(cwd, 'pnpm-workspace.yaml');
  const packageJsonPath = path.join(cwd, 'package.json');
  
  if (!fs.existsSync(workspaceYamlPath) || !fs.existsSync(packageJsonPath)) {
    return false;
  }
  
  try {
    const packageJson = fs.readJsonSync(packageJsonPath);
    return packageJson.dependencies && packageJson.dependencies['zhin.js'];
  } catch {
    return false;
  }
} 