import { Dependency } from '@zhin.js/dependency';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * 测试依赖去重功能
 * 
 * 场景：
 * a import b
 * a import d
 * b import c  
 * c import d
 * 
 * 期望：
 * - d 应该是同一个实例
 * - d.parent = a（首次导入者）
 * - d.refs = Set([c])（后续导入者）
 */

async function testDeduplication() {
  console.log('\n🧪 测试依赖去重功能\n');

  // 1. 创建测试插件文件
  const pluginsDir = join(process.cwd(), 'src', 'plugins', 'test-dedup');
  await mkdir(pluginsDir, { recursive: true });

  // a: 导入 b 和 d（使用顶层 await，确保在 start 阶段导入）
  await writeFile(join(pluginsDir, 'a.ts'), `
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
`);

  // b: 导入 c
  await writeFile(join(pluginsDir, 'b.ts'), `
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
`);

  // c: 导入 d
  await writeFile(join(pluginsDir, 'c.ts'), `
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
`);

  // d: 叶子节点
  await writeFile(join(pluginsDir, 'd.ts'), `
import { onMount, onDispose } from '@zhin.js/dependency';

export const name = 'plugin-d';

onMount(() => {
  console.log('[D] 已挂载');
});

onDispose(() => {
  console.log('[D] 已卸载');
});
`);

  console.log('✅ 测试插件文件已创建\n');

  // 2. 创建依赖树
  const a = new Dependency(join(pluginsDir, 'a.ts'));

  console.log('📦 启动依赖树...\n');
  await a.start();

  console.log('\n📊 依赖树结构：\n');
  console.log(a.printTree('', true, true));

  // 3. 获取 d 的两个引用
  console.log('\n🔍 查找子依赖...');
  console.log('a.children:', a.children.map(c => c.name));
  
  const b = a.children.find(child => child.name === 'b');
  if (!b) {
    console.log('❌ 未找到 b');
    process.exit(1);
  }
  console.log('b.children:', b.children.map(c => c.name));
  
  const c = b.children.find(child => child.name === 'c');
  if (!c) {
    console.log('❌ 未找到 c');
    process.exit(1);
  }
  console.log('c.children:', c.children.map(c => c.name));
  
  const d_from_a = a.children.find(child => child.name === 'd');
  if (!d_from_a) {
    console.log('❌ 未找到 d_from_a');
    process.exit(1);
  }
  
  const d_from_c = c.children.find(child => child.name === 'd');
  if (!d_from_c) {
    console.log('❌ 未找到 d_from_c');
    process.exit(1);
  }

  // 4. 验证去重
  console.log('\n🔍 验证去重结果：\n');

  // 测试 1: d 应该是同一个实例
  if (d_from_a === d_from_c) {
    console.log('✅ 测试 1 通过: d 是同一个实例');
  } else {
    console.log('❌ 测试 1 失败: d 不是同一个实例');
    console.log('  d_from_a:', d_from_a);
    console.log('  d_from_c:', d_from_c);
    process.exit(1);
  }

  // 测试 2: d.refs.size 应该是 1（c 引用了 d）
  if (d_from_a.refs.size === 1) {
    console.log(`✅ 测试 2 通过: d.refs.size = ${d_from_a.refs.size}`);
  } else {
    console.log(`❌ 测试 2 失败: d.refs.size = ${d_from_a.refs.size}, 期望 1`);
    process.exit(1);
  }

  // 测试 3: d.parent 应该是 a（首次导入者）
  if (d_from_a.parent === a) {
    console.log(`✅ 测试 3 通过: d.parent = a (首次导入者)`);
  } else {
    console.log(`❌ 测试 3 失败: d.parent = ${d_from_a.parent?.name}, 期望 a`);
    process.exit(1);
  }

  // 测试 4: refs 中应该包含 c
  const hasC = Array.from(d_from_a.refs).some(ref => ref.name === 'c');
  if (hasC) {
    console.log(`✅ 测试 4 通过: d.refs 包含 c`);
  } else {
    console.log(`❌ 测试 4 失败: d.refs 不包含 c`);
    const refNames = Array.from(d_from_a.refs).map(ref => ref.name);
    console.log('  实际 refs:', refNames);
    process.exit(1);
  }

  // 测试 5: 总引用数应该是 2（a 作为 parent + c 在 refs）
  const totalRefs = (d_from_a.parent ? 1 : 0) + d_from_a.refs.size;
  if (totalRefs === 2) {
    console.log(`✅ 测试 5 通过: d 总引用数 = ${totalRefs}`);
  } else {
    console.log(`❌ 测试 5 失败: d 总引用数 = ${totalRefs}, 期望 2`);
    process.exit(1);
  }

  // 测试 6: 停止 b（包括 c），d 应该继续运行（因为 a 还在引用）
  console.log('\n🛑 停止 b（包括 c）...');
  await b.stop();
  
  console.log('\n📊 停止 b 后的依赖树：\n');
  console.log(a.printTree('', true, true));

  // d 应该还在 a 的 children 中
  const d_after_stop_b = a.children.find(child => child.name === 'd');
  if (d_after_stop_b && d_after_stop_b.started) {
    console.log('✅ 测试 6 通过: 停止 b 后，d 继续运行（a 还在引用）');
  } else {
    console.log('❌ 测试 6 失败: 停止 b 后，d 被错误停止');
    process.exit(1);
  }

  // d.refs 应该为空（c 已经停止）
  if (d_after_stop_b.refs.size === 0) {
    console.log('✅ 测试 7 通过: d.refs 已清空（c 已停止）');
  } else {
    console.log(`❌ 测试 7 失败: d.refs.size = ${d_after_stop_b.refs.size}, 期望 0`);
    process.exit(1);
  }

  // d.parent 仍然是 a
  if (d_after_stop_b.parent === a) {
    console.log('✅ 测试 8 通过: d.parent 仍然是 a');
  } else {
    console.log(`❌ 测试 8 失败: d.parent = ${d_after_stop_b.parent?.name}, 期望 a`);
    process.exit(1);
  }

  // 测试 9: 停止 a，d 也应该停止
  console.log('\n🛑 停止 a...');
  await a.stop();

  console.log('\n📊 停止 a 后的依赖树：\n');
  console.log(a.printTree('', true, true));

  if (!d_after_stop_b.started) {
    console.log('✅ 测试 9 通过: 停止 a 后，d 也停止了');
  } else {
    console.log('❌ 测试 9 失败: 停止 a 后，d 仍在运行');
    process.exit(1);
  }

  console.log('\n🎉 所有测试通过！\n');
}

testDeduplication().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});

