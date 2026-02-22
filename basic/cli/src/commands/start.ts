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
  .option('--bun', '使用 bun 运行（默认使用 tsx）', false)
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
      
      // 新架构: 始终使用 import('zhin.js/setup') 方式启动
      // 不再依赖 lib/index.js 入口文件
      const useEval = true;
      
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
        
        // 选择运行时和参数
        const runtime = options.bun ? 'bun' : 'tsx';
        // 使用 -e 参数启动 zhin.js/setup
        const args = options.bun 
          ? ['-e', "import('zhin.js/setup')"]
          : ['--expose-gc', '-e', "import('zhin.js/setup')"];
        logger.info(`📦 启动命令: ${runtime} -e "import('zhin.js/setup')"`);
        return startProcess(runtime, args, {
          cwd,
          env,
          stdio,
          detached: options.daemon,
        });
      };
      
      let child = await startBot();
      let isRestarting = false;
      let restartCount = 0;
      let restartTimestamps: number[] = [];
      const MAX_RESTARTS_PER_MINUTE = 10;
      const RESTART_DELAY = 3000; // 3秒延迟
      
      // 重启函数（带防风暴保护）
      const restartBot = async () => {
        if (isRestarting) return;
        isRestarting = true;
        
        // 检查重启频率
        const now = Date.now();
        restartTimestamps = restartTimestamps.filter(t => now - t < 60000); // 保留最近1分钟的记录
        
        if (restartTimestamps.length >= MAX_RESTARTS_PER_MINUTE) {
          logger.error(`❌ 重启过于频繁（1分钟内重启 ${MAX_RESTARTS_PER_MINUTE} 次），停止自动重启`);
          logger.error('💡 请检查日志排查问题后手动重启');
          process.exit(1);
        }
        
        restartTimestamps.push(now);
        restartCount++;
        
        logger.info(`🔄 正在重启机器人... (第 ${restartCount} 次)`);
        
        // 优雅关闭当前进程
        if (child && !child.killed) {
          const oldChild = child;
          oldChild.kill('SIGTERM');
          
          // 等待5秒，如果还没关闭则强制杀掉
          await new Promise(resolve => {
            const timeout = setTimeout(() => {
              if (oldChild && !oldChild.killed) {
                logger.warn('⚠️  进程未响应 SIGTERM，强制终止');
                oldChild.kill('SIGKILL');
              }
              resolve(null);
            }, 5000);
            
            oldChild.once('exit', () => {
              clearTimeout(timeout);
              resolve(null);
            });
          });
        }
        
        // 延迟后重启
        await new Promise(resolve => setTimeout(resolve, RESTART_DELAY));
        
        child = await startBot();
        setupChildHandlers(child);
        isRestarting = false;
      };
      
      // 设置子进程处理器
      const setupChildHandlers = (childProcess: ChildProcess) => {
        if (options.daemon) {
          // 后台运行 - 父进程作为守护进程监督子进程
          childProcess.on('error', (error) => {
            logger.error(`❌ 子进程启动失败: ${error.message}`);
            if (!isRestarting) {
              restartBot();
            }
          });
          
          childProcess.on('exit', async (code, signal) => {
            if (isRestarting) return;
            
            if (code === 51) {
              // 主动重启信号
              logger.info('🔄 收到重启信号 (exit code 51)');
              await restartBot();
            } else if (code !== 0 || signal) {
              // 异常退出，自动重启
              logger.error(`💀 子进程异常退出 (code: ${code}, signal: ${signal})`);
              await restartBot();
            } else {
              // 正常退出，不重启
              logger.info('✅ 机器人已正常退出');
              cleanup();
              process.exit(0);
            }
          });
          
          logger.info(`✅ 机器人已在后台启动 (守护进程PID: ${process.pid}, 子进程PID: ${childProcess.pid})`);
          
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
      
      let killing = false;
      
      // 清理函数
      const cleanup = () => {
        if (killing) return;
        killing = true;
        
        logger.info('🛑 正在关闭机器人...');
        
        if (child && !child.killed) {
          child.kill('SIGTERM');
          
          setTimeout(() => {
            if (child && !child.killed) {
              logger.warn('⚠️  进程未响应，强制终止');
              child.kill('SIGKILL');
            }
            killing = false;
          }, 5000);
        }
        
        // 清理PID文件
        const pidFile = path.join(cwd, '.zhin.pid');
        if (fs.existsSync(pidFile)) {
          fs.removeSync(pidFile);
        }
      };
      
      // 处理退出信号
      process.on('SIGINT', () => {
        if (!options.daemon) cleanup();
      });
      
      process.on('SIGTERM', () => {
        cleanup();
        process.exit(0);
      });
      
      // daemon 模式：写入 PID 文件并保持父进程运行
      if (options.daemon) {
        const pidFile = path.join(cwd, '.zhin.pid');
        fs.writeFileSync(pidFile, process.pid.toString());
        logger.info(`📝 守护进程 PID 已写入: ${pidFile}`);
        logger.info('💡 停止机器人: pnpm stop 或 kill -TERM ' + process.pid);
        logger.info('💡 重启机器人: pnpm restart 或在插件中调用 process.exit(51)');
        
        // 父进程保持运行，监督子进程
        // 不退出，让事件循环继续
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