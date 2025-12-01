import path from "path";
import { SideEffect, GlobalContext, Models } from "@zhin.js/types";
import { Schema } from '@zhin.js/hmr';
import {
  HMRManager,
  Context,
  Logger,
  getCallerFile,
  getCallerFiles,
  mergeConfig,
  Dependency
} from "@zhin.js/hmr";
import {
  AdapterMessage,
  AppConfig,
  BeforeSendHandler,
  RegisteredAdapter,
  SendOptions,
  MessageMiddleware,
} from "./types.js";
import { Config } from "./config.js";
import { Message } from "./message.js";
import { fileURLToPath } from "url";
import { generateEnvTypes } from "./types-generator.js";
import logger, { setName, setLevel, LogLevel } from "@zhin.js/logger";
import { compose, sleep } from "./utils.js";
import { PermissionChecker, Permissions } from "./permissions.js";
// 创建静态logger用于配置加载等静态操作
setName("Zhin");
import { Plugin } from "./plugin.js";
import { Adapter } from "./adapter";
import { MessageCommand } from "./command";
import { Component } from "./component";
import {
  RelatedDatabase,
  DocumentDatabase,
  KeyValueDatabase,
  Definition,
  Registry,
} from "@zhin.js/database";
import { DatabaseLogTransport } from "./log-transport.js";
import { SystemLog, SystemLogDefinition } from "./models/system-log.js";
import { User, UserDefinition } from "./models/user.js";
import { addTransport, removeTransport } from "@zhin.js/logger";
declare module "@zhin.js/types" {
  interface Models {
    SystemLog: SystemLog;
    User: User;
  }
}

// ============================================================================
// App 类（Zhin.js 应用主入口，负责插件热重载、配置管理、消息分发等）
// ============================================================================
/**
 * App类：Zhin.js 应用主入口，负责插件热重载、配置管理、消息分发等。
 * 继承自 Plugin，支持插件生命周期、适配器管理、数据库集成等。
 * 组合了 HMRManager 来实现热重载功能。
 */
export class App extends Plugin {
  static currentPlugin: Plugin;
  middlewares: MessageMiddleware[] = [];
  adapters: string[] = [];
  #config: Config<AppConfig>;
  database?:
    | RelatedDatabase<any, Models>
    | DocumentDatabase<any, Models>
    | KeyValueDatabase<any, Models>;
  permissions: Permissions = new Permissions(this);
  private logTransport?: DatabaseLogTransport;
  /** 配置变更处理锁 */
  private configChangeLock: Promise<void> | null = null;
  // 缓存
  private _middlewareCache: MessageMiddleware[] | null = null;
  private _commandCache: MessageCommand[] | null = null;
  private _definitionCache: Map<string, Definition<any>> | null = null;
  private _processListeners: Map<string, any> = new Map();

  /** HMR 管理器 */
  public readonly hmrManager: HMRManager<Plugin>;

  /**
   * 构造函数：初始化应用，加载配置，注册全局异常处理
   * @param config 可选，应用配置，若为空则自动查找配置文件
   */
  constructor(config: AppConfig);
  /**
   * 构造函数：初始化应用，加载配置，注册全局异常处理
   * @param config_file 可选，配置文件路径，默认为 'zhin.config.yml'
   */
  constructor(config_file?: string);
  constructor(config_param: string | AppConfig = "zhin.config.yml") {
    const config_file =
      typeof config_param === "string" ? config_param : "zhin.config.yml";
    const config_obj =
      typeof config_param === "object" ? config_param : App.defaultConfig;
    const config = new Config<AppConfig>(
      config_file,
      App.schema,
      mergeConfig(App.defaultConfig, config_obj)
    );
    
    // 初始化父类 (Plugin)
    // App 是根插件，没有 parent
    super(null as any, 'App', getCallerFile());

    // 初始化 HMRManager
    this.hmrManager = new HMRManager(this, {
      logger: this.logger,
      dirs: config.get("plugin_dirs") || [],
      debug: config.get("debug"),
    });

    this.hmrManager.watching(config.filepath,()=>config.reload());
    this.on("message.send", this.sendMessage.bind(this));
    this.on("message.receive", this.receiveMessage.bind(this));
    
    const uncaughtHandler = (e: any) => {
      const args = e instanceof Error ? [e.message, { stack: e.stack }] : [e];
      this.logger.error(...args);
    };
    const unhandledHandler = (e: any) => {
      const args = e instanceof Error ? [e.message, { stack: e.stack }] : [e];
      this.logger.error(...args);
    };

    process.on("uncaughtException", uncaughtHandler);
    process.on("unhandledRejection", unhandledHandler);
    
    this._processListeners.set("uncaughtException", uncaughtHandler);
    this._processListeners.set("unhandledRejection", unhandledHandler);

    this.#config = config;
    // 监听配置变更
    config.on("change", (before, after) => {
      this.handleConfigChange(before, after);
      this.broadcast("config.change", before, after);
    });
    this.defineSchema(App.schema);
    
    this.middleware(this.messageMiddleware.bind(this));
    
    // 监听依赖变化清理缓存
    const clearCache = () => {
      this._middlewareCache = null;
      this._commandCache = null;
      this._definitionCache = null;
    };
    
    this.hmrManager.on('add', clearCache);
    this.hmrManager.on('remove', clearCache);
    this.hmrManager.on('reload', clearCache);
  }

  /**
   * 查找插件
   * @param name 插件名称
   */
  findPluginByName(name: string): Plugin | void {
    return this.hmrManager.findPluginByName(name);
  }

  /**
   * 代理 HMRManager 的方法
   */
  get dirs() {
    return this.hmrManager.dirs;
  }
  
  addDir(dir: string) {
    this.hmrManager.addDir(dir);
  }
  
  removeDir(dir: string) {
    return this.hmrManager.removeDir(dir);
  }
  
  watching(filePath: string | string[], callback: () => void) {
    return this.hmrManager.watching(filePath, callback);
  }
  
  async waitForReady() {
    await super.waitForReady();
    await this.hmrManager.waitForReady();
  }

  // 覆盖 dispose
  dispose(): void {
    this.hmrManager.dispose();
    super.dispose();
  }

  /**
   * 处理配置变更
   * 如果上一次变更未完成，等待其完成后再处理新的变更
   */
  private async handleConfigChange(
    before: AppConfig,
    after: AppConfig
  ): Promise<void> {
    this.logger.info("configuration changed");
    // 等待上一次配置变更处理完成
    if (this.configChangeLock) {
      this.logger.info("Waiting for previous config change to complete...");
      await this.configChangeLock;
    }

    // 创建新的锁
    this.configChangeLock = this.restart();

    try {
      await this.configChangeLock;
    } finally {
      this.configChangeLock = null;
    }
  }

  /**
   * 根据配置初始化应用
   */
  private async loadFromConfig(config: AppConfig): Promise<void> {
    try {
      // 1. 设置日志级别
      setLevel(config.log_level || LogLevel.INFO);

      // 2. 更新 HMR 配置
      this.hmrManager.updateOptions({
        dirs: config.plugin_dirs || [],
        debug: config.debug
      });

      // 3. 动态更新监听目录
      // HMRManager 的 updateOptions 只是更新了 options 对象和 #dirs 属性，
      // 并不会自动去重新扫描目录或启动新的 watch。
      // 所以如果 plugin_dirs 变化了，我们需要手动处理
      // 这里为了简单，我们先手动清理和添加
      const currentDirs = this.dirs;
      const newDirs = (config.plugin_dirs || []).map(d => path.resolve(process.cwd(), d));
      
      for(const dir of currentDirs) {
          if(!newDirs.includes(dir)) this.removeDir(dir);
      }
      for(const dir of newDirs) {
          if(!currentDirs.includes(dir)) this.addDir(dir);
    }

      // 4. 加载插件
      for (const pluginName of (config.plugins || [])) {
        this.use(pluginName);
      }
      
      // 5. 等待所有插件就绪
      await this.waitForReady();

      // 6. 初始化数据库
      if (config.database) {
        this.database = Registry.create(
          (config.database as any).dialect,
          config.database,
          Object.fromEntries(this.allDefinitions)
        );
        await this.database!.start();
        this.logger.debug(`Database started`);
        this.dispatch("database.ready", this.database);

        // 初始化日志传输器
        this.logTransport = new DatabaseLogTransport(this);
        addTransport(this.logTransport);
        this.logger.info(`database log transport registered`);
      }
      
      this.dispatch('app.ready');

    } catch (error) {
      this.logger.error("Failed to load configuration:", error);
      throw error;
    }
  }

  /**
   * 重启应用
   * 清理运行时资源（插件、数据库），保留基础设施（监听器、HMRManager实例），然后重新加载配置
   */
  async restart(): Promise<void> {
    this.logger.info('Restarting app...');

    // 1. 停止数据库及日志传输
    if (this.logTransport) {
      this.logTransport.stopCleanup();
      removeTransport(this.logTransport);
      this.logTransport = undefined;
    }

    if (this.database) {
      await this.database.stop();
      this.database = undefined;
  }

    // 2. 卸载所有插件 (除了 App 自身)
    // 注意：不能直接清空 dependencyList，因为这只是 getter。
    // 我们需要通过 ModuleLoader 移除模块，这会触发 Dependency dispose
    const pluginsToRemove = [...this.dependencyList].filter(dep => dep !== this);
    for(const dep of pluginsToRemove) {
        // 使用 HMRManager 的移除机制，这会处理缓存和 dispose
        this.hmrManager.moduleLoader.remove(dep.filename);
    }
    // 确保依赖列表干净了 (HMRManager.moduleLoader.remove 应该已经处理了 this.dependencies)
    
    // 3. 重新加载配置并启动
    // 注意：this.config 已经是新的了，因为 Config 对象在 emit change 之前已经 reload 了
    await this.loadFromConfig(this.config);
    
    this.logger.info('App restarted successfully');
    }

  async receiveMessage<P extends RegisteredAdapter>(
    message: Message<AdapterMessage<P>>
  ) {
    if (!this._middlewareCache) {
      this._middlewareCache = this.dependencyList.reduce(
      (result, plugin) => {
        result.push(...(plugin.middlewares as MessageMiddleware<P>[]));
        return result;
      },
      [...this.middlewares] as MessageMiddleware<P>[]
    );
    }
    const handle = compose(this._middlewareCache);
    await handle(message);
  }
  async messageMiddleware(message: Message, next: () => Promise<void>) {
    for (const command of this.allCommands) {
      const result = await command.handle(message, this);
      if (result) message.$reply(result);
    }
    return next();
  }
  get allCommands() {
    if (this._commandCache) return this._commandCache;
    this._commandCache = this.dependencyList.reduce((result, plugin) => {
      result.push(...plugin.commands);
      return result;
    }, [] as MessageCommand[]);
    return this._commandCache;
  }
  /** 默认配置 */
  /**
   * 默认配置
   * - plugin_dirs: 插件目录
   * - plugins: 启用插件
   * - bots: 机器人配置
   * - debug: 是否调试模式
   */
  static defaultConfig: AppConfig = {
    log_level: LogLevel.INFO,
    plugin_dirs: [],
    plugins: [],
    bots: [],
    debug: false,
  };
  middleware(middleware: MessageMiddleware) {
    this.middlewares.push(middleware);
  }
  /**
   * 发送消息到指定适配器和机器人
   * @param options 消息发送参数（包含 context、bot、内容等）
   * @throws 找不到适配器或机器人时抛出异常
   */
  async sendMessage(options: SendOptions) {
    const adapter = this.getContext<Adapter>(options.context);
    if (!adapter)
      throw new Error(`can't find adapter for name ${options.context}`);
    const bot = adapter.bots.get(options.bot);
    if (!bot)
      throw new Error(
        `can't find bot ${options.bot} for adapter ${options.context}`
      );
    return bot.$sendMessage(options);
  }
  async recallMessage(adapter_name: string, bot_name: string, id: string) {
    const adapter = this.getContext<Adapter>(adapter_name);
    if (!adapter)
      throw new Error(`can't find adapter for name ${adapter_name}`);
    const bot = adapter.bots.get(bot_name);
    if (!bot)
      throw new Error(`can't find bot ${bot_name} for adapter ${adapter_name}`);
    return bot.$recallMessage(id);
  }
  /** 同步加载配置文件 */
  /**
   * 同步加载配置文件（暂不支持，建议使用异步创建）
   * @throws 始终抛出异常，提示使用异步方法
   */
  static loadConfigSync(): AppConfig {
    // 由于loadConfig是异步的，我们需要创建一个同步版本
    // 或者在这里简化处理，让用户使用异步创建方法
    throw new Error("同步加载配置暂不支持，请使用 App.createAsync() 方法");
  }

  /** 创建插件依赖 */
  /**
   * 创建插件依赖
   * @param name 插件名
   * @param filePath 插件文件路径
   */
  createDependency(name: string, filePath: string): Plugin {
    return new Plugin(this, name, filePath);
  }

  /** 获取App配置 */
  /**
   * 获取App配置（只读）
   */
  getConfig(): Readonly<AppConfig>;
  getConfig<T extends Config.Paths<AppConfig>>(
    key: T
  ): Readonly<Config.Value<AppConfig, T>>;
  getConfig<T extends Config.Paths<AppConfig>>(key?: T) {
    if (key === undefined) {
      return this.#config.config;
    }
    return this.#config.get(key);
  }
  setConfig(value: AppConfig): void;
  setConfig<T extends Config.Paths<AppConfig>>(
    key: T,
    value: Config.Value<AppConfig, T>
  ): void;
  setConfig<T extends Config.Paths<AppConfig>>(
    key: T | AppConfig,
    value?: Config.Value<AppConfig, T>
  ): void {
    if (typeof key === "object") {
      this.#config.config = key;
    } else if (value !== undefined) {
      this.#config.set(key, value);
    }
  }
  changeSchema(key: string, value: Schema) {
    if (!App.schema.options.object) {
      App.schema.options.object = {};
    }
    App.schema.options.object[key] = value;
    this.#config.reload();
  }
  get config() {
    return this.#config.config;
  }
  set config(newConfig: AppConfig) {
    this.#config.config = newConfig;
    // 不再这里处理动态更新，统一由 config.on('change') -> restart -> loadFromConfig 处理
    // 只有日志提示
    this.logger.info("App configuration updated", this.config);
  }
  get allDefinitions() {
    if (this._definitionCache) return this._definitionCache;
    this._definitionCache = this.dependencyList.reduce(
      (result, plugin) => {
        plugin.definitions.forEach((definition, name) => {
          result.set(name, definition);
        });
        return result;
      },
      new Map<string, Definition<any>>([
        ["SystemLog", SystemLogDefinition],
        ["User", UserDefinition],
      ])
    );
    return this._definitionCache;
  }
  /** 使用插件 */
  use(filePath: string): void {
    // App 本身没有 emit('internal.add') 的逻辑了，这是 HMRManager 监听的。
    // 我们需要调用 HMRManager.emit
    this.hmrManager.emit("internal.add", filePath);
  }

  /** 启动App */
  async start(mode: "dev" | "prod" = "prod"): Promise<void> {
    await generateEnvTypes(process.cwd());
    // 首次启动，加载配置
    await this.loadFromConfig(this.config);
    this.logger.info("started successfully");
  }

  /** 停止App */
  async stop(): Promise<void> {
    this.logger.info("Stopping app...");

    this._processListeners.forEach((listener, event) => {
      process.removeListener(event, listener);
    });
    this._processListeners.clear();

    // 停止日志清理任务并移除日志传输器
    if (this.logTransport) {
      this.logTransport.stopCleanup();
      removeTransport(this.logTransport);
      this.logger.info("database log transport removed");
    }

    // 销毁所有插件
    this.dispose();

    this.logger.info("App stopped");
  }

  getContext<T>(name: string): T {
    for (const dep of this.dependencyList) {
      if (dep.contexts.has(name)) {
        const context = dep.contexts.get(name)!;
        // 如果上下文还没有挂载，等待挂载完成
        if (!context.value) {
          throw new Error(`Context ${name} is not mounted yet`);
        }
        return context.value;
      }
    }
    throw new Error(`can't find Context of ${name}`);
  }

  async handleBeforeSend(options: SendOptions) {
    const handlers = this.dependencyList.reduce((result, plugin) => {
      result.push(...plugin.listeners("before-message.send"));
      return result;
    }, [] as Function[]);
    for (const handler of handlers) {
      const result = await handler(options);
      if (result) options = result;
    }
    return options;
  }
}
export namespace App {
  export const schema = Schema.object({
    database: Schema.any().description("数据库配置"),
    bots: Schema.list(Schema.any()).default([]).description("机器人配置列表"),
    log_level: Schema.number()
      .default(LogLevel.INFO)
      .description("日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=SILENT)")
      .min(0)
      .max(4),
    log: Schema.object({
      maxDays: Schema.number().default(7).description("日志最大保存天数"),
      maxRecords: Schema.number().default(10000).description("日志最大记录数"),
      cleanupInterval: Schema.number()
        .default(24)
        .description("日志清理间隔（小时）"),
    })
      .description("日志配置")
      .default({
        maxDays: 7,
        maxRecords: 10000,
        cleanupInterval: 24,
      }),
    plugin_dirs: Schema.list(Schema.string())
      .default(["node_modules"])
      .description("插件目录列表"),

    plugins: Schema.list(Schema.string())
      .default([])
      .description("需要加载的插件列表"),
    debug: Schema.boolean()
      .default(false)
      .description("是否启用调试模式"),
  }).default({
    log_level: LogLevel.INFO,
    log: {
      maxDays: 7,
      maxRecords: 10000,
      cleanupInterval: 24,
    },
    plugin_dirs: ["node_modules"],
    plugins: [],
    debug: false,
  });
}

// ============================================================================
// Hooks API
// ============================================================================

function getPlugin(hmr: HMRManager<Plugin>, filename: string): Plugin {
  const name = path.basename(filename).replace(path.extname(filename), "");

  // 尝试从当前依赖中查找插件
  const childPlugin = hmr.findChild(filename);
  if (childPlugin) {
    return childPlugin;
  }
  logger.debug(`cant't find plugin for ${filename}, create new`);
  const parent = hmr.findParent(
    filename,
    getCallerFiles(fileURLToPath(import.meta.url))
  );
  // 创建新的插件实例
  const newPlugin = new Plugin(parent as unknown as Dependency<Plugin>, name, filename);

  // 添加到当前依赖的子依赖中
  parent.dependencies.set(filename, newPlugin);

  return newPlugin;
}
/** 获取App实例 */
export function useApp(): App {
    // Find the current App by traversing up from the current dependency
    // Or check if currentDependency is App
    let current = Dependency.currentDependency;
    while(current && current.parent) {
        current = current.parent;
    }
    
    if (current && (current instanceof App)) {
        return current;
    }
    // If not found, check stack directly for App?
    // App is always the root.
    if (current && current.name === 'App') return current as unknown as App;
    
    throw new Error("useApp must be called within a App Context");
}
export function defineModel<T extends Record<string, any>>(
  name: string,
  schema: Definition<T>
) {
  const plugin = usePlugin();
  return plugin.defineModel(name, schema);
}
export function addPermit<T extends RegisteredAdapter>(
  name: string | RegExp,
  checker: PermissionChecker<T>
) {
  const plugin = usePlugin();
  return plugin.addPermit(name, checker);
}
/** 获取当前插件实例 */
export function usePlugin(): Plugin {
  // Use Dependency.currentDependency which is now statically available
  try {
      const dep = Dependency.currentDependency;
      if (dep instanceof Plugin) return dep;
      // If it's App, it's also a Plugin
      return dep as unknown as Plugin;
  } catch (e) {
      // Fallback logic if needed, but usually currentDependency should be set
      throw e;
  }
}
export function beforeSend(handler: BeforeSendHandler) {
  const plugin = usePlugin();
  return plugin.beforeSend(handler);
}
/** 创建Context */
export function register<T>(context: Context<T, Plugin>): Context<T, Plugin> {
  const plugin = usePlugin();
  return plugin.register(context);
}
export function registerAdapter<T extends Adapter>(adapter: T) {
  const plugin = usePlugin();
  plugin.app.adapters.push(adapter.name);
  plugin.register({
    name: adapter.name,
    description: `adapter for ${adapter.name}`,
    async mounted(plugin) {
      await adapter.mounted(plugin);
      return adapter;
    },
    dispose() {
      return adapter.dispose(plugin);
    },
  });
}

/** 标记必需的Context */
export function useContext<T extends (keyof GlobalContext)[]>(
  ...args: [...T, sideEffect: SideEffect<T>]
): void {
  const plugin = usePlugin();
  plugin.useContext(...(args as any));
}

/** 添加中间件 */
export function addMiddleware(middleware: MessageMiddleware): void {
  const plugin = usePlugin();
  plugin.addMiddleware(middleware);
}
export function onDatabaseReady(
  callback: (
    database:
      | RelatedDatabase<any, Models>
      | DocumentDatabase<any, Models>
      | KeyValueDatabase<any, Models>
  ) => PromiseLike<void>
) {
  const plugin = usePlugin();
  if (plugin.app.database?.isStarted) callback(plugin.app.database);
  plugin.on("database.ready", callback);
}
export function useDatabase() {
  const plugin = usePlugin();
  return plugin.app.database;
}
export function onAppReady(callback: () => PromiseLike<void>) {
  const plugin = usePlugin();
  if (plugin.app.isReady) callback();
  plugin.on("app.ready", callback);
}
/** 添加指令 */
export function addCommand(command: MessageCommand): void {
  const plugin = usePlugin();
  plugin.addCommand(command);
}

/** 添加组件 */
export function addComponent<P = any>(component: Component<P>): void {
  const plugin = usePlugin();
  plugin.addComponent(component);
}

/** 监听事件 */
export function onEvent(
  event: string,
  listener: (...args: any[]) => any
): void {
  const plugin = usePlugin();
  plugin.on(event, listener);
}

/** 监听群组消息 */
export function onGroupMessage(
  handler: (message: Message) => void | Promise<void>
): void {
  onEvent("message.group.receive", handler);
}

/** 监听私聊消息 */
export function onPrivateMessage(
  handler: (message: Message) => void | Promise<void>
): void {
  onEvent("message.private.receive", handler);
}

/** 监听所有消息 */
export function onMessage<T extends RegisteredAdapter>(
  handler: (message: Message<AdapterMessage<T>>) => void | Promise<void>
): void {
  onEvent("message.receive", handler);
}
/** 获取下一条消息 */
export function usePrompt<P extends RegisteredAdapter>(
  message: Message<AdapterMessage<P>>
) {
  const plugin = usePlugin();
  return plugin.prompt<P>(message);
}

/** 监听插件挂载事件 */
export function onMounted(
  hook: (plugin: Plugin) => Promise<void> | void
): void {
  const plugin = usePlugin();
  if (plugin.isReady) hook(plugin);
  plugin.on("self.mounted", hook);
}

/** 监听插件销毁事件 */
export function onDispose(hook: () => void): void {
  const plugin = usePlugin();
  if (plugin.isDispose) hook();
  plugin.on("self.dispose", hook);
}

/** 发送消息 */
export async function sendMessage(options: SendOptions): Promise<void> {
  const app = useApp();
  await app.sendMessage(options);
}
export function defineSchema<S extends Schema>(rules: S): S {
  const plugin = usePlugin();
  return plugin.defineSchema(rules);
}
/** 获取App实例（用于高级操作） */
export function getAppInstance(): App {
  return useApp();
}

/** 获取插件日志记录器 */
export function useLogger(): Logger {
  const plugin = usePlugin();
  return plugin.logger;
}

/** 创建App实例的工厂函数 */
export async function createApp(config_file?: string): Promise<App> {
  const app = new App(config_file);
  await app.start();
  return app;
}
