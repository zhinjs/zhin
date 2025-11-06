/**
 * 示例 4: 父子插件
 * 
 * 展示：
 * - 依赖树结构
 * - 父插件导入子插件
 * - 级联停止
 */

import { onMount, onDispose } from '@zhin.js/dependency';
import './child-plugin.js';

console.log('👨 [Parent Plugin] 模块已加载');

onMount(() => {
  console.log('✅ [Parent Plugin] 父插件已挂载');
  
  // 父插件的定时任务
  setInterval(() => {
    console.log('🌟 [Parent Plugin] 父插件定时任务执行');
  }, 1000);
});

onDispose(() => {
  console.log('🛑 [Parent Plugin] 父插件正在卸载');
  console.log('   子插件也会级联卸载');
});


