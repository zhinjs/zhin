/**
 * Plugin 类 — IM 特化插件，继承 PluginBase
 *
 * 在 PluginBase 的 DI/生命周期/事件基础上增加：
 * - Context 类型安全（Plugin.Contexts 映射）
 * - 生命周期事件类型安全（Plugin.Lifecycle）
 * - 中间件系统、适配器管理、useContext 等
 */

import { MessageMiddleware, RegisteredAdapter, MaybePromise, ArrayItem, SendOptions, MessageSendPayload, type PluginManifest } from './types.js';
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import logger, { Logger, formatCompact } from "@zhin.js/logger";
import { compose, remove, resolveEntry } from "./utils.js";
import {
  ensureInteractiveMiddleware,
  registerInteractiveHandler as registerInteractiveHandlerCore,
} from "./built/interactive-segments/handlers.js";
import type { InteractiveHandler } from "./built/interactive-segments/types.js";

import { Adapter, Adapters } from "./adapter.js";
import { Feature, PluginBase, BaseContext, PluginBaseLifecycle, resolvePluginResolveDir as _resolvePluginResolveDir, pluginCreateRequire as _pluginCreateRequire, getFileHash, watchFile, registerExtension, unregisterExtensions, installExtensionProxy, type PluginLike } from '@zhin.js/kernel';


import { storage, getCurrentFile } from "./plugin-context.js";

// Re-export getPlugin from plugin-context for backward compatibility
export { getPlugin } from "./plugin-context.js";
export { storage, getCurrentFile } from "./plugin-context.js";
export { setHostRootPlugin, getHostRootPlugin } from "./host-plugin-registry.js";

const contextsKey = Symbol("contexts");

function resolvePluginResolveDir(parent?: Plugin): string {
  return _resolvePluginResolveDir(parent);
}
const loadedModules = new Map<string, Plugin>();
function pluginCreateRequire(): ReturnType<typeof _pluginCreateRequire> {
  return _pluginCreateRequire();
}


export type SideEffect<A extends (keyof Plugin.Contexts)[]> = {
  (...args: ContextList<A>): MaybePromise<void | DisposeFn<ContextList<A>>>;
  finished?: boolean
}
export type DisposeFn<A> = (context: ArrayItem<A>) => MaybePromise<void>
export type ContextList<CS extends (keyof Plugin.Contexts)[]> = CS extends [infer L, ...infer R] ? R extends (keyof Plugin.Contexts)[] ? [ContextItem<L>, ...ContextList<R>] : never[] : never[]
type ContextItem<L> = L extends keyof Plugin.Contexts ? Plugin.Contexts[L] : never

// ============================================================================
// usePlugin — 获取或创建当前插件实例
// ============================================================================

/**
 * usePlugin - 获取或创建当前插件实例
 * 类似 React Hooks 的设计，根据调用文件自动创建插件树
 * 同一上下文中同一文件多次调用返回同一实例
 */
export function usePlugin(): Plugin {
  // 必须传入 plugin.ts 的 import.meta.url：getCurrentFile 默认锚定在 plugin-context.ts，
  // 否则会多跳一层 usePlugin 帧，把调用方误判为 plugin.ts（plugin.name === "plugin"）。
  const callerFile = getCurrentFile(import.meta.url);
  // 如果当前 store 已是同一文件创建的插件，直接返回
  const current = storage.getStore();
  if (current && current.filePath.replace(/\?t=\d+$/, '') === callerFile.replace(/\?t=\d+$/, '')) {
    return current;
  }
  const parentPlugin = current;
  const newPlugin = new Plugin(callerFile, parentPlugin);
  try {
    storage.enterWith(newPlugin);
  } catch {
    // Cloudflare Workers 等环境未实现 enterWith；调用方须用 storage.run()
  }
  return newPlugin;
}

// ============================================================================
// Plugin 类
// ============================================================================

export interface Plugin extends Plugin.Extensions {
  on<K extends keyof Plugin.Lifecycle>(name: K, listener: (...args: Plugin.Lifecycle[K]) => void): this;
  on(name: string | symbol, listener: (...args: any[]) => void): this;
  off<K extends keyof Plugin.Lifecycle>(name: K, listener: (...args: Plugin.Lifecycle[K]) => void): this;
  off(name: string | symbol, listener: (...args: any[]) => void): this;
  once<K extends keyof Plugin.Lifecycle>(name: K, listener: (...args: Plugin.Lifecycle[K]) => void): this;
  once(name: string | symbol, listener: (...args: any[]) => void): this;
  emit<K extends keyof Plugin.Lifecycle>(name: K, ...args: Plugin.Lifecycle[K]): boolean;
  emit(name: string | symbol, ...args: any[]): boolean;
}
/**
 * Plugin 类 - IM 特化插件，继承 PluginBase
 *
 * 类型窄化：
 * - children: Plugin[] (而非 PluginBase[])
 * - parent: Plugin | undefined
 * - root: Plugin
 * - $contexts: Map<string, Context<any>>
 * - dispatch/broadcast: Plugin.Lifecycle 类型安全
 */
export class Plugin extends PluginBase implements PluginLike {
  static [contextsKey] = [] as string[];

  #cachedName?: string;
  #manifest?: PluginManifest | null;
  adapters: (keyof Plugin.Contexts)[] = [];
  declare started: boolean;

  // children/parent 继承 PluginBase 的类型（PluginBase[] / PluginBase | undefined），
  // 具体的 Plugin 类型通过 getter/builder 方法按需窄化
  override get root(): Plugin {
    return super.root as Plugin;
  }

  // 默认中间件：将入站消息交给 compose 链末端的 MessageDispatcher（命令/AI 路由在 dispatcher 内完成）
  #messageMiddleware: MessageMiddleware<RegisteredAdapter> = async (_message, next) => {
    await next();
  };
  #middlewares: MessageMiddleware<RegisteredAdapter>[] = [this.#messageMiddleware];

  get middleware(): MessageMiddleware<RegisteredAdapter> {
    return compose<RegisteredAdapter>(this.#middlewares);
  }
  /**
   * 构造函数
   */
  constructor(filePath: string = "", parent?: Plugin) {
    super(filePath, parent as PluginBase | undefined);

    // 自动添加到父节点 — PluginBase constructor 已处理，
    // 但 PluginBase 使用 PluginBase[]，这里需要确保正确
    // （super 已调用 parent.children.push(this)，类型已通过 declare 窄化）

    // 绑定方法以支持解构使用
    this.$bindMethods();
  }

  // 标记是否已绑定方法
  #methodsBound = false;

  /**
   * 添加中间件
   * 中间件用于处理消息流转
   */
  addMiddleware<T extends RegisteredAdapter>(middleware: MessageMiddleware<T>, name?: string) {
    this.#middlewares.push(middleware as MessageMiddleware<RegisteredAdapter>);
    const dispose = () => remove(this.#middlewares, middleware);
    this.onDispose(dispose);
    return dispose;
  }

  /**
   * 注册交互式 action 回调处理器（自动安装根中间件，优先于 Dispatcher）
   */
  registerInteractiveHandler(prefix: string, handler: InteractiveHandler): () => void {
    ensureInteractiveMiddleware((mw) => this.root.addMiddleware(mw));
    const dispose = registerInteractiveHandlerCore(prefix, handler);
    this.onDispose(dispose);
    return dispose;
  }

  /**
   * 插件名称
   */
  get name(): string {
    if (this.#cachedName) return this.#cachedName;

    this.#cachedName = path
      .relative(process.cwd(), this.filePath)
      .replace(/\?t=\d+$/, "")
      .replace(/\\/g, "/")
      .replace(/\/index\.(js|ts)x?$/, "")
      .replace(/\/(lib|src|dist)$/, "")
      .replace(/.*\/node_modules\//, "")
      .replace(/.*\//, "")
      .replace(/\.(js|ts)x?$/, "");

    return this.#cachedName;
  }

  /**
   * 插件清单（从 plugin.yml 或 package.json 延迟读取）
   */
  get manifest(): PluginManifest | undefined {
    if (this.#manifest !== undefined) return this.#manifest ?? undefined;
    if (!this.filePath) {
      this.#manifest = null;
      return undefined;
    }
    const dir = path.dirname(this.filePath);
    // 优先读取 plugin.yml
    const ymlPath = path.join(dir, 'plugin.yml');
    if (fs.existsSync(ymlPath)) {
      try {
        const content = fs.readFileSync(ymlPath, 'utf-8');
        const match = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*(.+)$/m);
        const verMatch = content.match(/^version:\s*(.+)$/m);
        if (match) {
          this.#manifest = {
            name: match[1].trim(),
            description: descMatch?.[1]?.trim(),
            version: verMatch?.[1]?.trim(),
          };
          return this.#manifest;
        }
      } catch { /* ignore */ }
    }
    // Fallback: package.json
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) {
          this.#manifest = {
            name: pkg.name,
            description: pkg.description,
            version: pkg.version,
          };
          return this.#manifest;
        }
      } catch { /* ignore */ }
    }
    this.#manifest = null;
    return undefined;
  }

  // 根插件类型窄化已在 interface Plugin 声明

  /**
   * 上下文收集 — 使用类型窄化的 inject 替代直接 Map 访问
   */


  useContext<T extends (keyof Plugin.Contexts)[]>(...args: [...T, SideEffect<T>]) {
    const contexts = args.slice(0, -1) as T
    const sideEffect = args[args.length - 1] as SideEffect<T>
    const contextReadyCallback = async () => {
      if (sideEffect.finished) return;
      sideEffect.finished = true;
      const args = contexts.map(item => this.inject(item))
      const dispose = await sideEffect(...args as ContextList<T>)
      if (!dispose) return;
      const disposeFn = async (name: keyof Plugin.Contexts) => {
        if (!contexts.includes(name)) return;
        await dispose(this.inject(name) as any)
        this.off('context.dispose', disposeFn)
        sideEffect.finished = false;
      }
      this.on('context.dispose', disposeFn)
      // 确保 dispose 时清理监听器（只注册一次）
      const cleanupOnDispose = () => {
        this.off('context.dispose', disposeFn)
        dispose(this.inject(args[0] as any) as any)
      }
      this.once('dispose', cleanupOnDispose)
    }
    const onContextMounted = async (name: keyof Plugin.Contexts) => {
      if (!this.#contextsIsReady(contexts) || !(contexts).includes(name)) return
      await contextReadyCallback()
    }
    this.on('context.mounted', onContextMounted)
    // 插件销毁时移除 context.mounted 监听器
    this.once('dispose', () => this.off('context.mounted', onContextMounted))
    if (!this.#contextsIsReady(contexts)) return
    contextReadyCallback()
  }
  inject<T extends keyof Plugin.Contexts>(name: T): Plugin.Contexts[T]|undefined;
  inject(name: string): unknown;
  inject(name: string): unknown {
    const resolved = name === 'cron' ? 'schedule' : name;
    const context = this.root.contexts.get(resolved);
    return context?.value;
  }

  injectAdapter(name: string): Adapter | undefined {
    const value = this.inject(name);
    return value instanceof Adapter ? value : undefined;
  }
  #contextsIsReady<CS extends (keyof Plugin.Contexts)[]>(contexts: CS) {
    if (!contexts.length) return true
    return contexts.every(name => this.contextIsReady(name))
  }
  contextIsReady<T extends keyof Plugin.Contexts>(name: T) {
    try {
      return !!this.inject(name)
    } catch {
      return false
    }
  }
  // ============================================================================
  // 生命周期方法
  // ============================================================================

  /**
   * 启动插件
   * 覆盖 PluginBase.start() 以支持 Context 挂载失败回滚
   */
  override async start(t?: number): Promise<void> {
    if (this.started) return;
    // 先挂载所有 Context（带回滚），再标记 started
    await this.mountAllContexts();
    this.started = true;

    await this.broadcast("mounted");
    for (const child of this.children) {
      await child.start(t);
    }
    if (t) {
      this.logger.debug(formatCompact({ name: this.name, reload_ms: Date.now() - t }));
    }
  }

  /**
   * 覆盖 mountAllContexts：支持部分失败回滚
   */
  protected override async mountAllContexts(): Promise<void> {
    const mountedContexts: Array<{ name: string; context: BaseContext }> = [];
    for (const [name, context] of this.$contexts) {
      try {
        await this.mountContext(context);
        mountedContexts.push({ name, context });
      } catch (e) {
        this.logger.warn(`Context "${name}" mount failed: ${e}, rolling back ${mountedContexts.length} mounted contexts`);
        for (let i = mountedContexts.length - 1; i >= 0; i--) {
          const { name: mName, context: mCtx } = mountedContexts[i];
          try {
            if (mCtx.extensions) unregisterExtensions(Object.keys(mCtx.extensions));
            if (typeof mCtx.dispose === 'function') await mCtx.dispose(mCtx.value);
          } catch (disposeErr) {
            this.logger.warn(`Rollback dispose for "${mName}" failed: ${disposeErr}`);
          }
        }
        throw e;
      }
    }
    for (const { name } of mountedContexts) {
      this.dispatch('context.mounted', name as keyof Plugin.Contexts);
    }
  }
  /**
   * 获取插件提供的功能
   * 从各个服务中获取数据
   */
  get features(): Plugin.Features {
    const commandService = this.inject('command');
    const componentService = this.inject('component')
    const scheduleService = this.inject('schedule');

    return {
      commands: commandService ? commandService.items.map(c => c.pattern) : [],
      components: componentService ? componentService.getAllNames() : [],
      schedules: scheduleService ? scheduleService.items.map(s => s.id) : [],
      middlewares: this.#middlewares.map((m, i) => m.name || `middleware_${i}`),
    };
  }

  /**
   * 获取插件功能摘要（数组形式）
   * 返回各功能类型的名称和数量
   */
  getFeatures(): Array<{ name: string; count: number }> {
    const result: Array<{ name: string; count: number }> = [];
    const f = this.features;
    if (f.commands.length > 0) result.push({ name: 'command', count: f.commands.length });
    if (f.components.length > 0) result.push({ name: 'component', count: f.components.length });
    if (f.schedules.length > 0) result.push({ name: 'schedule', count: f.schedules.length });
    // #middlewares includes the default command middleware, only count user-added ones
    const userMiddlewareCount = this.#middlewares.length - 1; // subtract default #messageMiddleware
    if (userMiddlewareCount > 0) result.push({ name: 'middleware', count: userMiddlewareCount });
    // Tool count is now tracked via ToolFeature, not Plugin#tools
    return result;
  }

  info(): Record<string, any> {
    return {
      [this.name]: {
        features: this.features,
        children: (this.children as Plugin[]).map(child => child.info())
      }
    }
  }

  /**
   * 停止插件
   * 委托 PluginBase.stop() 处理通用清理，仅补充 IM 特化逻辑
   */
  override async stop(): Promise<void> {
    if (!this.started) return;
    this.logger.debug(`Stopping plugin "${this.name}"`);

    // 通用清理（子插件、contexts、disposables、loadedModules 等）
    await super.stop();

    // IM 特化：重置中间件（保留默认消息中间件）
    this.#middlewares.length = 1;
  }

  // ============================================================================
  // 生命周期钩子
  // ============================================================================

  onMounted(callback: () => void | Promise<void>): void {
    this.on("mounted", callback);
  }

  // onDispose 继承自 PluginBase

  // ============================================================================
  // 事件广播
  // ============================================================================

  /**
   * dispatch - 向上冒泡到父插件，或者在根节点广播（类型安全版本）
   */
  async dispatch<K extends keyof Plugin.Lifecycle>(
    name: K,
    ...args: Plugin.Lifecycle[K]
  ): Promise<void> {
    if (this.parent) {
      return (this.parent as Plugin).dispatch(name, ...args);
    }
    return this.broadcast(name, ...args);
  }

  /**
   * broadcast - 向下广播到所有子插件（类型安全版本）
   */
  async broadcast<K extends keyof Plugin.Lifecycle>(
    name: K,
    ...args: Plugin.Lifecycle[K]
  ): Promise<void> {
    const listeners = this.listeners(name as any) as ((...args: any[]) => any)[];
    for (const listener of listeners) {
      try {
        await listener(...args);
      } catch (e) {
        this.logger.warn(`Broadcast "${String(name)}" listener error: ${e}`);
      }
    }

    for (const child of this.children) {
      await (child as Plugin).broadcast(name, ...args);
    }
  }

  // ============================================================================
  // 依赖注入
  // ============================================================================

  /**
   * 注册上下文（类型安全版本）
   */
  override provide(target: any): this {
    if (target instanceof Feature) {
      const feature = target;
      const ctx: BaseContext = {
        name: feature.name,
        description: feature.desc,
        value: feature,
        mounted: feature.mounted
          ? async (plugin: PluginBase) => {
              await feature.mounted!(plugin);
              return feature;
            }
          : undefined,
        dispose: feature.dispose
          ? async () => { await feature.dispose!(); }
          : undefined,
        extensions: feature.extensions,
      };
      return this.provide(ctx as Context<keyof Plugin.Contexts>);
    }
    const context = target as Context<keyof Plugin.Contexts>;
    if (!Plugin[contextsKey].includes(context.name as string)) {
      Plugin[contextsKey].push(context.name as string);
    }
    this.logger.debug(`Context "${context.name as string}" provided`);
    this.$contexts.set(context.name as string, context as unknown as BaseContext);
    // 注册扩展方法到共享 registry，确保后续 import 的插件可用
    if (context.extensions) {
      installExtensionProxy(Plugin.prototype);
      for (const [name, fn] of Object.entries(context.extensions)) {
        if (typeof fn === 'function') {
          registerExtension(name, fn as (...args: any[]) => any);  
        }
      }
    }
    return this;
  }

  // ============================================================================
  // 插件加载
  // ============================================================================

  /**
   * 导入插件（Plugin 类型窄化版本）
   */
  override async import(entry: string, t?: number): Promise<Plugin> {
    if (!entry) throw new Error(`import plugin failed: entry is empty`);
    const resolved = resolveEntry(path.isAbsolute(entry) ?
      entry :
      path.resolve(path.dirname(this.filePath), entry)) || entry;
    let realPath: string;
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      realPath = resolved;
    }
    // 避免重复加载同一路径的插件
    const normalized = realPath.replace(/\?t=\d+$/, '').replace(/\\/g, '/');
    const existing = (this.children as Plugin[]).find(child =>
      child.filePath.replace(/\?t=\d+$/, '').replace(/\\/g, '/') === normalized
    );
    if (existing) {
      this.logger.warn(`Plugin "${entry}" already loaded, skipping...`);
      if (this.started && !existing.started) await existing.start(t);
      return existing;
    }

    const plugin = await Plugin.create(realPath, this);
    if (this.started) await plugin.start(t);

    if (process.env.NODE_ENV === 'development') {
      plugin.watch((p) => (p as Plugin).reload())
    }
    return plugin;
  }

  /**
   * 重载插件（Plugin 类型窄化版本）
   */
  override async reload(plugin: PluginBase = this): Promise<void> {
    const p = plugin as Plugin;
    this.logger.info(formatCompact( { name: p.name, reload: true }));
    const now = Date.now();
    if (!p.parent) {
      // 根插件重载 = 退出进程（由 CLI 重启）
      return process.exit(51);
    }

    const entry = p.filePath;
    const parent = p.parent as Plugin;
    await p.stop();
    let fresh: Plugin;
    try {
      fresh = await parent.import(entry, now) as Plugin;
    } catch (err) {
      this.logger.error(formatCompact({
        name: p.name,
        reload: false,
        error: err instanceof Error ? err.message : String(err),
        hint: 'full_restart',
      }));
      throw err;
    }
    await fresh.broadcast('mounted');
    this.logger.debug(formatCompact({ name: fresh.name, reload_ms: Date.now() - now }));
  }

  /**
   * 监听文件变化（Plugin 类型窄化版本）
   */
  override watch(
    callback: (p: PluginBase) => void | Promise<void>,
    recursive = false
  ): void {
    if (!this.filePath || this.filePath.includes("node_modules")) return;

    const unwatch = watchFile(this.filePath, (() => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          const newHash = getFileHash(this.filePath);
          if (newHash === this.fileHash) return;

          this.logger.debug(`Plugin "${this.name}" file changed, reloading...`);
          callback(this);
          this.fileHash = newHash;
        }, 300);
      };
    })());

    this.on("dispose", unwatch);

    if (recursive) {
      for (const child of this.children) {
        child.watch(callback, recursive);
      }
    }
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  // 核心方法列表（需要绑定的方法）
  static #coreMethods = new Set([
    'addMiddleware', 'useContext', 'inject', 'contextIsReady',
    'start', 'stop', 'onMounted', 'onDispose',
    'dispatch', 'broadcast', 'provide', 'import', 'reload', 'watch', 'info'
  ]);

  /**
   * 自动绑定核心方法（只在构造函数中调用一次）
   */
  $bindMethods(): void {
    if (this.#methodsBound) return;
    this.#methodsBound = true;

    const proto = Object.getPrototypeOf(this);
    for (const key of Plugin.#coreMethods) {
      const value = proto[key];
      if (typeof value === "function") {
        (this as any)[key] = value.bind(this);
      }
    }
  }

  // ============================================================================
  // 静态方法
  // ============================================================================

  /**
   * 创建插件实例（异步加载）
   */
  static async create(entry: string, parent?: Plugin): Promise<Plugin> {
    entry = path.resolve(resolvePluginResolveDir(parent), entry);
    const entryFile = fs.existsSync(entry) ? entry : pluginCreateRequire().resolve(entry);
    const realPath = fs.realpathSync(entryFile);

    // 检查模块是否已加载（跳过热重载后已 stop 的僵尸实例）
    const existing = loadedModules.get(realPath);
    if (existing?.started) {
      return existing;
    }
    if (existing) {
      loadedModules.delete(realPath);
    }

    const plugin = new Plugin(realPath, parent);
    plugin.fileHash = getFileHash(entryFile);

    // 先记录，防止循环依赖时重复加载
    loadedModules.set(realPath, plugin);

    // 注意：?t= cache-busting 会导致 Node ESM 模块缓存累积旧条目。
    // 这是 Node.js ESM 的已知限制——没有公开 API 可以逐出 ESM 模块缓存。
    // 在生产环境中插件只加载一次，不会触发此问题；
    // 开发环境中热重载会累积，但仅影响开发进程，重启即释放。
    await storage.run(plugin, async () => {
      await import(`${pathToFileURL(entryFile).href}?t=${Date.now()}`);
    });

    return plugin;
  }
}
export function defineContext<T extends keyof Plugin.Contexts, E extends Partial<Plugin.Extensions> = {}>(options: Context<T, E>): Context<T, E> {
  return options;
}
export interface Context<T extends keyof Plugin.Contexts = keyof Plugin.Contexts, E extends Partial<Plugin.Extensions> = {}> {
  name: T;
  description: string
  value?: Plugin.Contexts[T];
  mounted?: (parent: Plugin) => Plugin.Contexts[T] | Promise<Plugin.Contexts[T]>;
  dispose?: (value: Plugin.Contexts[T]) => void;
  /** 扩展方法，会自动挂载到 Plugin.prototype 上 */
  extensions?: E;
}
// ============================================================================
// 类型定义
// ============================================================================
export namespace Plugin {
  /**
   * 插件提供的功能
   */
  export interface Features {
    commands: string[];
    components: string[];
    schedules: string[];
    middlewares: string[];
  }

  /**
   * 生命周期事件
   *
   * 必须包含索引签名以满足 PluginBaseLifecycle 结构子类型约束。
   */
  export interface Lifecycle extends PluginBaseLifecycle {
    "before-mount": [Plugin];
    "before-dispose": [Plugin];
    "context.mounted": [keyof Plugin.Contexts];
    "context.dispose": [keyof Plugin.Contexts];
    "call.recallMessage": [string, string, string];
    'before.sendMessage': [SendOptions];
    'message.send': [MessageSendPayload];
    "message.receive": [import('./message.js').Message];
    "endpoint.login.pending": [import('./built/login-assist.js').PendingLoginTask];
    'endpoint.connect': [import('./built/endpoint-lifecycle.js').EndpointLifecyclePayload];
    'endpoint.disconnect': [import('./built/endpoint-lifecycle.js').EndpointLifecyclePayload];
    'endpoint.error': [import('./built/endpoint-lifecycle.js').EndpointLifecyclePayload];
    "request.receive": [import('./request.js').Request];
    "notice.receive": [import('./notice.js').Notice];
    "ai.processing.start": [Plugin.AIEventPayload];
    "ai.processing.finish": [Plugin.AIEventPayload];
    "ai.processing.error": [Plugin.AIEventPayload];
    "ai.agent.start": [Plugin.AIEventPayload];
    "ai.agent.finish": [Plugin.AIEventPayload];
    "ai.thinking": [Plugin.AIEventPayload];
    "ai.tool.call": [Plugin.AIEventPayload];
    "ai.tool.result": [Plugin.AIEventPayload];
    "ai.response": [Plugin.AIEventPayload];
    "ai.typing.start": [Plugin.AIEventPayload];
    "ai.typing.stop": [Plugin.AIEventPayload];
    "ai.activity.queued.start": [Plugin.AIEventPayload];
    "ai.activity.queued.clear": [Plugin.AIEventPayload];
    "ai.subagent.spawn": [Plugin.AIEventPayload];
    "ai.subagent.start": [Plugin.AIEventPayload];
    "ai.subagent.finish": [Plugin.AIEventPayload];
    "ai.deferred.start": [Plugin.AIEventPayload];
    "ai.deferred.finish": [Plugin.AIEventPayload];
    "ai.mcp.connect.start": [Plugin.AIEventPayload];
    "ai.mcp.connect.finish": [Plugin.AIEventPayload];
    "ai.mcp.connect.error": [Plugin.AIEventPayload];
    "ai.session.new": [Plugin.AIEventPayload];
    "ai.session.compact": [Plugin.AIEventPayload];
    "ai.hook": [Plugin.AIEventPayload];
    "schedule.start": [Plugin.AIEventPayload];
    "schedule.finish": [Plugin.AIEventPayload];
    "schedule.error": [Plugin.AIEventPayload];
  }

  export interface AIEventPayload {
    sessionId: string;
    source: 'zhin-agent' | 'subagent' | 'ai-hook' | 'orchestrator-hook';
    mode?: 'text' | 'multimodal';
    path?: 'chat' | 'fast' | 'agent' | 'multimodal' | 'rate_limited';
    userId?: string;
    platform?: string;
    endpointId?: string;
    sceneId?: string;
    messageId?: string;
    scope?: string;
    content?: string;
    reply?: string;
    thinking?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    model?: string;
    iterations?: number;
    reason?: string;
    taskId?: string;
    label?: string;
    status?: 'ok' | 'partial' | 'error';
    serverName?: string;
    loadedToolNames?: string[];
    hookType?: string;
    hookAction?: string;
    hookContext?: Record<string, unknown>;
    messages?: string[];
    agentId?: string;
    compactedCount?: number;
    savedTokens?: number;
    totalTokensBefore?: number;
    totalTokensAfter?: number;
    /** 为 true 时 processing.finish 不撤回 typing（route 子 agent → 主 agent 摘要续接） */
    keepTyping?: boolean;
  }

  /**
   * 服务类型扩展点
   * 各个 Context 通过 declare module 扩展此接口
   */
  export interface Contexts extends Adapters {}

  /**
   * Service 扩展方法类型
   * 这些方法由各个 Context 的 extensions 提供
   * 在 Plugin.start() 时自动注册到 Plugin.prototype
   */
  export interface Extensions {}
}
