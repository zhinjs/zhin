/**
 * tsx Loader Hook
 * 在 tsx 运行时拦截模块加载，自动转换 import 语句
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { transformImports, hasRelativeImports, shouldTransformPath } from './transform-utils.mjs';

// 当前正在加载的依赖栈
const dependencyStack = [];

/**
 * resolve hook
 */
export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}

/**
 * 检查文件是否需要处理
 */
function shouldTransform(url) {
  return shouldTransformPath(url, ['.ts', '.js']);
}

/**
 * load hook - 拦截模块加载并转换代码
 */
export async function load(url, context, nextLoad) {
  // 检查是否需要处理此文件
  if (shouldTransform(url)) {
    try {
      // 检查是否是热重载（URL 包含时间戳查询参数）
      const isHotReload = url.includes('?t=');
      
      // 从 URL 中分离实际路径
      const [actualUrl] = url.split('?');
      const filePath = fileURLToPath(actualUrl);
      let source = readFileSync(filePath, 'utf-8');
      
      // 检查是否已经转换过（热重载时强制重新转换）
      if (!isHotReload && source.includes('__LOADER_TRANSFORMED__')) {
        return nextLoad(url, context);
      }
      
      // 检查是否有相对路径的 import 需要转换
      if (!isHotReload && !hasRelativeImports(source)) {
        return nextLoad(url, context);
      }
      
      // 转换相对路径的 import 语句
      const transformed = transformImports(source, actualUrl, isHotReload, '__LOADER_TRANSFORMED__');
      
      return {
        format: 'module',
        source: transformed,
        shortCircuit: true,
      };
    } catch (error) {
      console.error('Loader error:', error);
      return nextLoad(url, context);
    }
  }
  
  // 其他文件使用默认加载
  return nextLoad(url, context);
}
