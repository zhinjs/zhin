import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

export const buildCommand = new Command('build')
  .description('构建机器人项目')
  .option('--clean', '清理输出目录', false)
  .action(async (options: { clean: boolean }) => {
    try {
      const cwd = process.cwd();
      
      // 检查是否是Zhin项目
      if (!isZhinProject(cwd)) {
        logger.error('当前目录不是Zhin项目');
        process.exit(1);
      }
      
      const distPath = path.join(cwd, 'dist');
      
      // 清理输出目录
      if (options.clean && fs.existsSync(distPath)) {
        logger.info('正在清理输出目录...');
        await fs.remove(distPath);
      }
      
      logger.info('正在构建项目...');
      
      // 使用TypeScript编译
      const child = spawn('npx', ['tsc','--project','tsconfig.json'], {
        cwd,
        stdio: 'inherit',
        shell:true,
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          logger.info('构建完成！');
        } else {
          logger.error(`构建失败，退出码: ${code}`);
          process.exit(1);
        }
      });
      
      child.on('error', (error) => {
        logger.error(`构建失败: ${error.message}`);
        process.exit(1);
      });
      
    } catch (error) {
      logger.error(`构建失败: ${error}`);
      process.exit(1);
    }
  });

function isZhinProject(cwd: string): boolean {
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }
  
  try {
    const packageJson = fs.readJsonSync(packageJsonPath);
    return packageJson.dependencies && packageJson.dependencies['zhin.js'];
  } catch {
    return false;
  }
} 