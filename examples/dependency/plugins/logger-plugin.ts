/**
 * 示例 1: 基础日志插件
 * 
 * 展示：
 * - 基本的插件结构
 * - onMount 和 onDispose 钩子
 * - 插件配置导出
 */

import { onDispose } from '@zhin.js/dependency';

console.log('📦 [Logger Plugin] 模块已加载完成');

// 卸载钩子
onDispose(() => {
  console.log('🛑 [Logger Plugin] 插件已卸载');
});


