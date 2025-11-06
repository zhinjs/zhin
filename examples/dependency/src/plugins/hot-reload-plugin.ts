import { onMount, onDispose } from '@zhin.js/dependency';
import './logger-plugin.js';
import './child-plugin.js';

// setInterval(() => {
//   console.log('定时任务');
// }, 1000);

onMount(() => {
  console.log(`✅ [Hot Reload Plugin 插件已挂载`);
});

onDispose(() => {
  console.log(`🛑 [Hot Reload Plugin 插件正在卸载`);
});
