import { Dependency } from '@zhin.js/dependency';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * 测试重载时 refs 计数是否正确
 */

async function testReloadRefs() {
  console.log('\n🧪 测试重载时的 refs 计数\n');

  // 1. 创建测试插件文件
  const pluginsDir = join(process.cwd(), 'src', 'plugins', 'test-reload');
  await mkdir(pluginsDir, { recursive: true });

  // root: 导入 child
  await writeFile(join(pluginsDir, 'root.ts'), `
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
`);

  // child: 叶子节点
  await writeFile(join(pluginsDir, 'child.ts'), `
import { onMount, onDispose } from '@zhin.js/dependency';

export const name = 'child';

onMount(() => {
  console.log('[Child] 已挂载');
});

onDispose(() => {
  console.log('[Child] 已卸载');
});
`);

  console.log('✅ 测试插件文件已创建\n');

  // 2. 创建依赖树
  const root = new Dependency(join(pluginsDir, 'root.ts'));

  console.log('📦 启动依赖树...\n');
  await root.start();

  console.log('\n📊 初始依赖树：\n');
  console.log(root.printTree('', true, true));

  // 3. 获取 child
  const child = root.children.find(c => c.name === 'child')!;

  // 验证初始状态
  console.log('\n🔍 初始状态验证：\n');
  console.log(`child.parent = ${child.parent?.name}`);
  console.log(`child.refs.size = ${child.refs.size}`);
  console.log(`总引用数 = ${(child.parent ? 1 : 0) + child.refs.size}`);

  if (child.parent?.name === 'root' && child.refs.size === 0) {
    console.log('✅ 初始状态正确');
  } else {
    console.log('❌ 初始状态错误');
    process.exit(1);
  }

  // 4. 重载 root
  console.log('\n🔄 重载 root...\n');
  await root.reload();

  console.log('\n📊 重载后的依赖树：\n');
  console.log(root.printTree('', true, true));

  // 5. 重新获取 child（应该是同一个实例）
  const childAfterReload = root.children.find(c => c.name === 'child')!;

  console.log('\n🔍 重载后状态验证：\n');
  console.log(`child === childAfterReload: ${child === childAfterReload}`);
  console.log(`child.parent = ${child.parent?.name}`);
  console.log(`child.refs.size = ${child.refs.size}`);
  console.log(`总引用数 = ${(child.parent ? 1 : 0) + child.refs.size}`);

  // 测试 1: child 应该是同一个实例
  if (child === childAfterReload) {
    console.log('✅ 测试 1 通过: child 是同一个实例');
  } else {
    console.log('❌ 测试 1 失败: child 不是同一个实例');
    process.exit(1);
  }

  // 测试 2: child.parent 应该仍然是 root
  if (child.parent?.name === 'root') {
    console.log('✅ 测试 2 通过: child.parent 仍然是 root');
  } else {
    console.log(`❌ 测试 2 失败: child.parent = ${child.parent?.name}, 期望 root`);
    process.exit(1);
  }

  // 测试 3: child.refs.size 应该仍然是 0（不应该有重复的引用）
  if (child.refs.size === 0) {
    console.log('✅ 测试 3 通过: child.refs.size = 0（没有重复引用）');
  } else {
    console.log(`❌ 测试 3 失败: child.refs.size = ${child.refs.size}, 期望 0`);
    console.log('  refs 内容:', Array.from(child.refs).map(r => r.name));
    process.exit(1);
  }

  // 测试 4: 总引用数应该是 1
  const totalRefs = (child.parent ? 1 : 0) + child.refs.size;
  if (totalRefs === 1) {
    console.log(`✅ 测试 4 通过: 总引用数 = ${totalRefs}`);
  } else {
    console.log(`❌ 测试 4 失败: 总引用数 = ${totalRefs}, 期望 1`);
    process.exit(1);
  }

  // 5. 清理
  console.log('\n🛑 停止依赖树...\n');
  await root.stop();

  console.log('🎉 所有测试通过！\n');
}

testReloadRefs().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});

