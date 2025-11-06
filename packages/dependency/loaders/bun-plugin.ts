/**
 * Bun Plugin
 * 在 Bun 运行时拦截模块加载，自动转换 import 语句
 */

import type { BunPlugin } from 'bun';
import { readFileSync } from 'fs';
import { transformImports, hasRelativeImports, shouldTransformPath } from './transform-utils.mjs';

/**
 * 创建 Bun Plugin 配置
 * 使用环境变量配置：
 * - DEPENDENCY_TREE_INCLUDE: 需要处理的路径（支持 node_modules）
 * - DEPENDENCY_TREE_EXCLUDE: 需要排除的路径
 */
export function createDependencyTreePlugin(): BunPlugin {
  return {
    name: 'dependency-tree-plugin',
    
    setup(build) {
      // 根据环境变量动态构建 filter，避免不必要的文件读取
      const includePaths = process.env.DEPENDENCY_TREE_INCLUDE;
      
      let filter: RegExp;
      if (includePaths) {
        // 如果设置了 INCLUDE，构建包含这些路径的 filter
        const paths = includePaths.split(',').map(p => p.trim());
        const patterns = paths.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        filter = new RegExp(`(${patterns}).*\\.(ts|js)$`);
      } else {
        // 默认：只处理非 node_modules 的文件
        filter = /^(?!.*\/node_modules\/).*\.(ts|js)$/;
      }
      
      build.onLoad({ filter }, async (args) => {
        const source = readFileSync(args.path, 'utf-8');
        
        // 二次检查：使用统一的判断逻辑（支持 EXCLUDE）
        if (!shouldTransformPath(args.path, ['.ts', '.js'])) {
          // 不需要处理此文件，返回原内容
          return {
            contents: source,
            loader: args.path.endsWith('.ts') ? 'ts' : 'js',
          };
        }
        
        // 检查是否是热重载（URL 包含时间戳查询参数）
        // 如果是热重载，强制重新转换以重新注册 hooks
        const isHotReload = args.path.includes('?');
        
        // 检查是否已经转换过或没有相对路径的 import
        const alreadyTransformed = source.includes('__BUN_PLUGIN_TRANSFORMED__');
        
        // 如果不是热重载，且已经转换过或没有相对导入，跳过转换
        if (!isHotReload && (alreadyTransformed || !hasRelativeImports(source))) {
          // 返回原内容
          return {
            contents: source,
            loader: args.path.endsWith('.ts') ? 'ts' : 'js',
          };
        }
        
        // 转换相对路径的 import 语句
        const transformed = transformImports(source, args.path, isHotReload, '__BUN_PLUGIN_TRANSFORMED__');
        
        // 根据文件扩展名确定 loader
        const loader = args.path.endsWith('.ts') ? 'ts' : 'js';
        
        return {
          contents: transformed,
          loader: loader as 'ts' | 'js',
        };
      });
    },
  };
}

/**
 * 默认的 Bun Plugin（保持向后兼容）
 */
export const dependencyTreePlugin = createDependencyTreePlugin();

/**
 * 注册 Bun Plugin
 */
export function registerBunPlugin() {
  // Bun 会自动识别并加载此插件
  return dependencyTreePlugin;
}
