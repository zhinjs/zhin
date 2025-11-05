/**
 * @zhin.js/dependency 完整示例
 * 
 * 这个示例展示了如何使用 dependency 模块构建一个完整的插件系统
 */

import { Dependency } from '@zhin.js/dependency';
import { resolve } from 'path';

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function log(color: keyof typeof colors, message: string) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  log('bright', '\n' + '='.repeat(60));
  log('cyan', '🌲 @zhin.js/dependency 完整示例');
  log('bright', '='.repeat(60) + '\n');
  
  // 插件列表
  const plugins = [
    'logger-plugin.ts',
    'timer-plugin.ts',
    'database-plugin.ts',
    'parent-plugin.ts'
  ];
  
  log('yellow', '📦 准备加载以下插件:');
  plugins.forEach((plugin, index) => {
    console.log(`   ${index + 1}. ${plugin}`);
  });
  console.log();
  
  // 创建插件依赖树
  const roots: Dependency[] = [];
  
  for (const plugin of plugins) {
    const pluginPath = resolve(process.cwd(), 'plugins', plugin);
    const root = new Dependency(pluginPath);
    
    // 监听生命周期事件
    root.on('after-start', (dep: Dependency) => {
      log('green', `✅ [Lifecycle] ${dep.name} 已启动`);
    });
    
    root.on('after-mount', (dep: Dependency) => {
      log('green', `✅ [Lifecycle] ${dep.name} 已挂载`);
    });
    
    root.on('error', (dep: Dependency, error: Error) => {
      log('red', `❌ [Lifecycle] ${dep.name} 发生错误: ${error.message}`);
    });
    
    roots.push(root);
  }
  
  // 启动所有插件
  log('yellow', '\n🚀 启动所有插件...\n');
  
  for (const root of roots) {
    await root.start();
  }
  
  log('green', '\n✅ 所有插件已启动\n');
  
  // 打印依赖树
  log('cyan', '📊 依赖树结构:\n');
  
  for (const root of roots) {
    console.log(root.printTree('', true, true));
  }
  
  // 运行一段时间
  log('yellow', '\n⏳ 插件运行中... (10秒后自动停止)\n');
  
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // 停止所有插件
  log('yellow', '\n🛑 停止所有插件...\n');
  
  for (const root of roots) {
    await root.stop();
  }
  
  log('green', '\n✅ 所有插件已停止');
  
  // 验证清理
  log('yellow', '\n⏳ 等待 2 秒验证清理...\n');
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  log('green', '✅ 清理验证完成');
  log('magenta', '   如果没有看到定时器继续执行，说明自动清理成功！');
  
  log('bright', '\n' + '='.repeat(60));
  log('cyan', '🎉 示例演示完成！');
  log('bright', '='.repeat(60) + '\n');
}

// 运行主函数
main().catch(error => {
  log('red', `\n❌ 发生错误: ${error.message}`);
  console.error(error);
  process.exit(1);
});

