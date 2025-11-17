import { Dependency } from './dependency.js';
import { registerHook, useHook } from './hook-registry.js';


// ==================== 注册内置 Hooks ====================

/**
 * 内置 Hook: addListener
 * 添加事件监听器到当前 Dependency
 */
registerHook({
  name: 'addListener',
  handler: (dep: Dependency, event: string, listener: () => void) => {
    dep.on(event, listener);
    return () => dep.off(event, listener);
  },
  description: 'Add an event listener to the current dependency'
});

/**
 * 内置 Hook: onMount
 * 添加挂载钩子
 */
registerHook({
  name: 'onMount',
  handler: (dep: Dependency, hook: () => void | Promise<void>) => {
    dep.addMountHook(hook);
  },
  description: 'registerHook a mount hook for the current dependency'
});
registerHook({
  name: 'useDependency',
  handler: (dep: Dependency) => {
    return dep;
  },
  description: 'use the current dependency'
})

/**
 * 内置 Hook: onDispose
 * 添加卸载钩子
 */
registerHook({
  name: 'onDispose',
  handler: (dep: Dependency, hook: () => void | Promise<void>, inner: boolean = false) => {
    dep.addDisposeHook(hook, inner);
  },
  description: 'registerHook a dispose hook for the current dependency'
});

/**
 * 内置 Hook: importModule
 * 导入模块并创建子 Dependency
 */
registerHook({
  name: 'importModule',
  handler: async (dep: Dependency, importPath: string,importModulePath?:string) => {
    await dep.importChild(importPath,importModulePath);
  },
  description: 'Import a module and create a child dependency'
});

// ==================== 导出便捷函数（使用 Hook 系统）====================

/**
 * 添加事件监听器
 * 会自动添加到当前正在加载的 Dependency 实例中
 * 使用 EventEmitter 的 on 方法
 */
export function addListener(event: string, listener: () => void): () => void {
  return useHook('addListener')(event, listener);
}
export function useDependency(): Dependency {
  return useHook('useDependency')();
}
/**
 * 添加挂载钩子
 * 会在依赖启动后自动执行
 */
export function onMount(hook: () => void | Promise<void>): void {
  return useHook('onMount')(hook);
}

/**
 * 添加卸载钩子
 * 会在依赖停止时自动执行
 * @param hook - 卸载钩子函数
 * @param inner - 是否为内部钩子（在生命周期监听器清理前执行，用于副作用清理）
 */
export function onDispose(hook: () => void | Promise<void>, inner: boolean = false): void {
  return useHook('onDispose')(hook, inner);
}

/**
 * 导入模块并自动创建子 Dependency
 * 在模块中使用此函数替代普通的 import
 */
export async function importModule(importPath: string,importModulePath?:string): Promise<void> {
  return useHook('importModule')(importPath,importModulePath);
}

// ==================== 导出 Hook 系统 API ====================

export { 
  registerHook, 
  unregisterHook, 
  useHook, 
  hasHook, 
  getAllHooks 
} from './hook-registry.js';