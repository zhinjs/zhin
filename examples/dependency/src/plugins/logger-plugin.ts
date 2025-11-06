import { onDispose } from '@zhin.js/dependency';

console.log('📦 [Logger Plugin] 模块已加载完毕');
// 卸载钩子
onDispose(() => {
  console.log('🛑 [Logger Plugin] 插件已卸载');
});


