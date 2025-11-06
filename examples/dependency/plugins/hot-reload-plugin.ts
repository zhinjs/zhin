/**
 * 热重载测试插件
 * 
 * 修改此文件中的任何内容（如消息文本、定时器间隔等）
 * 保存后系统会自动重载，无需重启进程
 */

import { onMount, onDispose } from '@zhin.js/dependency';
import './logger-plugin.ts';

// 插件版本（修改这个数字来测试热重载）
const VERSION = 1

// setInterval(() => {
//   console.log('定时任务');
// }, 1000);

onMount(() => {
  console.log(`✅ [Hot Reload Plugin v${VERSION}] 插件已挂载`);
});

onDispose(() => {
  console.log(`🛑 [Hot Reload Plugin v${VERSION}] 插件正在卸载`);
});
