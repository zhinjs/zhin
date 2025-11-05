/**
 * 示例 1: 基础日志插件
 * 
 * 展示：
 * - 基本的插件结构
 * - onMount 和 onDispose 钩子
 * - 插件配置导出
 */

import { onMount, onDispose } from '@zhin.js/dependency';

console.log('📦 [Logger Plugin] 模块已加载');

// 插件配置
export const config = {
  name: 'logger',
  version: '1.0.0',
  description: '简单的日志插件'
};

// 内部状态
let logCount = 0;

// 挂载钩子
onMount(() => {
  console.log('✅ [Logger Plugin] 插件已挂载');
  console.log(`   版本: ${config.version}`);
});

// 卸载钩子
onDispose(() => {
  console.log('🛑 [Logger Plugin] 插件正在卸载');
  console.log(`   总共记录了 ${logCount} 条日志`);
});

// 导出日志函数
export function log(message: string) {
  logCount++;
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

export function error(message: string) {
  logCount++;
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ ${message}`);
}

export default config;

