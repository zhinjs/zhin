
import { onMount, onDispose } from '@zhin.js/dependency';

export const name = 'child';

onMount(() => {
  console.log('[Child] 已挂载');
});

onDispose(() => {
  console.log('[Child] 已卸载');
});
