/**
 * Plugin 类 - 基于 zhinjs/next 的 Hooks 实现
 * 移除 Dependency 继承，使用 AsyncLocalStorage 管理上下文
 */

import { AsyncLocalStorage } from "async_hooks";
import { EventEmitter } from "events";
import { createRequire } from "module";
import type { Database } from "@zhin.js/database";
import type { Models, RegisteredAdapters } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import logger, { Logger } from "@zhin.js/logger";
import { MessageCommand } from "./command.js";
import { Component } from "./component.js";
import { Cron } from "./cron.js";
import { compose, remove, resolveEntry } from "./utils.js";
import { MessageMiddleware, RegisteredAdapter,MaybePromise,ArrayItem, ConfigService, PermissionService, CommandService } from "./types.js";
import { Adapter } from "./adapter.js";
import { createHash } from "crypto";
const contextsKey = Symbol("contexts");
const require = createRequire(import.meta.url);


export type SideEffect<A extends (keyof Plugin.Contexts)[]>={
  (...args:ContextList<A>):MaybePromise<void|DisposeFn<ContextList<A>>>;
  finished?:boolean
}
export type DisposeFn<A>=(context:ArrayItem<A>)=>MaybePromise<void>
export type ContextList<CS extends (keyof Plugin.Contexts)[]>=CS extends [infer L,...infer R]?R extends (keyof Plugin.Contexts)[]?[ContextItem<L>,...ContextList<R>]:never[]:never[]
type ContextItem<L>=L extends keyof Plugin.Contexts?Plugin.Contexts[L]:never
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
  const plugin = storage.getStore();
  const callerFile = getCurrentFile();

  if (plugin && callerFile === plugin.filePath) {
    return plugin;
  }

  const newPlugin = new Plugin(callerFile, plugin);
  storage.enterWith(newPlugin);
  return newPlugin;
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
    watcher.on("error", (_error) => {});
    return () => watcher.close();
  } catch (error) {
    return () => {};
  }
}

// ============================================================================
// Plugin 类
// ============================================================================
export interface Plugin extends Plugin.Contexts {}
/**
 * Plugin 类 - 核心插件系统
 * 直接继承 EventEmitter，不依赖 Dependency
 */
export class Plugin extends EventEmitter<Plugin.Lifecycle> {
  static [contextsKey] = [] as string[];
  #cachedName?: string;
  $adaptersDirty = true;
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
    if(!commandService) return await next();
    const result = await commandService.handle(message,this);
    if(!result) return await next();
    const adapter = this.inject(message.$adapter) as Adapter;
    if(!adapter|| !(adapter instanceof Adapter)) return await next();
    await adapter.emit('call.sendMessage', message.$bot, {
      context: message.$adapter,
      bot: message.$bot,
      content: result,
      id: message.$id,
      type: message.$channel.type,
    });
    await next();
  };
  // 插件功能
  #middlewares: MessageMiddleware<RegisteredAdapter>[] = [this.#messageMiddleware];
  components: Map<string, Component<any>> = new Map();
  crons: Cron[] = [];
  get middleware(): MessageMiddleware<RegisteredAdapter> {
    return compose<RegisteredAdapter>(this.#middlewares);
  }
  /**
   * 构造函数
   */
  constructor(filePath: string = "", public parent?: Plugin) {
    super();

    this.filePath = filePath.replace(/\?t=\d+$/, "");
    this.logger = this.name ? logger.getLogger(this.name) : logger;

    // 自动添加到父节点
    if (parent && !parent.children.includes(this)) {
      parent.children.push(this);
      parent.$adaptersDirty = true;
    }

    // 自动绑定所有方法
    this.#bindMethods();
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && Plugin[contextsKey].includes(prop)) {
          return target.inject(prop as keyof Plugin.Contexts);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
  addCron<T extends Cron>(cron: T) {
    this.crons.push(cron);
    return () => remove(this.crons, cron);
  }
  addComponent<T extends Component<any>>(component: T) {
    this.components.set(component.name, component);
    return () => this.components.delete(component.name);
  }
  addCommand<T extends RegisteredAdapter>(command: MessageCommand<T>) {
    const commandService = this.inject('command');
    if(!commandService) return () => {};
    commandService.addCommand(command);
    return () => commandService.removeCommand(command);
  }
  addMiddleware<T extends RegisteredAdapter>(middleware: MessageMiddleware<T>) {
    this.#middlewares.push(middleware as MessageMiddleware<RegisteredAdapter>);
    return () => remove(this.#middlewares, middleware);
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


  useContext<T extends (keyof Plugin.Contexts)[]>(...args:[...T,SideEffect<T>]){
    const contexts=args.slice(0,-1) as T
    const sideEffect=args[args.length-1] as SideEffect<T>
    const contextReadyCallback=async ()=>{
        if(sideEffect.finished) return;
        sideEffect.finished=true;
        const args=contexts.map(item=>this.inject(item))
        const dispose=await sideEffect(...args as ContextList<T>)
        if(!dispose)return;
        const disposeFn=async (name:keyof Plugin.Contexts)=>{
            if(contexts.includes(name)){
                await dispose(this.inject(name) as any)
            }
            this.off('context.dispose',disposeFn)
            sideEffect.finished=false;
        }
        this.on('context.dispose',disposeFn)
        this.on('dispose',()=>{
            this.off('context.dispose',disposeFn)
            dispose(this.inject(args[0] as any) as any)
        })
    }
    const onContextMounted=async (name:keyof Plugin.Contexts)=>{
        if(!this.#contextsIsReady(contexts)||!(contexts).includes(name)) return
        await contextReadyCallback()
    }
    this.on('context.mounted',onContextMounted)
    if(!this.#contextsIsReady(contexts)) return
    contextReadyCallback()
}
inject<T extends keyof Plugin.Contexts>(name: T): Plugin.Contexts[T]{
    const context = this.root.contexts.get(name as string);
    if (!context) {
        throw new Error(`Context "${name as string}" not found`);
    }
    return context.value as Plugin.Contexts[T];
}
#contextsIsReady<CS extends (keyof Plugin.Contexts)[]>(contexts:CS){
    if(!contexts.length) return true
    return contexts.every(name=>this.contextIsReady(name))
}
contextIsReady<T extends keyof Plugin.Contexts>(name:T){
    try{
        return !!this.inject(name)
    }catch{
        return false
    }
}
  // ============================================================================
  // 生命周期方法
  // ============================================================================

  /**
   * 启动插件
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // 启动所有服务
    for (const context of this.$contexts.values()) {
      if (typeof context.mounted === "function"&&!context.value) {
        context.value=await context.mounted(this);
      }
      this.dispatch('context.mounted',context.name)
    }
    await this.broadcast("mounted");
    for(const child of this.children) {
      await child.start();
    }
    this.logger.info(`Plugin "${this.name}" started`);
  }
  info(): Record<string, any> {
    return {
      [this.name]: this.children.map(child => child.info())
    }
  }

  /**
   * 停止插件
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.logger.info(`Stopping plugin "${this.name}"`);
    this.started = false;


    // 停止服务
    for (const [name, context] of this.$contexts) {
      remove(Plugin[contextsKey], name);
      if (typeof context.dispose === "function") {
        await context.dispose(context.value);
      }
    }

    // 停止定时任务
    for (const cron of this.crons) {
      cron.dispose();
    }

    // 清理子插件
    for (const child of this.children) {
      await child.stop();
    }
    this.children = [];
    this.#cachedName = undefined;

    this.emit("dispose");
    if (this.parent) {
      remove(this.parent?.children, this);
    }
    this.removeAllListeners();
    this.logger.info(`Plugin "${this.name}" stopped`);
  }

  // ============================================================================
  // 生命周期钩子
  // ============================================================================

  onMounted(callback: () => void | Promise<void>): void {
    this.on("mounted", callback);
  }

  onDispose(callback: () => void | Promise<void>): void {
    this.on("dispose", callback);
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
    this.logger.info(`Context "${context.name as string}" provided`);
    this.$contexts.set(context.name as string, context);
    return this;
  }

  // ============================================================================
  // 插件加载
  // ============================================================================

  /**
   * 导入插件
   */
  async import(entry: string): Promise<Plugin> {
    if(!entry) throw new Error(`Plugin entry not found: ${entry}`);
    entry = resolveEntry(path.isAbsolute(entry) ?
     entry : 
     path.resolve(path.dirname(this.filePath), entry))||entry;
    const plugin = await Plugin.create(entry, this);
    this.$adaptersDirty = true;
    return plugin;
  }

  /**
   * 重载插件
   */
  async reload(plugin: Plugin = this): Promise<void> {
    if (!plugin.parent) {
      // 根插件重载 = 退出进程（由 CLI 重启）
      return process.exit(51);
    }

    await plugin.stop();
    await plugin.parent.import(plugin.filePath);
    await plugin.broadcast("mounted");
    this.logger.info(`Plugin "${plugin.name}" reloaded`);
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

      this.logger.info(`Plugin "${this.name}" file changed, reloading...`);
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

  /**
   * 自动绑定所有方法
   */
  #bindMethods(): void {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (key === "constructor") continue;
      if (desc?.get || desc?.set) continue;
      const value = (this as any)[key];
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

    const plugin = new Plugin(fs.realpathSync(entryFile), parent);
    plugin.fileHash = getFileHash(entryFile);

    await storage.run(plugin, async () => {
      await import(`${import.meta.resolve(entryFile)}?t=${Date.now()}`);
    });

    return plugin;
  }
}
export interface Context<T extends keyof Plugin.Contexts=keyof Plugin.Contexts> {
  name: T;
  description:string
  value?: Plugin.Contexts[T];
  mounted?: (parent: Plugin) => Plugin.Contexts[T] | Promise<Plugin.Contexts[T]>;
  dispose?: (value: Plugin.Contexts[T]) => void;
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
    "context.mounted": [keyof Plugin.Contexts];
    "context.dispose": [keyof Plugin.Contexts];
  }

  /**
   * 服务类型扩展点
   */
  export interface Contexts extends RegisteredAdapters {
    config: ConfigService;
    permission: PermissionService;
    database: Database<any, Models>;
    command: CommandService;
  }
}
