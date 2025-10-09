import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { loadEnvFiles } from '../utils/env.js';
import { ChildProcess } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { startProcess } from '../utils/process.js';

export const startCommand = new Command('start')
  .description('生产模式启动机器人')
  .option('-d, --daemon', '后台运行', false)
  .option('--log-file [file]', '日志文件路径')
  .option('--bun', '使用 bun 运行（默认使用 node）', false)
  .action(async (options: { daemon: boolean; logFile?: string; bun: boolean }) => {
    try {
      const cwd = process.cwd();
      
      // 检查是否是Zhin项目
      if (!isZhinProject(cwd)) {
        logger.error('当前目录不是Zhin项目');
        logger.info('请在Zhin项目根目录运行此命令');
        process.exit(1);
      }
      
      // 加载环境变量文件
      logger.info('🔍 正在加载环境变量...');
      loadEnvFiles(cwd, 'production');
      
      // 检查构建产物
      const distPath = path.join(cwd, 'dist');
      const sourcePath = path.join(cwd, 'src');
      const sourceFile = path.join(sourcePath, 'index.ts');
      const distFile = path.join(distPath, 'index.js');
      const entryFile = options.bun ? path.relative(cwd,sourceFile) : path.relative(cwd,distFile);
      
      if (!fs.existsSync(entryFile)) {
        logger.error('构建产物不存在，请先运行 zhin build');
        process.exit(1);
      }
      
      logger.info('🚀 正在生产模式启动机器人...');
      
      // 启动机器人的函数
      const startBot = async (): Promise<ChildProcess> => {
        // 设置环境变量
        const env = {
          ...process.env,
          NODE_ENV: 'production'
        };
        
        // 配置stdio
        let stdio: any = 'inherit';
        if (options.daemon) {
          stdio = options.logFile ? 
            ['ignore', fs.openSync(options.logFile, 'a'), fs.openSync(options.logFile, 'a')] :
            'ignore';
        }
        
        // 选择运行时
        const runtime = options.bun ? 'bun' : 'node';
        const args = options.bun ? [entryFile] : ['--expose-gc', entryFile];
        
        logger.info(`📦 启动命令: ${runtime} ${args.join(' ')}`);
        return startProcess(runtime, args, cwd,options.daemon);
      };
      
      let child = await startBot();
      let isRestarting = false;
      
      // 重启函数
      const restartBot =async () => {
        if (isRestarting) return;
        isRestarting = true;
        
        logger.info('🔄 正在重启机器人...');
        
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
        child = await startBot();
        setupChildHandlers(child);
        isRestarting = false;
      };
      
      // 设置子进程处理器
      const setupChildHandlers = (childProcess: ChildProcess) => {
        if (options.daemon) {
          // 后台运行
          childProcess.unref();
          logger.info(`✅ 机器人已在后台启动 (子进程PID: ${childProcess.pid})`);
          
          if (options.logFile) {
            logger.info(`📝 日志输出到: ${options.logFile}`);
          }
        } else {
          // 前台运行
          childProcess.on('error', (error) => {
            if (!isRestarting) {
              logger.error(`❌ 启动失败: ${error.message}`);
              process.exit(1);
            }
          });
          
          childProcess.on('exit', async (code) => {
            if (!isRestarting) {
              if (code === 51) {
                return await restartBot();
              }
              if (code !== 0) {
                logger.error(`💀 进程异常退出，代码: ${code}`);
              } else {
                logger.info('✅ 机器人已正常退出');
              }
              process.exit(code || 0);
            }
          });
        }
      };
      
      // 设置初始子进程处理器
      setupChildHandlers(child);
      
      let killing=false
      // 处理退出信号
      const cleanup = () => {
        if(options.daemon) return process.exit(0)
        if(killing) return
        killing=true
        logger.info('🛑 正在关闭机器人...');
        if (child && !child.killed) {
          child.kill('SIGTERM');
          
          setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL');
              killing=false
            }
          }, 5000);
        }
        
        // 清理PID文件
        const pidFile = path.join(cwd, '.zhin.pid');
        if (fs.existsSync(pidFile)) {
          fs.removeSync(pidFile);
        }
      };
      
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
      
      // 如果是后台运行，保持主进程运行以管理子进程
      if (options.daemon) {
        logger.info('💡 重启方式: 在插件中调用 process.exit(51)');
        logger.info('💡 停止机器人: kill -TERM ' + child.pid);
        process.exit(0)
      } else {
        // 前台运行时也显示重启提示
        logger.info('💡 前台运行模式，按 Ctrl+C 退出');
        logger.info('💡 重启方式: 在插件中调用 process.exit(51)');
      }
    } catch (error) {
      logger.error(`❌ 启动失败: ${error}`);
      process.exit(1);
    }
  });

export const restartCommand = new Command('restart')
  .description('重启生产模式的机器人进程')
  .action(async () => {
    try {
      const cwd = process.cwd();
      const pidFile = path.join(cwd, '.zhin.pid');
      
      // 检查PID文件是否存在
      if (!fs.existsSync(pidFile)) {
        logger.error('未找到运行中的机器人进程');
        logger.info('请先使用 zhin start 启动机器人');
        process.exit(1);
      }
      
      // 读取PID
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
      
      if (isNaN(pid)) {
        logger.error('PID文件格式错误');
        process.exit(1);
      }
      
      try {
        // 检查进程是否存在
        process.kill(pid, 0);
        
        // 发送重启信号
        process.kill(pid, 51);
        logger.info(`🔄 已发送重启信号给进程 ${pid}`);
        
      } catch (error: any) {
        if (error.code === 'ESRCH') {
          logger.error('进程不存在，清理PID文件');
          fs.removeSync(pidFile);
        } else {
          logger.error(`发送信号失败: ${error.message}`);
        }
        process.exit(1);
      }
      
    } catch (error) {
      logger.error(`重启失败: ${error}`);
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