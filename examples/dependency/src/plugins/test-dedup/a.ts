
import { getCurrentDependency, onMount } from '@zhin.js/dependency';

export const name = 'plugin-a';

// 在顶层执行，确保在 start 阶段导入（而不是 mount 阶段）
const dep = getCurrentDependency();
if (dep) {
  console.log('[A] 正在加载 b 和 d...');
  await dep.importChild('./b');
  await dep.importChild('./d');
  console.log('[A] b 和 d 已加载');
}

onMount(() => {
  console.log('[A] 已挂载');
});
