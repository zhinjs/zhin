/**
 * 示例 2: 定时器插件
 * 
 * 展示：
 * - 副作用自动管理
 * - setInterval 自动清理
 * - setTimeout 自动清理
 * - setImmediate 自动清理
 */

import { onMount } from '@zhin.js/dependency';
// import './database-plugin.js';

console.log('⏰ [Timer Plugin] 模块已加载');

onMount(() => {
  // console.log('✅ [Timer Plugin] 插件已挂载');
  
  // // 1. setInterval - 每秒执行一次
  // // ✨ 自动清理，无需手动 clearInterval
  // setInterval(() => {
  //   tickCount++;
  //   console.log(`⏱️  [Timer Plugin] Tick #${tickCount}`);
  // }, 1000);
  
  // // 2. setTimeout - 5秒后执行一次
  // // ✨ 自动清理，无需手动 clearTimeout
  // setTimeout(() => {
  //   console.log('⏳ [Timer Plugin] 延时任务执行（5秒）');
  // }, 5000);
  
  // // 3. setImmediate - 立即执行（下一个事件循环）
  // // ✨ 自动清理，无需手动 clearImmediate
  // setImmediate(() => {
  //   console.log('⚡ [Timer Plugin] 立即执行任务');
  // });
  
  // // 4. 嵌套的定时器
  // setTimeout(() => {
  //   console.log('🔄 [Timer Plugin] 外层延时器（3秒）');
    
  //   // 嵌套的定时器也会自动清理
  //   setTimeout(() => {
  //     console.log('🔄 [Timer Plugin] 内层延时器（+2秒）');
  //   }, 2000);
  // }, 3000);
  
  console.log('🚀 [Timer Plugin] 所有定时器已注册（将自动清理）');
});