/**
 * 子插件
 * 
 * 被 parent-plugin.ts 导入
 * 展示依赖树结构
 */

import { onMount, onDispose } from '@zhin.js/dependency';
import './timer-plugin.js';
// import './parent-plugin.js'

console.log('👶 [Child Plugin] 模块已加载');

onMount(() => {
  console.log('✅ [Child Plugin] 子插件已挂载');
  
  // 子插件的定时任务
  // setInterval(() => {
  //   console.log('💫 [Child Plugin] 子插件定时任务执行');
  // }, 2000);
});

onDispose(() => {
  console.log('🛑 [Child Plugin] 子插件正在卸载');
});

