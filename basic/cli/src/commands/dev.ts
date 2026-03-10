import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { loadEnvFiles } from '../utils/env.js';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

export const devCommand = new Command('dev')
  .option('-p, --port [port]', 'HMR服务端口', '3000')
  .option('--verbose', '显示详细日志', false)
  .option('--bun', '使用 bun 运行（默认使用 tsx）', false)
  .action(async (options: { port: string; verbose: boolean; bun: boolean }) => {
    try {
      const cwd = process.cwd();

      // 检查是否是Zhin项目
      if (!isZhinProject(cwd)) {
        logger.error('❌ 当前目录不是Zhin项目');
        logger.info('💡 请在Zhin项目根目录运行此命令，或使用 "zhin new <project-name>" 创建新项目');
        process.exit(1);
      }

      // 检查依赖是否完整
      const nodeModulesPath = path.join(cwd, 'node_modules');
      if (!fs.existsSync(nodeModulesPath)) {
        logger.error('❌ 依赖未安装或不完整');
        logger.info('💡 请运行以下命令以安装依赖：');
        logger.info('   pnpm install');
        process.exit(1);
      }

      loadEnvFiles(cwd, 'development');

      // 检查src目录是否存在，不存在则创建
      const srcPath = path.join(cwd, 'src');
      if (!fs.existsSync(srcPath)) {
        fs.mkdirSync(srcPath, { recursive: true });
      }

      // 检查入口文件是否存在，决定启动方式
      const entryFile = path.join(srcPath, 'index.ts');
      const hasEntryFile = fs.existsSync(entryFile);

      // 启动机器人的函数
      const startBot = (): ChildProcess => {
        // 设置环境变量
        const env = {
          ...process.env,
          NODE_ENV: 'development',
          ZHIN_DEV_MODE: 'true',
          ZHIN_HMR_PORT: options.port,
          ZHIN_VERBOSE: options.verbose ? 'true' : 'false',
          // 添加 development 条件，让 Node.js 优先加载 package.json 中的 development 字段
          NODE_OPTIONS: (process.env.NODE_OPTIONS || '') + ' --conditions=development'
        };
        
        // 选择运行时和参数
        const runtime = options.bun ? 'bun' : 'node';
        let args: string[];
        
        if (hasEntryFile) {
          // 有入口文件，直接运行
          args = options.bun 
            ? ['src/index.ts'] 
            : ['--import', 'tsx/esm','src/index.ts'];
        } else {
          args = options.bun 
            ? ['-e', "import('zhin.js/setup')"]
            : ['--import', 'tsx/esm','-e', "import('zhin.js/setup')"];
        }
        
        // 启动机器人
        return spawn(runtime, args, {
          cwd,
          stdio: 'inherit',
          env,
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

      logger.info('📦 开发模式运行中 (Ctrl+C 退出, process.exit(51) 重启)');

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