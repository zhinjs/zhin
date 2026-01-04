import { usePlugin, MessageCommand } from 'zhin.js';
import * as path from 'path';
import { writeHeapSnapshot } from 'v8';

const plugin = usePlugin();
const { addCommand } = plugin;


// 分析内存使用
function analyzeMemoryBreakdown() {
  const mem = process.memoryUsage();
  const breakdown: string[] = [];
  
  breakdown.push('【内存详细组成】');
  breakdown.push(`  堆内存总计: ${formatBytes(mem.heapTotal)}`);
  breakdown.push(`  堆内存使用: ${formatBytes(mem.heapUsed)}`);
  breakdown.push(`  外部内存: ${formatBytes(mem.external)}`);
  breakdown.push(`  ArrayBuffer: ${formatBytes(mem.arrayBuffers)}`);
  breakdown.push(`  物理内存 (RSS): ${formatBytes(mem.rss)}`);
  breakdown.push('');
  
  // 检查全局对象
  breakdown.push('【全局对象检查】');
  
  // 检查 require.cache 大小
  const requireCacheSize = Object.keys(require.cache || {}).length;
  breakdown.push(`  require.cache 模块数: ${requireCacheSize}`);
  
  // 检查 global 对象上的大对象
  const globalKeys = Object.keys(global);
  breakdown.push(`  global 对象属性数: ${globalKeys.length}`);
  
  // 检查是否有大对象
  let largeObjects: Array<{ name: string; size: number }> = [];
  
  // 检查 process 对象
  try {
    const processSize = JSON.stringify(process.env).length;
    if (processSize > 10000) {
      largeObjects.push({ name: 'process.env', size: processSize });
    }
  } catch (e) {
    // 忽略
  }
  
  if (largeObjects.length > 0) {
    breakdown.push('  发现大对象:');
    largeObjects.forEach(obj => {
      breakdown.push(`    - ${obj.name}: ${formatBytes(obj.size)}`);
    });
  }
  
  breakdown.push('');
  
  // 检查 V8 堆统计
  if (global.gc) {
    breakdown.push('【建议】');
    breakdown.push('  可以运行 global.gc() 强制垃圾回收');
    breakdown.push('  然后再次检查内存使用');
  }
  
  return breakdown;
}

// 检查可能的内存泄漏点
function checkMemoryLeaks() {
  const issues: string[] = [];
  
  // 1. 检查 require.cache
  const cacheSize = Object.keys(require.cache || {}).length;
  if (cacheSize > 200) {
    issues.push(`⚠️  require.cache 过大: ${cacheSize} 个模块`);
    issues.push(`   建议: 检查是否有模块重复加载`);
  }
  
  // 2. 检查事件监听器
  const emitterCount = process.listenerCount('uncaughtException') + 
                       process.listenerCount('unhandledRejection');
  if (emitterCount > 10) {
    issues.push(`⚠️  事件监听器过多: ${emitterCount} 个`);
    issues.push(`   建议: 检查是否有监听器未移除`);
  }
  
  // 3. 检查定时器
  // 无法直接检查，但可以提示用户
  
  return issues;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 内存分析命令
addCommand(
  new MessageCommand('mem-debug')
    .desc('内存调试分析', '详细分析内存使用，查找可能的泄漏点')
    .usage('mem-debug')
    .action(() => {
      const mem = process.memoryUsage();
      const analysis = analyzeMemoryBreakdown();
      const leaks = checkMemoryLeaks();
      
      return [
        '╔═══════════ 内存调试分析 ═══════════╗',
        '',
        ...analysis,
        '',
        '【潜在问题检查】',
        leaks.length > 0 ? leaks.join('\n') : '  ✅ 未发现明显问题',
        '',
        '【建议操作】',
        '  1. 运行 heap 命令生成堆快照',
        '  2. 使用 Chrome DevTools 分析快照',
        '  3. 检查是否有大量重复对象',
        '  4. 检查是否有未清理的监听器',
        '  5. 对比不同时间点的堆快照',
        '',
        '💡 evalCache 已添加 LRU 限制（最大 1000 条）',
        '   如果之前缓存很大，重启后应该会改善',
        '',
        '╚═════════════════════════════════════╝'
      ].join('\n');
    })
);

// 强制 GC 命令（仅开发环境）
addCommand(
  new MessageCommand('gc')
    .desc('强制垃圾回收', '触发 V8 垃圾回收（需要 --expose-gc 标志）')
    .usage('gc')
    .action(() => {
      if (!global.gc) {
        return [
          '❌ 垃圾回收不可用',
          '',
          '启动时需要添加 --expose-gc 标志：',
          '  node --expose-gc index.js',
          '',
          '或者使用环境变量：',
          '  NODE_OPTIONS="--expose-gc" node index.js'
        ].join('\n');
      }
      
      const before = process.memoryUsage();
      global.gc();
      const after = process.memoryUsage();
      
      const heapFreed = before.heapUsed - after.heapUsed;
      const heapPercent = ((heapFreed / before.heapUsed) * 100).toFixed(2);
      
      return [
        '✅ 垃圾回收完成',
        '',
        '【回收前】',
        `  堆内存: ${formatBytes(before.heapUsed)}`,
        `  堆总计: ${formatBytes(before.heapTotal)}`,
        '',
        '【回收后】',
        `  堆内存: ${formatBytes(after.heapUsed)}`,
        `  堆总计: ${formatBytes(after.heapTotal)}`,
        '',
        '【释放】',
        `  堆内存: ${formatBytes(heapFreed)} (${heapPercent}%)`,
        `  堆总计: ${formatBytes(before.heapTotal - after.heapTotal)}`,
        '',
        '💡 如果释放很少，说明内存确实在使用中',
        '   如果释放很多，说明之前有未回收的垃圾'
      ].join('\n');
    })
);

// 注意：evalCache 相关功能暂时移除，因为需要先导出这些方法

// 检查模块缓存命令
addCommand(
  new MessageCommand('modules')
    .desc('检查模块缓存', '查看 require.cache 中的模块数量')
    .usage('modules')
    .action(() => {
      const cache = require.cache || {};
      const modules = Object.keys(cache);
      
      // 按路径分组
      const byPath = new Map<string, number>();
      modules.forEach(key => {
        const mod = cache[key];
        if (mod && mod.filename) {
          const dir = path.dirname(mod.filename);
          byPath.set(dir, (byPath.get(dir) || 0) + 1);
        }
      });
      
      // 统计
      const stats = Array.from(byPath.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
      
      return [
        '╔═══════════ 模块缓存统计 ═══════════╗',
        '',
        `总模块数: ${modules.length}`,
        '',
        '【按目录分组 (Top 20)】',
        ...stats.map(([dir, count]) => 
          `  ${count.toString().padStart(4)} 个 - ${dir}`
        ),
        '',
        '💡 如果某个目录模块数异常多，可能存在重复加载',
        '',
        '╚═════════════════════════════════════╝'
      ].join('\n');
    })
);

