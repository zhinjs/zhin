/**
 * Plugin 类 - 基于 zhinjs/next 的 Hooks 实现
 * 移除 Dependency 继承，使用 AsyncLocalStorage 管理上下文
 */

import { AsyncLocalStorage } from "async_hooks";
import { EventEmitter } from "events";
import { createRequire } from "module";
import type { Database, Definition } from "@zhin.js/database";
import { Schema } from "@zhin.js/schema";
import type { Models, RegisteredAdapters, Tool, ToolContext } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import logger, { Logger } from "@zhin.js/logger";
import { compose, remove, resolveEntry } from "./utils.js";
import { MessageMiddleware, RegisteredAdapter, MaybePromise, ArrayItem, SendOptions } from "./types.js";
import type { ConfigFeature } from "./built/config.js";
import type { PermissionFeature } from "./built/permission.js";
import { Adapter, Adapters } from "./adapter.js";
import { Feature, FeatureJSON } from "./feature.js";
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
 *
 * 同一个文件多次调用 usePlugin() 返回同一个实例，
 * 避免 Plugin.create() + usePlugin() 产生不必要的双层包装。
 */
export function usePlugin(): Plugin {
  const callerFile = getCurrentFile();
  const parentPlugin = storage.getStore();

  // 同一文件再次调用 usePlugin()，直接复用已有实例
  if (parentPlugin && parentPlugin.filePath === callerFile) {
    return parentPlugin;
  }

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
    await message.$reply(result);
    await next();
  };
  // 插件功能
  #middlewares: MessageMiddleware<RegisteredAdapter>[] = [this.#messageMiddleware];

  // 本地工具存储（当 ToolService 不可用时使用）
  #tools: Map<string, Tool> = new Map();

  // 统一的清理函数集合
  #disposables: Set<() => void | Promise<void>> = new Set();

  // 记录当前插件向哪些 Feature 贡献了哪些 item
  #featureContributions = new Map<string, Set<string>>();

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
   * @param middleware 中间件函数
   */
  addMiddleware<T extends RegisteredAdapter>(middleware: MessageMiddleware<T>): () => void {
    if(this.parent){
      const dispose= this.parent.addMiddleware(middleware);
      this.#disposables.add(dispose);
      return () => {
        dispose();
        this.#disposables.delete(dispose);
      };
    }
    this.#middlewares.push(middleware as MessageMiddleware<RegisteredAdapter>);
    const dispose = () => {
      remove(this.#middlewares, middleware);
      this.#disposables.delete(dispose);
    };
    this.#disposables.add(dispose);
    return dispose;
  }

  /**
   * 添加工具
   * 工具可以被 AI 服务调用，也会自动生成对应的命令
   * @param tool 工具定义
   * @param generateCommand 是否生成对应命令（默认 true）
   * @returns 返回一个移除工具的函数
   */
  addTool(
    tool: Tool,
    generateCommand: boolean = true
  ): () => void {
    // 尝试使用 ToolFeature
    const toolService = this.root.inject('tool' as any) as any;
    if (toolService && typeof toolService.addTool === 'function') {
      const dispose = toolService.addTool(tool, this.name, generateCommand);
      this.#disposables.add(dispose);
      return () => {
        dispose();
        this.#disposables.delete(dispose);
      };
    }

    // 回退到本地存储
    const toolWithSource: Tool = {
      ...tool,
      source: tool.source || `plugin:${this.name}`,
      tags: [...(tool.tags || []), 'plugin', this.name],
    };
    this.#tools.set(tool.name, toolWithSource);
    const dispose = () => {
      this.#tools.delete(tool.name);
      this.#disposables.delete(dispose);
    };
    this.#disposables.add(dispose);
    return dispose;
  }

  /**
   * 获取当前插件注册的所有工具
   */
  getTools(): Tool[] {
    return Array.from(this.#tools.values());
  }

  /**
   * 获取当前插件及所有子插件注册的工具
   */
  getAllTools(): Tool[] {
    const tools: Tool[] = [...this.getTools()];
    for (const child of this.children) {
      tools.push(...child.getAllTools());
    }
    return tools;
  }

  /**
   * 根据名称获取工具
   */
  getTool(name: string): Tool | undefined {
    // 先在当前插件查找
    const tool = this.#tools.get(name);
    if (tool) return tool;
    // 再在子插件中查找
    for (const child of this.children) {
      const childTool = child.getTool(name);
      if (childTool) return childTool;
    }
    return undefined;
  }

  /**
   * 收集所有可用的工具
   * 优先使用 ToolService，否则回退到本地收集
   */
  collectAllTools(): Tool[] {
    // 尝试使用 ToolService
    const toolService = this.root.inject('tool' as any) as any;
    if (toolService && typeof toolService.collectAll === 'function') {
      return toolService.collectAll(this.root);
    }

    // 回退到本地收集
    const tools: Tool[] = [];

    // 收集插件树中的所有工具
    const rootPlugin = this.root;
    tools.push(...rootPlugin.getAllTools());

    // 收集所有适配器的工具
    for (const [name, context] of rootPlugin.contexts) {
      const value = context.value;
      if (value && typeof value === 'object' && 'getTools' in value) {
        const adapter = value as Adapter;
        tools.push(...adapter.getTools());
      }
    }

    return tools;
  }

  /**
   * 插件名称
   */
  get name(): string {
    if (this.#cachedName) return this.#cachedName;

    let name = path
      .relative(process.cwd(), this.filePath)
      .replace(/\?t=\d+$/, "")
      .replace(/\\/g, "/")
      .replace(/\/index\.(js|ts)x?$/, "")
      .replace(/\/(lib|src|dist)$/, "");
    
    // 安全地提取 node_modules 后的包名或最后的文件名
    const nodeModulesIndex = name.indexOf('node_modules/');
    if (nodeModulesIndex !== -1) {
      name = name.substring(nodeModulesIndex + 'node_modules/'.length);
    }
    
    // 提取最后一个路径段
    const lastSlash = name.lastIndexOf('/');
    if (lastSlash !== -1) {
      name = name.substring(lastSlash + 1);
    }
    
    // 移除文件扩展名
    name = name.replace(/\.(js|ts)x?$/, "");
    
    this.#cachedName = name;
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
  inject<T extends keyof Plugin.Contexts>(name: T): Plugin.Contexts[T] | undefined {
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
  async start(t?: number): Promise<void> {
    if (this.started) return;
    this.started = true; // 提前设置，防止重复启动

    // 启动所有服务
    for (const context of this.$contexts.values()) {
      if (typeof context.mounted === "function") {
        const result = await context.mounted(this);
        // 仅当 value 未预设时才赋值（mounted 始终执行，以支持副作用如设置内部引用）
        if (!context.value) context.value = result;
      }
      this.dispatch('context.mounted', context.name)
    }
    await this.broadcast("mounted");
    // 先启动子插件，再打印当前插件启动日志
    for (const child of this.children) {
      await child.start(t);
    }
    // 输出启动日志（使用 debug 级别，避免重复输出）
    // 只在根插件或重要插件时使用 info 级别
    if (!this.parent || this.name === 'setup') {
      this.logger.info(`Plugin "${this.name}" ${t ? `reloaded in ${Date.now() - t}ms` : "started"}`);
    } else {
      this.logger.debug(`Plugin "${this.name}" ${t ? `reloaded in ${Date.now() - t}ms` : "started"}`);
    }
  }
  /**
   * 记录 Feature 贡献（由 Feature extensions 内部调用）
   * @param featureName Feature 名称（如 'command'）
   * @param itemName item 标识（如命令 pattern）
   */
  recordFeatureContribution(featureName: string, itemName: string): void {
    if (!this.#featureContributions.has(featureName)) {
      this.#featureContributions.set(featureName, new Set());
    }
    this.#featureContributions.get(featureName)!.add(itemName);
  }

  /**
   * 收集本插件及所有后代插件的 Feature 贡献名称
   * 解决 Plugin.create() 包装问题：外层插件的 #featureContributions 为空，
   * 实际贡献记录在 usePlugin() 创建的内层子插件上
   */
  #collectAllFeatureNames(names: Set<string>): void {
    for (const name of this.#featureContributions.keys()) {
      names.add(name);
    }
    for (const child of this.children) {
      child.#collectAllFeatureNames(names);
    }
  }

  /**
   * 收集本插件及所有后代插件的 plugin name 集合
   * 用于 Feature.toJSON(pluginName) 匹配
   */
  #collectAllPluginNames(names: Set<string>): void {
    names.add(this.name);
    for (const child of this.children) {
      child.#collectAllPluginNames(names);
    }
  }

  /**
   * 获取当前插件的所有 Feature 数据（用于 HTTP API）
   * 遍历插件贡献的 Feature，调用各 Feature 的 toJSON(pluginName) 获取序列化数据
   * 同时包含 middleware（方案 B: 本地构造）
   *
   * 注意：Plugin.create() 创建 "外层" 插件，usePlugin() 创建 "内层" 子插件。
   * extension 方法 (addCommand 等) 通过 getPlugin() 记录在内层插件上。
   * 因此需要遍历整个子树来收集 feature 贡献名称。
   */
  getFeatures(): FeatureJSON[] {
    const result: FeatureJSON[] = [];

    // 收集本插件及所有后代插件的 feature 名称和 plugin 名称
    const featureNames = new Set<string>();
    this.#collectAllFeatureNames(featureNames);

    const pluginNames = new Set<string>();
    this.#collectAllPluginNames(pluginNames);

    // 从 Feature 贡献中收集
    for (const featureName of featureNames) {
      const feature = this.inject(featureName as keyof Plugin.Contexts);
      if (feature instanceof Feature) {
        // 先用当前插件名尝试
        let json = feature.toJSON(this.name);
        if (json.count === 0) {
          // 当前插件名匹配不到（可能名称不同），尝试后代插件名
          for (const pName of pluginNames) {
            if (pName === this.name) continue;
            json = feature.toJSON(pName);
            if (json.count > 0) break;
          }
        }
        if (json.count > 0) {
          result.push(json);
        }
      }
    }

    // middleware（方案 B: 本地构造，因为 middleware 是 Plugin 私有属性）
    // 同样需要收集子插件树中的 middleware
    const allMiddlewareNames: string[] = [];
    const collectMiddlewares = (plugin: Plugin) => {
      const mws = plugin.#middlewares
        .filter(m => m !== plugin.#messageMiddleware)
        .map((m, i) => m.name || `middleware_${i}`);
      allMiddlewareNames.push(...mws);
      for (const child of plugin.children) {
        collectMiddlewares(child);
      }
    };
    collectMiddlewares(this);

    if (allMiddlewareNames.length > 0) {
      result.push({
        name: 'middleware',
        icon: 'Layers',
        desc: '中间件',
        count: allMiddlewareNames.length,
        items: allMiddlewareNames.map(name => ({ name })),
      });
    }

    // 自动检测适配器和服务上下文（从 $contexts 中发现非 Feature 的贡献）
    const adapterItems: { name: string; bots: number; online: number; tools: number }[] = [];
    const serviceItems: { name: string; desc: string }[] = [];

    const scanContexts = (plugin: Plugin) => {
      for (const [name, context] of plugin.$contexts) {
        const value = context.value;
        if (value instanceof Adapter) {
          adapterItems.push({
            name,
            bots: value.bots.size,
            online: Array.from(value.bots.values()).filter(b => b.$connected).length,
            tools: value.tools.size,
          });
        } else if (value !== undefined && !(value instanceof Feature)) {
          // 非 Feature、非 Adapter 的上下文 = 服务
          serviceItems.push({ name, desc: context.description || name });
        }
      }
      for (const child of plugin.children) {
        scanContexts(child);
      }
    };
    scanContexts(this);

    if (adapterItems.length > 0) {
      result.push({
        name: 'adapter',
        icon: 'Plug',
        desc: '适配器',
        count: adapterItems.length,
        items: adapterItems,
      });
    }

    if (serviceItems.length > 0) {
      result.push({
        name: 'service',
        icon: 'Server',
        desc: '服务',
        count: serviceItems.length,
        items: serviceItems,
      });
    }

    return result;
  }

  info(): Record<string, any> {
    return {
      [this.name]: {
        features: this.getFeatures(),
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

    // 清理 feature 贡献记录
    this.#featureContributions.clear();

    if (this.parent) {
      remove(this.parent?.children, this);
    }

    // 从全局 loadedModules Map 中移除，防止内存泄漏
    if (this.filePath) {
      try {
        const realPath = fs.realpathSync(this.filePath);
        loadedModules.delete(realPath);
      } catch {
        // 文件可能已不存在，忽略错误
      }
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
   * 注册上下文（支持 Feature 实例或传统 Context 对象）
   */
  provide<T extends keyof Plugin.Contexts>(target: Feature | Context<T>): this {
    if (target instanceof Feature) {
      // Feature → 自动转为内部 Context 格式存储
      const feature = target;
      const context: Context<T> = {
        name: feature.name as T,
        description: feature.desc,
        value: feature as any,
        mounted: feature.mounted
          ? async (plugin: Plugin) => {
              await feature.mounted!(plugin);
              return feature as any;
            }
          : undefined,
        dispose: feature.dispose
          ? async () => { await feature.dispose!(); }
          : undefined,
        extensions: feature.extensions,
      };
      return this.provide(context);
    }

    // 传统 Context 路径
    const context = target;
    if (!Plugin[contextsKey].includes(context.name as string)) {
      Plugin[contextsKey].push(context.name as string);
    }
    this.logger.debug(`Context "${context.name as string}" provided`);
    // 注册扩展方法到 Plugin.prototype
    if (context.extensions) {
      for (const [name, fn] of Object.entries(context.extensions)) {
        if (typeof fn === 'function') {
          Reflect.set(Plugin.prototype, name, fn);
        }
      }
    }
    this.$contexts.set(context.name as string, context);
    return this;
  }

  // ============================================================================
  // 插件加载
  // ============================================================================

  /**
   * 导入插件
   */
  async import(entry: string, t?: number): Promise<Plugin> {
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
    const now = Date.now();
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
    'dispatch', 'broadcast', 'provide', 'import', 'reload', 'watch', 'info',
    'recordFeatureContribution', 'getFeatures'
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
  export interface Contexts extends Adapters {
    config: ConfigFeature;
    permission: PermissionFeature;
  }

  /**
   * Service 扩展方法类型
   * 这些方法由各个 Context 的 extensions 提供
   * 在 Plugin.start() 时自动注册到 Plugin.prototype
   */
  export interface Extensions { }
}
