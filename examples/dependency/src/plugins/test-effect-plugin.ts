
import { onMount, onDispose } from '@zhin.js/dependency';

console.log('\n[测试插件] 模块已加载');
console.log('[测试插件] globalThis.setInterval 是否被包装:', globalThis.setInterval.toString().includes('__globalSetInterval'));
console.log('[测试插件] globalThis.setTimeout 是否被包装:', globalThis.setTimeout.toString().includes('__globalSetTimeout'));

let counter = 0;

onMount(() => {
  console.log('\n[测试插件] onMount 执行');
  
  // 测试 setInterval
  const intervalId = setInterval(() => {
    counter++;
    console.log(`[测试插件] setInterval 执行 #${counter}`);
  }, 500);
  
  console.log('[测试插件] setInterval ID:', intervalId);
  console.log('[测试插件] setInterval ID 类型:', typeof intervalId);
  
  // 测试 setTimeout
  const timeoutId = setTimeout(() => {
    console.log('[测试插件] setTimeout 执行');
  }, 1000);
  
  console.log('[测试插件] setTimeout ID:', timeoutId);
  console.log('[测试插件] setTimeout ID 类型:', typeof timeoutId);
  
  // 检查全局副作用数组
  if (typeof globalThis.__global_effects__ !== 'undefined') {
    console.log('\n[测试插件] ✅ __global_effects__ 存在');
    console.log('[测试插件] intervals:', (globalThis as any).__global_effects__.intervals);
    console.log('[测试插件] timeouts:', (globalThis as any).__global_effects__.timeouts);
  } else {
    console.log('\n[测试插件] ❌ __global_effects__ 不存在！');
    console.log('[测试插件] 这说明副作用包装代码没有被注入！');
  }
});

onDispose(() => {
  console.log('\n[测试插件] onDispose 执行');
  console.log('[测试插件] counter:', counter);
  console.log('[测试插件] 定时器应该在这之后被自动清理');
});
