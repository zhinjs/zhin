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
  
  // 创建根依赖
  const pluginPath = resolve(process.cwd(), 'plugins', 'hot-reload-plugin.ts');
  let root = new Dependency(pluginPath);
  
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
  
  log('yellow', '📝 设置文件监听器...\n');
  
  // 监听 afterStart 事件，动态收集文件
  root.on('started', (dep: Dependency) => {
    console.log('dep start',dep.filePath);
    watchedFiles.set(dep.filePath, dep);
    watcher.add(dep.filePath);
    log('green', `✅ 开始监听: ${dep.name} (${dep.filePath})`);
  });
  root.on("stopped",(dep:Dependency)=>{
    console.log('dep stop',dep.filePath);
    watchedFiles.delete(dep.filePath);
    watcher.unwatch(dep.filePath);
    log('red', `❌ 停止监听: ${dep.name} (${dep.filePath})`);
  })
  
  // 监听 after-reload 事件
  root.on('reloaded', (dep: Dependency) => {
    log('green', `✅ 热重载完成: ${dep.name}`);
    // 更新文件映射
    watchedFiles.set(dep.filePath, dep);
  });
  
  // 监听错误事件
  root.on('error', (dep: Dependency, error: Error) => {
    log('red', `❌ 错误 [${dep.name}]: ${error.message}`);
  });
  await root.start();
  
  // 监听文件变化
  watcher.on('change', async (changedPath: string) => {
    const dep = watchedFiles.get(changedPath);
    if (dep) {
      log('blue', `🔄 重载插件: ${dep.name}`);
      console.time('⏱️  重载耗时');
      
      try {
        const newDep = await dep.reload();
        // if(root.filePath===dep.filePath) root=newDep;
        watchedFiles.set(newDep.filePath, newDep);
        log('green', `✅ 重载成功: ${newDep.name}`);
        console.timeEnd('⏱️  重载耗时');
        console.log(root.printTree('', true, true));
      } catch (error) {
        log('red', `❌ 重载失败: ${error instanceof Error ? error.message : error}`);
        console.timeEnd('⏱️  重载耗时');
      }
      
      log('yellow', '\n💡 继续监听文件变化...\n');
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
}

// 运行演示
main().catch(error => {
  console.error('\n❌ 发生错误:', error);
  process.exit(1);
});

