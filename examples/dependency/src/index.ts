/**
 * @zhin.js/dependency 热重载演示
 * 
 * 这个示例展示如何使用 chokidar 监听文件变化并实现热重载
 */

import { Dependency, onDispose, onMount, useDependency } from '@zhin.js/dependency';
import { watch } from 'chokidar';
import './plugins/logger-plugin.js';
import './plugins/timer-plugin.js';
import './plugins/parent-plugin.js';

const root = useDependency();
// console.log(root.name)
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

// 监听的文件映射
const watchedFiles = new Map<string, Dependency>()
const getMemoryUsage = () => {
  const memoryUsage = process.memoryUsage();
  return {
    rss: `实际内存:${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB`,
    heapTotal: `堆内存:${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
    heapUsed: `已使用内存:${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
  }
}
const showMemoryUsage = () => {
  log('yellow', '\n💾 内存使用:');
  console.log(getMemoryUsage());
}
// 创建文件监听器
const watcher = watch([], {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 300,
    pollInterval: 100
  }
})

// 监听 mounted 事件，动态收集文件
root.on('mounted', (dep: Dependency) => {
  watchedFiles.set(dep.filePath, dep);
  watcher.add(dep.filePath);
});

// 监听 before-dispose 事件，移除文件监听
root.on("before-dispose", (dep: Dependency) => {
  watchedFiles.delete(dep.filePath);
  watcher.unwatch(dep.filePath);
});


// 监听 disposed 事件
root.on('reloaded', (dep: Dependency) => {
  log('green', `✅ 热重载完成: ${dep.name}`);
  watchedFiles.set(dep.filePath, dep);
});

// 监听错误事件
root.on('error', (dep: Dependency, error: Error) => {
  log('red', `❌ 错误 [${dep.name}]: ${error.message}`);
});
onMount(()=>{
  showMemoryUsage();
});
// 监听文件变化
watcher.on('change', async (changedPath: string) => {
  const dep = watchedFiles.get(changedPath);
  if (dep) {
    try {
      const newDep = await dep.reload();
      watchedFiles.set(newDep.filePath, newDep);
    } catch (error) {
      log('red', `❌ 重载失败: ${error instanceof Error ? error.message : error}`);
    }
  }
})
onDispose(async () => {
  watcher.unwatch([...watchedFiles.keys()])
  watchedFiles.clear();
  await watcher.close()
  log('yellow', '🛑 entry point disposed')
})
await root.start();
// 保持进程运行
process.on('SIGINT', async () => {
  log('yellow', '\n\n🛑 正在停止...');
  await root.stop();
  log('green', '✅ 已停止\n');
  process.exit(0);
});