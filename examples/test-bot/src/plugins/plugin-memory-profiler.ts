import { usePlugin, MessageCommand } from "zhin.js";
import { writeHeapSnapshot } from "node:v8";
import * as path from "node:path";

const plugin = usePlugin();
const { addCommand, root, logger } = plugin;

// 存储插件加载前的内存快照
const memorySnapshots = new Map<string, NodeJS.MemoryUsage>();

/**
 * 格式化内存大小
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * 获取模块大小（估算）
 */
function getModuleSize(modulePath: string): number {
  try {
    const cached = require.cache[modulePath];
    if (!cached) return 0;
    
    // 估算：序列化模块内容的大小
    const moduleStr = JSON.stringify({
      exports: typeof cached.exports,
      children: cached.children?.length || 0,
      filename: cached.filename,
    });
    return Buffer.byteLength(moduleStr, 'utf8');
  } catch {
    return 0;
  }
}

/**
 * 统计插件相关的模块数量和大小
 */
function analyzePluginModules(pluginName: string) {
  const modules = Object.keys(require.cache);
  const pluginModules = modules.filter(m => 
    m.includes(pluginName) || 
    m.includes(`node_modules/@zhin.js/${pluginName}`) ||
    m.includes(`plugins/${pluginName}`)
  );
  
  let totalSize = 0;
  for (const mod of pluginModules) {
    totalSize += getModuleSize(mod);
  }
  
  return {
    count: pluginModules.length,
    size: totalSize,
    modules: pluginModules.map(m => path.basename(m)),
  };
}

/**
 * 分析插件内存占用（通过前后对比）
 */
addCommand(
  new MessageCommand('mem-profile')
    .desc('分析各个插件的内存占用')
    .action(async () => {
      const plugins = root.children;
      const results: Array<{
        name: string;
        modules: number;
        estimatedSize: string;
        features: Record<string, number>;
      }> = [];

      // 强制 GC（如果可用）
      if (global.gc) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const beforeMem = process.memoryUsage();

      for (const p of plugins) {
        const analysis = analyzePluginModules(p.name);
        const features = p.getFeatures();
        
        // 从 FeatureJSON 数组中提取各类计数
        const featureCounts: Record<string, number> = {};
        for (const f of features) {
          featureCounts[f.name] = f.count;
        }
        
        results.push({
          name: p.name,
          modules: analysis.count,
          estimatedSize: formatBytes(analysis.size),
          features: featureCounts,
        });
      }

      // 按模块数量排序
      results.sort((a, b) => b.modules - a.modules);

      const afterMem = process.memoryUsage();
      const heapDiff = afterMem.heapUsed - beforeMem.heapUsed;

      let output = '📊 插件内存分析报告\n\n';
      output += `总插件数: ${plugins.length}\n`;
      output += `当前堆内存: ${formatBytes(afterMem.heapUsed)}\n`;
      output += `分析开销: ${formatBytes(Math.abs(heapDiff))}\n\n`;
      output += '─'.repeat(60) + '\n\n';

      // 显示前 10 个占用最多的插件
      const top10 = results.slice(0, 10);
      for (const [index, result] of top10.entries()) {
        output += `${index + 1}. ${result.name}\n`;
        output += `   模块数: ${result.modules}\n`;
        output += `   估算大小: ${result.estimatedSize}\n`;
        output += `   功能: ${Object.entries(result.features).map(([k, v]) => `${v}${k}`).join(' ')}\n\n`;
      }

      if (results.length > 10) {
        output += `\n... 还有 ${results.length - 10} 个插件\n`;
      }

      output += '\n💡 提示:\n';
      output += '- 模块数多 = 依赖多 = 可能内存占用高\n';
      output += '- 使用 mem-compare 命令对比加载前后的内存\n';
      output += '- 使用 --expose-gc 启动可以强制 GC\n';

      return output;
    })
);

/**
 * 对比加载某个插件前后的内存变化
 */
addCommand(
  new MessageCommand('mem-compare <pluginName:text>')
    .desc('对比加载插件前后的内存变化')
    .action(async (message, result) => {
      const pluginName = result.params.pluginName;
      const targetPlugin = root.children.find(p => p.name === pluginName);

      if (!targetPlugin) {
        return `❌ 未找到插件: ${pluginName}\n\n可用插件:\n${root.children.map(p => `  - ${p.name}`).join('\n')}`;
      }

      // 获取插件信息
      const analysis = analyzePluginModules(pluginName);
      const features = targetPlugin.getFeatures();
      const currentMem = process.memoryUsage();

      let output = `📊 插件内存分析: ${pluginName}\n\n`;
      output += '─'.repeat(60) + '\n\n';
      output += `加载的模块数: ${analysis.count}\n`;
      output += `模块列表:\n${analysis.modules.slice(0, 10).map(m => `  - ${m}`).join('\n')}\n`;
      if (analysis.modules.length > 10) {
        output += `  ... 还有 ${analysis.modules.length - 10} 个模块\n`;
      }
      output += `\n估算大小: ${formatBytes(analysis.size)}\n\n`;
      
      output += '功能统计:\n';
      for (const f of features) {
        output += `  ${f.name}: ${f.count}\n`;
      }
      output += '\n';

      output += '当前内存状态:\n';
      output += `  RSS: ${formatBytes(currentMem.rss)}\n`;
      output += `  堆总量: ${formatBytes(currentMem.heapTotal)}\n`;
      output += `  堆使用: ${formatBytes(currentMem.heapUsed)}\n`;
      output += `  外部: ${formatBytes(currentMem.external)}\n\n`;

      output += '💡 提示:\n';
      output += '- 这是估算值，实际内存占用可能不同\n';
      output += '- 要精确测量，需要在加载前后分别测量\n';
      output += '- 大型依赖（如 discord.js）会显著增加内存\n';

      return output;
    })
);

/**
 * 生成堆快照并分析
 */
addCommand(
  new MessageCommand('mem-snapshot')
    .desc('生成堆快照用于详细分析')
    .action(async () => {
      const timestamp = Date.now();
      const filename = `heap-${timestamp}.heapsnapshot`;
      const filepath = path.join(process.cwd(), filename);

      try {
        writeHeapSnapshot(filepath);
        
        const stats = await import('fs').then(fs => fs.promises.stat(filepath));
        const size = formatBytes(stats.size);

        let output = '✅ 堆快照已生成\n\n';
        output += `文件: ${filename}\n`;
        output += `大小: ${size}\n`;
        output += `路径: ${filepath}\n\n`;
        output += '📖 使用方法:\n';
        output += '1. 使用 Chrome DevTools 打开快照:\n';
        output += '   - 打开 Chrome DevTools\n';
        output += '   - 切换到 Memory 标签\n';
        output += '   - 点击 Load 按钮\n';
        output += '   - 选择生成的 .heapsnapshot 文件\n\n';
        output += '2. 分析内存占用:\n';
        output += '   - Summary 视图: 查看对象类型占用\n';
        output += '   - Comparison 视图: 对比多个快照\n';
        output += '   - Containment 视图: 查看对象引用关系\n';

        return output;
      } catch (error) {
        return `❌ 生成快照失败: ${(error as Error).message}`;
      }
    })
);

/**
 * 查看 require.cache 统计
 */
addCommand(
  new MessageCommand('mem-cache')
    .desc('查看模块缓存统计')
    .action(() => {
      const modules = Object.keys(require.cache);
      
      // 按目录分组
      const groups = new Map<string, string[]>();
      
      for (const mod of modules) {
        let group = 'other';
        
        if (mod.includes('node_modules/@zhin.js')) {
          const match = mod.match(/node_modules\/@zhin\.js\/([^\/]+)/);
          group = match ? `@zhin.js/${match[1]}` : '@zhin.js';
        } else if (mod.includes('node_modules/')) {
          const match = mod.match(/node_modules\/([^\/]+)/);
          group = match ? match[1] : 'node_modules';
        } else if (mod.includes('/plugins/')) {
          const match = mod.match(/\/plugins\/([^\/]+)/);
          group = match ? `plugin:${match[1]}` : 'plugins';
        } else if (mod.includes('/packages/')) {
          const match = mod.match(/\/packages\/([^\/]+)/);
          group = match ? `package:${match[1]}` : 'packages';
        }
        
        if (!groups.has(group)) {
          groups.set(group, []);
        }
        groups.get(group)!.push(mod);
      }

      // 排序
      const sorted = Array.from(groups.entries())
        .sort((a, b) => b[1].length - a[1].length);

      let output = '📦 模块缓存统计\n\n';
      output += `总模块数: ${modules.length}\n`;
      output += `分组数: ${groups.size}\n\n`;
      output += '─'.repeat(60) + '\n\n';

      // 显示前 20 个
      for (const [group, mods] of sorted.slice(0, 20)) {
        output += `${group}: ${mods.length} 个模块\n`;
      }

      if (sorted.length > 20) {
        output += `\n... 还有 ${sorted.length - 20} 个分组\n`;
      }

      output += '\n💡 提示:\n';
      output += '- 每个模块都会占用内存\n';
      output += '- discord.js 等大型库会加载很多模块\n';
      output += '- 使用 mem-compare <插件名> 查看具体插件\n';

      return output;
    })
);

logger.debug('插件内存分析工具已加载');

