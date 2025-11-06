
import { getCurrentDependency, onMount } from '@zhin.js/dependency';

export const name = 'plugin-c';

const dep = getCurrentDependency();
if (dep) {
  console.log('[C] 正在加载 d...');
  await dep.importChild('./d');
  console.log('[C] d 已加载');
}

onMount(() => {
  console.log('[C] 已挂载');
});
