import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { loadEnvFiles } from '../utils/env.js';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

export const devCommand = new Command('dev')
  .option('-p, --port [port]', 'HMR服务端口', '3000')
  .option('--verbose', '显示详细日志', false)
  .option('--bun', '使用 bun 运行（默认使用 node', false)
  .action(async (options: { port: string; verbose: boolean; bun: boolean }) => {
    try {
      const cwd = process.cwd();

      // 检查是否是Zhin项目
      if (!isZhinProject(cwd)) {
        logger.error('当前目录不是Zhin项目');
        logger.info('请在Zhin项目根目录运行此命令，或使用 zhin init 初始化项目');
        process.exit(1);
      }

      // 加载环境变量文件
      logger.info('🔍 正在加载环境变量...');
      loadEnvFiles(cwd, 'development');

      // 检查src目录是否存在
      const srcPath = path.join(cwd, 'src');
      if (!fs.existsSync(srcPath)) {
        logger.error('src目录不存在');
        logger.info('请确保项目结构正确，src目录包含入口文件');
        process.exit(1);
      }

      // 检查入口文件
      const entryFile = path.join(srcPath, 'index.ts');
      if (!fs.existsSync(entryFile)) {
        logger.error('入口文件 src/index.ts 不存在');
        process.exit(1);
      }

      logger.info('📦 开发模式启动中...');

      // 启动机器人的函数
      const startBot = (): ChildProcess => {
        // 设置环境变量
        const env = {
          ...process.env,
          NODE_ENV: 'development',
          ZHIN_DEV_MODE: 'true',
          ZHIN_HMR_PORT: options.port,
          ZHIN_VERBOSE: options.verbose ? 'true' : 'false'
        };
        
        // 选择运行时
        const runtime = options.bun ? 'bun' : 'tsx';
        const args = options.bun ? ['src/index.ts'] : ['--expose-gc', 'src/index.ts'];
        
        logger.info(`📦 启动命令: ${runtime} ${args.join(' ')}`);
        
        // 启动机器人
        return spawn(runtime, args, {
          cwd,
          stdio: 'inherit',
          env,
          shell:true,
        });
      };

      let child = startBot();
      let isRestarting = false;
      let isKilling = false;

      // 重启函数
      const restartBot = async () => {
        if (isRestarting || isKilling) return;
        isRestarting = true;

        logger.info('🔄 正在重启开发服务器...');

        // 优雅关闭当前进程
        if (child && !child.killed) {
          const oldChild=child
          oldChild.kill('SIGTERM');
          // 如果5秒后还没关闭，强制杀掉
          setTimeout(() => {
            if (oldChild && !oldChild.killed) {
              oldChild.kill('SIGKILL');
            }
          }, 5000);
        }

        child = startBot();
        setupChildHandlers(child);
        isRestarting = false;
      };

      // 设置子进程处理器
      const setupChildHandlers = (childProcess: ChildProcess) => {
        childProcess.on('error', (error) => {
          if (!isRestarting) {
            logger.error(`❌ 启动失败: ${error.message}`);
            // 提供常见问题的解决建议
            if (error.message.includes('ENOENT')) {
              if (options.bun) {
                  logger.info('💡 请确保已安装 bun: https://bun.sh/');
              } else {
                logger.info('💡 请确保已安装 tsx: npm install -D tsx');
              }
            }

            process.exit(1);
          }
        });

        childProcess.on('exit', (code) => {
          if (!isRestarting && !isKilling) {
            if (code === 51) {
              return restartBot();
            }
            if (code !== 0) {
              logger.error(`🔄 进程退出，代码: ${code}`);
            }
          }
        });
      };

      // 设置初始子进程处理器
      setupChildHandlers(child);

      // 保存主进程PID文件（虽然开发模式不提供CLI重启，但保留用于进程管理）
      const pidFile = path.join(cwd, '.zhin-dev.pid');
      fs.writeFileSync(pidFile, process.pid.toString());

      // 处理退出信号
      const cleanup = () => {
        if (isKilling) return;
        logger.info('🛑 正在关闭开发服务器...');
        isKilling = true;

        if (child && !child.killed) {
          child.kill('SIGTERM');
        }

        // 给子进程一些时间优雅退出
        setTimeout(() => {
          if (child && !child.killed) {
            child.kill('SIGKILL');
          }

          // 清理PID文件
          if (fs.existsSync(pidFile)) {
            fs.removeSync(pidFile);
          }

          logger.info('✅ 开发服务器已关闭');
          process.exit(0);
        }, 3000);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // 显示开发模式提示
      logger.info('💡 开发模式运行中，按 Ctrl+C 退出');
      logger.info('💡 重启方式: 在插件中调用 process.exit(51)');

    } catch (error) {
      logger.error(`❌ 开发模式启动失败: ${error}`);
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
    return packageJson.dependencies && (
      packageJson.dependencies['zhin.js'] ||
      packageJson.devDependencies?.['zhin.js']
    );
  } catch {
    return false;
  }
} 