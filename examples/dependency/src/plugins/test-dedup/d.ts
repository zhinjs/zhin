
import { onMount, onDispose } from '@zhin.js/dependency';

export const name = 'plugin-d';

onMount(() => {
  console.log('[D] 已挂载');
});

onDispose(() => {
  console.log('[D] 已卸载');
});
