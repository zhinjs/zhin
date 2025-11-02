/**
 * Bun Preload Script
 * 在 Bun 启动时注册插件
 */

import { plugin } from 'bun';
import { createDependencyTreePlugin } from './bun-plugin';

// 创建并注册插件
// 可以通过环境变量 DEPENDENCY_TREE_INCLUDE 配置需要处理的路径
// 例如: DEPENDENCY_TREE_INCLUDE="/plugins/,/src/modules/" bun run index.ts
const dependencyTreePlugin = createDependencyTreePlugin();
plugin(dependencyTreePlugin);

console.log('✅ Bun plugin registered');

