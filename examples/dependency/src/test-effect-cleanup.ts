/**
 * 副作用自动清理测试
 * 
 * 测试在不同平台上副作用自动清理是否正常工作
 */

import { Dependency, onDispose } from '@zhin.js/dependency';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

console.log('='.repeat(70));
console.log('🧪 副作用自动清理测试');
console.log('='.repeat(70));
console.log(`平台: ${process.platform}`);
console.log(`Node版本: ${process.version}`);
console.log(`环境变量 DEPENDENCY_WRAP_EFFECTS: ${process.env.DEPENDENCY_WRAP_EFFECTS || '(默认启用)'}`);
console.log('='.repeat(70));

// 创建测试插件
const testPluginPath = resolve(import.meta.dirname, 'plugins', 'test-effect-plugin.ts');

// 创建测试插件文件
const testPluginCode = `
import { onMount, onDispose } from '@zhin.js/dependency';

console.log('\\n[测试插件] 模块已加载');
console.log('[测试插件] globalThis.setInterval 是否被包装:', globalThis.setInterval.toString().includes('__globalSetInterval'));
console.log('[测试插件] globalThis.setTimeout 是否被包装:', globalThis.setTimeout.toString().includes('__globalSetTimeout'));

let counter = 0;

onMount(() => {
  console.log('\\n[测试插件] onMount 执行');
  
  // 测试 setInterval
  const intervalId = setInterval(() => {
    counter++;
    console.log(\`[测试插件] setInterval 执行 #\${counter}\`);
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
    console.log('\\n[测试插件] ✅ __global_effects__ 存在');
    console.log('[测试插件] intervals:', (globalThis as any).__global_effects__.intervals);
    console.log('[测试插件] timeouts:', (globalThis as any).__global_effects__.timeouts);
  } else {
    console.log('\\n[测试插件] ❌ __global_effects__ 不存在！');
    console.log('[测试插件] 这说明副作用包装代码没有被注入！');
  }
});

onDispose(() => {
  console.log('\\n[测试插件] onDispose 执行');
  console.log('[测试插件] counter:', counter);
  console.log('[测试插件] 定时器应该在这之后被自动清理');
});
`;

writeFileSync(testPluginPath, testPluginCode, 'utf-8');

async function main() {
  let testPassed = true;
  let intervalExecutions = 0;
  const intervalLogs: string[] = [];
  
  console.log('\n📝 测试 1: 创建依赖并启动\n');
  
  const dep = new Dependency(testPluginPath);
  
  // 拦截 console.log 来计数 interval 执行次数
  const originalLog = console.log;
  console.log = function(...args: any[]) {
    const msg = args.join(' ');
    if (msg.includes('[测试插件] setInterval 执行')) {
      intervalExecutions++;
      intervalLogs.push(msg);
    }
    originalLog.apply(console, args);
  };
  
  await dep.start();
  
  console.log('\n⏱️  等待 2 秒，让定时器执行几次...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const executionsBeforeStop = intervalExecutions;
  console.log(`[主程序] stop 前 interval 执行了 ${executionsBeforeStop} 次`);
  
  console.log('\n📝 测试 2: 停止依赖（应该自动清理副作用）\n');
  await dep.stop();
  
  console.log('\n⏱️  等待 2 秒，检查定时器是否还在执行...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const executionsAfterStop = intervalExecutions;
  console.log(`[主程序] stop 后又执行了 ${executionsAfterStop - executionsBeforeStop} 次`);
  
  // 恢复 console.log
  console.log = originalLog;
  
  console.log('\n='.repeat(70));
  console.log('📊 测试总结');
  console.log('='.repeat(70));
  console.log(`stop 前执行次数: ${executionsBeforeStop}`);
  console.log(`stop 后执行次数: ${executionsAfterStop - executionsBeforeStop}`);
  
  if (executionsAfterStop > executionsBeforeStop) {
    console.log('❌ 测试失败：定时器在 stop 后仍在执行（未被自动清理）');
    testPassed = false;
  } else {
    console.log('✅ 测试通过：定时器在 stop 后停止了（已被自动清理）');
  }
  
  console.log('='.repeat(70));
  
  if (!testPassed) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ 测试失败:', error);
  process.exit(1);
});

