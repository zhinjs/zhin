/**
 * Plugin 类 - 基于 zhinjs/next 的 Hooks 实现
 * 移除 Dependency 继承，使用 AsyncLocalStorage 管理上下文
 */

import { AsyncLocalStorage } from "async_hooks";
import { EventEmitter } from "events";
import { createRequire } from "module";
import type { Database, Definition } from "@zhin.js/database";
import { Schema } from "@zhin.js/schema";
import type { Models, RegisteredAdapters } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import logger, { Logger } from "@zhin.js/logger";
import { compose, remove, resolveEntry } from "./utils.js";
import { MessageMiddleware, RegisteredAdapter, MaybePromise, ArrayItem, ConfigService, PermissionService, SendOptions } from "./types.js";
import { Adapter } from "./adapter.js";
import { createHash } from "crypto";
const contextsKey = Symbol("contexts");
const loadedModules = new Map<string, Plugin>(); // 记录已加载的模块
const require = createRequire(import.meta.url);


export type SideEffect<A extends (keyof Plugin.Contexts)[]> = {
  (...args: ContextList<A>): MaybePromise<void | DisposeFn<ContextList<A>>>;
  finished?: boolean
}
export type DisposeFn<A> = (context: ArrayItem<A>) => MaybePromise<void>
export type ContextList<CS extends (keyof Plugin.Contexts)[]> = CS extends [infer L, ...infer R] ? R extends (keyof Plugin.Contexts)[] ? [ContextItem<L>, ...ContextList<R>] : never[] : never[]
type ContextItem<L> = L extends keyof Plugin.Contexts ? Plugin.Contexts[L] : never
// ============================================================================
// AsyncLocalStorage 上下文
// ============================================================================

export const storage = new AsyncLocalStorage<Plugin>();

/**
 * 获取当前文件路径（调用者）
 */
function getCurrentFile(metaUrl = import.meta.url): string {
  const previousPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function (_, stack) {
    return stack;
  };
  const stack = new Error().stack as unknown as NodeJS.CallSite[];
  Error.prepareStackTrace = previousPrepareStackTrace;
  const stackFiles = Array.from(
    new Set(stack.map((site) => site.getFileName()))
  );
  const idx = stackFiles.findIndex(
    (f) => f === fileURLToPath(metaUrl) || f === metaUrl
  );
  const result = stackFiles[idx + 1];
  if (!result) throw new Error("Cannot resolve current file path");
  try {
    return fileURLToPath(result);
  } catch {
    return result;
  }
}

/**
 * usePlugin - 获取或创建当前插件实例
 * 类似 React Hooks 的设计，根据调用文件自动创建插件树
 */
export function usePlugin(): Plugin {
  const callerFile = getCurrentFile();
  const parentPlugin = storage.getStore();
  const newPlugin = new Plugin(callerFile, parentPlugin);
  storage.enterWith(newPlugin);
  return newPlugin;
}

/**
 * getPlugin - 获取当前 AsyncLocalStorage 中的插件实例
 * 用于 extensions 等场景，不创建新插件
 */
export function getPlugin(): Plugin {
  const plugin = storage.getStore();
  if (!plugin) {
    throw new Error('getPlugin() must be called within a plugin context');
  }
  return plugin;
}

// ============================================================================
// 文件工具函数
// ============================================================================

/**
 * 获取文件 Hash（用于检测变更）
 */
function getFileHash(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return createHash("md5")
      .update(content)
      .digest("hex");
  } catch {
    return "";
  }
}

/**
 * 监听文件变化
 */
function watchFile(filePath: string, callback: () => void): () => void {
  try {
    const watcher = fs.watch(filePath, callback);
    watcher.on("error", (_error) => { });
    return () => watcher.close();
  } catch (error) {
    return () => { };
  }
}

// ============================================================================
// Plugin 类
// ============================================================================

export interface Plugin extends Plugin.Extensions { }
/**
 * Plugin 类 - 核心插件系统
 * 直接继承 EventEmitter
 */
export class Plugin extends EventEmitter<Plugin.Lifecycle> {
  static [contextsKey] = [] as string[];
  
  #cachedName?: string;
  adapters: (keyof Plugin.Contexts)[] = [];
  started = false;

  // 上下文存储
  $contexts: Map<string, Context<any>> = new Map();


  // 子插件
  children: Plugin[] = [];

  // 文件信息
  filePath: string;
  fileHash: string = "";

  // Logger
  logger: Logger;

  #messageMiddleware: MessageMiddleware<RegisteredAdapter> = async (message, next) => {
    const commandService = this.inject('command');
    if (!commandService) return await next();
    const result = await commandService.handle(message, this);
    if (!result) return await next();
    const adapter = this.inject(message.$adapter) as Adapter;
    if (!adapter || !(adapter instanceof Adapter)) return await next();
    await adapter.emit('call.sendMessage', message.$bot, {
      context: message.$adapter,
      bot: message.$bot,
      content: result,
      id: message.$channel.id,
      type: message.$channel.type,
    });
    await next();
  };
  // 插件功能
  #middlewares: MessageMiddleware<RegisteredAdapter>[] = [this.#messageMiddleware];
  
  // 统一的清理函数集合
  #disposables: Set<() => void | Promise<void>> = new Set();
  
  get middleware(): MessageMiddleware<RegisteredAdapter> {
    return compose<RegisteredAdapter>(this.#middlewares);
  }
  /**
   * 构造函数
   */
  constructor(filePath: string = "", public parent?: Plugin) {
    super();
    
    // 增加 EventEmitter 监听器限制，避免警告
    // 因为插件可能注册多个命令/组件/中间件，每个都会添加 dispose 监听器
    this.setMaxListeners(50);

    this.filePath = filePath.replace(/\?t=\d+$/, "");
    this.logger = this.name ? logger.getLogger(this.name) : logger;

    // 自动添加到父节点
    if (parent && !parent.children.includes(this)) {
      parent.children.push(this);
    }
    
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
    const dispose = () => {
      remove(this.#middlewares, middleware);
      this.#disposables.delete(dispose);
    };
    this.#disposables.add(dispose);
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
   * 根插件
   */
  get root(): Plugin {
    if (!this.parent) return this;
    return this.parent.root;
  }
  get contexts(): Map<string, Context> {
    const result = new Map<string, Context>();
    for (const [key, value] of this.$contexts) {
      result.set(key, value);
    }
    for (const child of this.children) {
      for (const [key, value] of child.contexts) {
        result.set(key, value);
      }
    }
    return result;
  }


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
        if (contexts.includes(name)) {
          await dispose(this.inject(name) as any)
        }
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
  inject<T extends keyof Plugin.Contexts>(name: T): Plugin.Contexts[T]|undefined {
    const context = this.root.contexts.get(name as string);
    return context?.value as Plugin.Contexts[T];
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
   */
  async start(t?:number): Promise<void> {
    if (this.started) return;
    this.started = true; // 提前设置，防止重复启动
    
    // 启动所有服务
    for (const context of this.$contexts.values()) {
      if (typeof context.mounted === "function" && !context.value) {
        context.value = await context.mounted(this);
      }
      // 注册扩展方法到 Plugin.prototype
      if (context.extensions) {
        for (const [name, fn] of Object.entries(context.extensions)) {
          if (typeof fn === 'function') {
            Reflect.set(Plugin.prototype, name, fn);
          }
        }
      }
      this.dispatch('context.mounted', context.name)
    }
    await this.broadcast("mounted");
    // 先启动子插件，再打印当前插件启动日志
    for (const child of this.children) {
      await child.start(t);
    }
    this.logger.info(`Plugin "${this.name}" ${t ? `reloaded in ${Date.now() - t}ms` : "started"}`);
  }
  /**
   * 获取插件提供的功能
   * 从各个服务中获取数据
   */
  get features(): Plugin.Features {
    const commandService = this.inject('command');
    const componentService = this.inject('component')
    const cronService = this.inject('cron');
    
    return {
      commands: commandService ? commandService.items.map(c => c.pattern) : [],
      components: componentService ? componentService.getAllNames() : [],
      crons: cronService ? cronService.items.map(c => c.cronExpression) : [],
      middlewares: this.#middlewares.map((m, i) => m.name || `middleware_${i}`),
    };
  }

  info(): Record<string, any> {
    return {
      [this.name]: {
        features: this.features,
        children: this.children.map(child => child.info())
      }
    }
  }

  /**
   * 停止插件
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.logger.debug(`Stopping plugin "${this.name}"`);
    this.started = false;

    // 停止子插件
    for (const child of this.children) {
      await child.stop();
    }
    this.children = [];

    // 停止服务
    for (const [name, context] of this.$contexts) {
      remove(Plugin[contextsKey], name);
      // 移除扩展方法
      if (context.extensions) {
        for (const key of Object.keys(context.extensions)) {
          delete (Plugin.prototype as any)[key];
        }
      }
      if (typeof context.dispose === "function") {
        await context.dispose(context.value);
      }
    }
    // 清理 contexts Map
    this.$contexts.clear();

// 清空缓存的名称
    this.#cachedName = undefined;

    // 触发 dispose 事件
    this.emit("dispose");
    
    // 执行所有清理函数
    for (const dispose of this.#disposables) {
      try {
        await dispose();
      } catch (e) {
        this.logger.warn(`Dispose callback failed: ${e}`);
      }
    }
    this.#disposables.clear();
    
    // 清理 middlewares 数组（保留默认的消息中间件）
    this.#middlewares.length = 1;
    
    if (this.parent) {
      remove(this.parent?.children, this);
    }
    this.removeAllListeners();
    this.logger.debug(`Plugin "${this.name}" stopped`);
  }

  // ============================================================================
  // 生命周期钩子
  // ============================================================================

  onMounted(callback: () => void | Promise<void>): void {
    this.on("mounted", callback);
  }

  onDispose(callback: () => void | Promise<void>): () => void {
    this.#disposables.add(callback);
    return () => {
      this.#disposables.delete(callback);
    };
  }

  // ============================================================================
  // 事件广播
  // ============================================================================

  /**
   * dispatch - 向上冒泡到父插件，或在根节点广播
   */
  async dispatch<K extends keyof Plugin.Lifecycle>(
    name: K,
    ...args: Plugin.Lifecycle[K]
  ): Promise<void> {
    if (this.parent) {
      return this.parent.dispatch(name, ...args);
    }
    return this.broadcast(name, ...args);
  }

  /**
   * broadcast - 向下广播到所有子插件
   */
  async broadcast<K extends keyof Plugin.Lifecycle>(
    name: K,
    ...args: Plugin.Lifecycle[K]
  ): Promise<void> {
    const listeners = this.listeners(name) as ((...args: any[]) => any)[];
    for (const listener of listeners) {
      await listener(...args);
    }

    for (const child of this.children) {
      await child.broadcast(name, ...args);
    }
  }

  // ============================================================================
  // 依赖注入
  // ============================================================================

  /**
   * 注册上下文
   */
  provide<T extends keyof Plugin.Contexts>(context: Context<T>): this {
    if (!Plugin[contextsKey].includes(context.name as string)) {
      Plugin[contextsKey].push(context.name as string);
    }
    this.logger.debug(`Context "${context.name as string}" provided`);
    this.$contexts.set(context.name as string, context);
    return this;
  }

  // ============================================================================
  // 插件加载
  // ============================================================================

  /**
   * 导入插件
   */
  async import(entry: string,t?:number): Promise<Plugin> {
    if (!entry) throw new Error(`Plugin entry not found: ${entry}`);
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
    const existing = this.children.find(child => 
      child.filePath.replace(/\?t=\d+$/, '').replace(/\\/g, '/') === normalized
    );
    if (existing) {
      this.logger.debug(`Plugin "${entry}" already loaded, skipping...`);
      if (this.started && !existing.started) await existing.start(t);
      return existing;
    }

    const plugin = await Plugin.create(realPath, this);
    if (this.started) await plugin.start(t);

    if (process.env.NODE_ENV === 'development') {
      plugin.watch((p) => p.reload())
    }
    return plugin;
  }

  /**
   * 重载插件
   */
  async reload(plugin: Plugin = this): Promise<void> {
    this.logger.info(`Plugin "${plugin.name}" reloading...`);
    const now=Date.now();
    if (!plugin.parent) {
      // 根插件重载 = 退出进程（由 CLI 重启）
      return process.exit(51);
    }

    await plugin.stop();
    await plugin.parent.import(plugin.filePath, now);
    await plugin.broadcast("mounted");
    this.logger.debug(`Plugin "${plugin.name}" reloaded`);
  }

  /**
   * 监听文件变化
   */
  watch(
    callback: (p: Plugin) => void | Promise<void>,
    recursive = false
  ): void {
    if (!this.filePath || this.filePath.includes("node_modules")) return;

    const unwatch = watchFile(this.filePath, () => {
      const newHash = getFileHash(this.filePath);
      if (newHash === this.fileHash) return;

      this.logger.debug(`Plugin "${this.name}" file changed, reloading...`);
      callback(this);
      this.fileHash = newHash;
    });

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
    entry = path.resolve(
      path.dirname(parent?.filePath || fileURLToPath(import.meta.url)),
      entry
    );
    const entryFile = fs.existsSync(entry) ? entry : require.resolve(entry);
    const realPath = fs.realpathSync(entryFile);

    // 检查模块是否已加载
    const existing = loadedModules.get(realPath);
    if (existing) {
      return existing;
    }

    const plugin = new Plugin(realPath, parent);
    plugin.fileHash = getFileHash(entryFile);
    
    // 先记录，防止循环依赖时重复加载
    loadedModules.set(realPath, plugin);

    await storage.run(plugin, async () => {
      await import(`${import.meta.resolve(entryFile)}?t=${Date.now()}`);
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
    crons: string[];
    middlewares: string[];
  }

  /**
   * 生命周期事件
   */
  export interface Lifecycle {
    mounted: [];
    dispose: [];
    "before-start": [Plugin];
    started: [Plugin];
    "before-mount": [Plugin];
    "before-dispose": [Plugin];
    "call.recallMessage": [string, string, string];
    'before.sendMessage': [SendOptions];
    "context.mounted": [keyof Plugin.Contexts];
    "context.dispose": [keyof Plugin.Contexts];
  }

  /**
   * 服务类型扩展点
   * 各个 Context 通过 declare module 扩展此接口
   */
  export interface Contexts extends RegisteredAdapters {
    config: ConfigService;
    permission: PermissionService;
    database: Database<any, Models>;
  }
  
  /**
   * Service 扩展方法类型
   * 这些方法由各个 Context 的 extensions 提供
   * 在 Plugin.start() 时自动注册到 Plugin.prototype
   */
  export interface Extensions {}
}
