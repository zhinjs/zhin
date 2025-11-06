/**
 * @zhin.js/dependency 热重载演示
 * 
 * 这个示例展示如何使用 chokidar 监听文件变化并实现热重载
 */

import { Dependency } from '@zhin.js/dependency';
import { resolve } from 'path';
import chokidar from 'chokidar';

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m'
};

function log(color: keyof typeof colors, message: string) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  log('bright', '\n' + '='.repeat(60));
  log('cyan', '🔥 @zhin.js/dependency 热重载演示');
  log('bright', '='.repeat(60) + '\n');
  const pluginPath=resolve(import.meta.dirname,'plugins', 'hot-reload-plugin');
  // 创建根依赖
  const root = new Dependency(pluginPath);
  
  // 监听的文件映射
  const watchedFiles = new Map<string, Dependency>();
  
  // 创建文件监听器
  const watcher = chokidar.watch([], {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  });
  
  // 监听 started 事件，动态收集文件
  root.on('started', (dep: Dependency) => {
    watchedFiles.set(dep.filePath, dep);
    watcher.add(dep.filePath);
    log('green', `  → 添加到监听: ${dep.name}`);
  });
  
  // 监听 before-stop 事件，移除文件监听
  root.on("before-stop", (dep: Dependency) => {
    watchedFiles.delete(dep.filePath);
    watcher.unwatch(dep.filePath);
    log('yellow', `  → 移除监听: ${dep.name}`);
  });
  
  const getMemoryUsage = () => {
    const memoryUsage = process.memoryUsage();
    return {
      rss: `实际内存:${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB`,
      heapTotal: `堆内存:${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      heapUsed: `已使用内存:${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
    };
  };
  
  // 监听 reloaded 事件
  root.on('reloaded', (dep: Dependency) => {
    log('green', `✅ 热重载完成: ${dep.name}`);
    watchedFiles.set(dep.filePath, dep);
  });
  
  // 监听错误事件
  root.on('error', (dep: Dependency, error: Error) => {
    log('red', `❌ 错误 [${dep.name}]: ${error.message}`);
  });
  await root.start();
  console.log(root.printTree('', true, true));
  // 监听文件变化
  watcher.on('change', async (changedPath: string) => {
    const dep = watchedFiles.get(changedPath);
    if (dep) {
      log('bright', '\n' + '='.repeat(60));
      log('blue', `🔄 检测到文件变化: ${dep.name}`);
      log('bright', '='.repeat(60) + '\n');
      console.time('⏱️  重载耗时');
      
      try {
        const newDep = await dep.reload();
        watchedFiles.set(newDep.filePath, newDep);
        
        log('bright', '\n' + '-'.repeat(60));
        log('green', `✅ 重载成功: ${newDep.name}`);
        console.timeEnd('⏱️  重载耗时');
        
        log('cyan', '\n📊 更新后的依赖树:');
        console.log(root.printTree('', true, true));
        
        log('yellow', '\n💾 内存使用:');
        console.log(getMemoryUsage());
        log('bright', '-'.repeat(60) + '\n');
      } catch (error) {
        log('red', `❌ 重载失败: ${error instanceof Error ? error.message : error}`);
        console.timeEnd('⏱️  重载耗时');
      }
    }
  });
  
  // 保持进程运行
  process.on('SIGINT', async () => {
    log('yellow', '\n\n🛑 正在停止...');
    await watcher.close();
    await root.stop();
    log('green', '✅ 已停止\n');
    process.exit(0);
  });
  return async ()=>{
    await root.stop();
    await watcher.close();
  }
}
const start=async()=>{
  try{
    return await main();
  }catch(error){
    console.error('\n❌ 发生错误:', error);
    process.exit(1);
    return null;
  }
}
const stop=await start();
const restart=async()=>{
  await stop?.();
  return await start();
}