
import { getCurrentDependency, onMount } from '@zhin.js/dependency';

export const name = 'root';

const dep = getCurrentDependency();
if (dep) {
  console.log('[Root] 正在加载 child...');
  await dep.importChild('./child');
  console.log('[Root] child 已加载');
}

onMount(() => {
  console.log('[Root] 已挂载');
});
