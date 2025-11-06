
import { getCurrentDependency, onMount } from '@zhin.js/dependency';

export const name = 'plugin-b';

const dep = getCurrentDependency();
if (dep) {
  console.log('[B] 正在加载 c...');
  await dep.importChild('./c');
  console.log('[B] c 已加载');
}

onMount(() => {
  console.log('[B] 已挂载');
});
