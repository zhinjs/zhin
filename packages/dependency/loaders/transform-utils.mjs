import pkgJson from '../package.json' with { type: 'json' };
/**
 * 通用转换工具
 * 供 tsx-loader 和 bun-plugin 共享使用
 */

/**
 * 检查是否有相对路径的 import
 */
export function hasRelativeImports(source) {
  return /^import\s+['"](\.[^'"]+)['"]/m.test(source);
}

/**
 * 生成副作用包装代码
 * 包装全局副作用函数，自动添加清理逻辑到 onDispose
 */
function generateEffectWrappers() {
  return `
const __DEP_CURRENT__ = globalThis.__CURRENT_DEPENDENCY__;
const __globalSetInterval = globalThis.setInterval;
const __globalSetTimeout = globalThis.setTimeout;
const __globalSetImmediate = typeof setImmediate !== 'undefined' ? globalThis.setImmediate : null;


const setInterval = function(...args) {
  const timerId = __globalSetInterval.apply(this, args);
  __DEP_CURRENT__.addDisposeHook(() => clearInterval(timerId),true);
  return timerId;
};

const setTimeout = function(...args) {
  const timerId = __globalSetTimeout.apply(this, args);
  __DEP_CURRENT__.addDisposeHook(() => clearTimeout(timerId),true);
  return timerId;
};

if (__globalSetImmediate) {
  const setImmediate = function(...args) {
    const immediateId = __globalSetImmediate.apply(this, args);
    __DEP_CURRENT__.addDisposeHook(() => clearImmediate(immediateId),true);
    return immediateId;
  };
}
`;
}

/**
 * 检查是否启用副作用包装
 * 通过环境变量 DEPENDENCY_WRAP_EFFECTS 控制
 * 值为 'false' 或 '0' 时禁用，其他情况默认启用
 */
function shouldWrapEffects() {
  const envValue = process.env.DEPENDENCY_WRAP_EFFECTS;
  if (envValue === 'false' || envValue === '0') {
    return false;
  }
  return true; // 默认启用
}

/**
 * 转换 import 语句
 * @param {string} source - 源代码
 * @param {string} currentPath - 当前文件路径
 * @param {boolean} isHotReload - 是否为热重载
 * @param {string} marker - 转换标记（如 '__LOADER_TRANSFORMED__' 或 '__BUN_PLUGIN_TRANSFORMED__'）
 */
export function transformImports(source, currentPath, isHotReload = false, marker = '__LOADER_TRANSFORMED__') {
  // 检查是否需要转换
  const needsImportTransform = hasRelativeImports(source);
  const wrapEffects = shouldWrapEffects();
  const hooksPath = pkgJson.name;

  if (wrapEffects) {
    const hasOnDispose = source.includes('onDispose');
    if (!hasOnDispose) {
      source = `import { onDispose } from '${hooksPath}';\n`+source;
    }
    // 收集所有import 行
    const importLines = source.match(/import\s+[^;]+from\s+(['"])([^'"]+)\1;\n/gm)||[];
    const lastImportLine = importLines[importLines.length - 1];
    source = source.replace(lastImportLine, lastImportLine+generateEffectWrappers());
  }
  // 如果不需要任何转换，直接返回原始代码
  if (!needsImportTransform && !isHotReload) {
    return source;
  }

  // 添加标记（热重载时添加时间戳）
  let result = isHotReload
    ? `/* ${marker} (Hot Reload: ${Date.now()}) */\n`
    : `/* ${marker} */\n`;

  // 2. 检查是否已有 importModule 导入
  const hasImportModule = /import.*importModule.*from.*${hooksPath}/.test(source);

  // 如果没有且需要转换 import，添加 importModule 导入
  if (needsImportTransform && !hasImportModule) {
    result += `import { importModule } from '${hooksPath}';\n`;
  }

  // 3. 转换相对路径的 import
  let transformedSource = source;
  if (needsImportTransform) {
    transformedSource = source.replace(
      /^import\s+(['"])(\.[^'"]+)\1;?\s*$/gm,
      (match, quote, importPath) => {
        return `await importModule(${quote}${importPath}${quote},${quote}${currentPath}${quote});`;
      }
    );
  }

  result += transformedSource;

  return result;
}


/**
 * 检查文件是否需要处理
 * 
 * 环境变量配置：
 * - DEPENDENCY_TREE_INCLUDE: 需要处理的路径（优先级最高，即使在 node_modules 中也会处理）
 * - DEPENDENCY_TREE_EXCLUDE: 需要排除的路径（可用于排除特定的 node_modules 包）
 * 
 * @example
 * // 包含 npm 包中的插件
 * DEPENDENCY_TREE_INCLUDE=node_modules/@my-org/my-plugin/plugins
 * 
 * // 包含多个路径
 * DEPENDENCY_TREE_INCLUDE=src/plugins,node_modules/@my-org/plugin1,node_modules/@my-org/plugin2
 * 
 * // 排除特定路径（与默认的 node_modules 排除结合使用）
 * DEPENDENCY_TREE_EXCLUDE=node_modules/some-lib
 */
export function shouldTransformPath(path, extensions = ['.ts', '.js']) {
  // 去除查询参数（如 ?t=timestamp）
  const [actualPath] = path.split('?');

  // 检查扩展名
  const hasValidExtension = extensions.some(ext => actualPath.endsWith(ext));
  if (!hasValidExtension) {
    return false;
  }

  // 1. 检查 INCLUDE 路径（优先级最高，即使在 node_modules 中也处理）
  const includePaths = process.env.DEPENDENCY_TREE_INCLUDE;
  if (includePaths) {
    const paths = includePaths.split(',').map(p => p.trim());
    if (paths.some(p => actualPath.includes(p))) {
      return true; // 明确包含，直接返回 true
    }
  }

  // 2. 检查 EXCLUDE 路径（优先级第二）
  const excludePaths = process.env.DEPENDENCY_TREE_EXCLUDE;
  if (excludePaths) {
    const paths = excludePaths.split(',').map(p => p.trim());
    if (paths.some(p => actualPath.includes(p))) {
      return false; // 明确排除
    }
  }

  // 3. 默认规则：排除所有 node_modules，除非明确 INCLUDE
  if (actualPath.includes('/node_modules/')) {
    return false;
  }

  return true;
}

