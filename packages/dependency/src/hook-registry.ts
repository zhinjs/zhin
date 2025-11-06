/**
 * Hook 注册表和工厂系统
 * 允许中游开发者自定义和扩展 hooks
 */

import { Dependency } from './dependency.js';

/**
 * 当前正在加载的依赖栈
 */
const dependencyStack: Dependency[] = [];

/**
 * 设置当前正在加载的依赖
 */
export function setCurrentDependency(dep: Dependency | null): void {
  if (dep) {
    dependencyStack.push(dep);
  } else if (dependencyStack.length > 0) {
    dependencyStack.pop();
  }
}

/**
 * 获取当前正在加载的依赖
 */
function getCurrentDependency(): Dependency | null {
  return dependencyStack.length > 0 ? dependencyStack[dependencyStack.length - 1] : null;
}

/**
 * Hook 函数类型定义
 */
export type HookFunction<T extends any[] = any[]> = (...args: T) => any;

/**
 * 内置 Hooks 接口定义
 * 中游开发者可以通过 module augmentation 扩展此接口
 * 
 * @example
 * ```ts
 * // 在你的库中扩展
 * declare module 'dependency-tree-analyzer' {
 *   interface Hooks {
 *     logger: (message: string, level?: 'info' | 'warn' | 'error') => void;
 *     onBeforeMount: (callback: () => void) => void;
 *   }
 * }
 * ```
 */
export interface Hooks {
  addListener: (event: string, listener: () => void) => () => void;
  onMount: (hook: () => void | Promise<void>) => void;
  onDispose: (hook: () => void | Promise<void>,inner?:boolean) => void;
  importModule: (path: string) => Promise<void>;
}

/**
 * Hook 配置
 */
export interface HookConfig<T extends any[] = any[]> {
  name: string;
  handler: (dependency: Dependency, ...args: T) => any;
  description?: string;
}

/**
 * Hook 注册表
 */
class HookRegistry {
  private hooks: Map<string, HookConfig> = new Map();
  private currentDependencyGetter: (() => Dependency | null) | null = null;

  /**
   * 设置获取当前 Dependency 的函数
   */
  setCurrentDependencyGetter(getter: () => Dependency | null): void {
    this.currentDependencyGetter = getter;
  }

  /**
   * 获取当前 Dependency
   */
  getCurrentDependency(): Dependency | null {
    return this.currentDependencyGetter?.() || null;
  }

  /**
   * 注册一个新的 hook
   */
  registerHook<T extends any[] = any[]>(config: HookConfig<T>): void {
    if (this.hooks.has(config.name)) {
      console.warn(`Hook "${config.name}" is already registered. Overwriting...`);
    }
    this.hooks.set(config.name, config);
  }

  /**
   * 取消注册 hook
   */
  unregisterHook(name: string): boolean {
    return this.hooks.delete(name);
  }

  /**
   * 检查 hook 是否已注册
   */
  has(name: string): boolean {
    return this.hooks.has(name);
  }

  /**
   * 获取 hook 配置
   */
  get(name: string): HookConfig | undefined {
    return this.hooks.get(name);
  }

  /**
   * 获取所有已注册的 hook 名称
   */
  getAllHookNames(): string[] {
    return Array.from(this.hooks.keys());
  }

  /**
   * 创建一个 hook 函数（支持类型推断）
   */
  useHook<K extends keyof Hooks>(name: K): Hooks[K];
  useHook<T extends any[] = any[]>(name: string): HookFunction<T>;
  useHook(name: string): any {
    return (...args: any[]) => {
      const config = this.hooks.get(name);
      if (!config) {
        throw new Error(`Hook "${name}" is not registered. Please registerHook it first using registerHook().`);
      }

      const currentDep = this.getCurrentDependency();
      if (!currentDep) {
        console.warn(`No current dependency context for hook "${name}".`);
        return;
      }

      return config.handler(currentDep, ...args);
    };
  }

  /**
   * 清空所有 hooks
   */
  clear(): void {
    this.hooks.clear();
  }
}

/**
 * 全局 Hook 注册表实例
 */
export const hookRegistry = new HookRegistry();

// 将 getCurrentDependency 注入到 hook 注册表
hookRegistry.setCurrentDependencyGetter(getCurrentDependency);
/**
 * 注册自定义 hook
 * @example
 * ```ts
 * registerHook({
 *   name: 'onUpdate',
 *   handler: (dep, callback) => {
 *     dep.addUpdateHook?.(callback);
 *   },
 *   description: 'Hook for dependency updates'
 * });
 * 
 * // 然后使用
 * const onUpdate = useHook('onUpdate');
 * onUpdate(() => console.log('Updated!'));
 * ```
 */
export function registerHook<T extends any[] = any[]>(config: HookConfig<T>): void {
  hookRegistry.registerHook(config);
}

/**
 * 取消注册 hook
 */
export function unregisterHook(name: string): boolean {
  return hookRegistry.unregisterHook(name);
}

/**
 * 创建一个自定义 hook 函数（支持类型推断）
 * @example
 * ```ts
 * // 自动推断内置 hooks 类型
 * const onMount = useHook('onMount'); // 类型自动推断
 * 
 * // 或手动指定类型
 * const myCustomHook = useHook<[string, number]>('myCustomHook');
 * myCustomHook('test', 123);
 * ```
 */
export function useHook<K extends keyof Hooks>(name: K): Hooks[K];
export function useHook<T extends any[] = any[]>(name: string): HookFunction<T>;
export function useHook(name: string): any {
  return hookRegistry.useHook(name);
}

/**
 * 检查 hook 是否已注册
 */
export function hasHook(name: string): boolean {
  return hookRegistry.has(name);
}

/**
 * 获取所有已注册的 hook 名称
 */
export function getAllHooks(): string[] {
  return hookRegistry.getAllHookNames();
}

