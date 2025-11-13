import path from "path";
import { SideEffect, GlobalContext, Models } from "@zhin.js/types";
import { Schema } from '@zhin.js/hmr';
import {
  HMR,
  Context,
  Logger,
  getCallerFile,
  getCallerFiles,
  mergeConfig,
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
 * 继承自 HMR，支持插件生命周期、适配器管理、数据库集成等。
 */
export class App extends HMR<Plugin> {
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
    // 调用父类构造函数
    super({
      logger,
      dirs: config.get("plugin_dirs") || [],
      debug: config.get("debug"),
    });
    this.watching(config.filepath,()=>config.reload());
    this.on("message.send", this.sendMessage.bind(this));
    this.on("message.receive", this.receiveMessage.bind(this));
    process.on("uncaughtException", (e) => {
      const args = e instanceof Error ? [e.message, { stack: e.stack }] : [e];
      this.logger.error(...args);
    });
    process.on("unhandledRejection", (e) => {
      const args = e instanceof Error ? [e.message, { stack: e.stack }] : [e];
      this.logger.error(...args);
    });
    this.#config = config;
    // 监听配置变更
    config.on("change", (before, after) => {
      this.handleConfigChange(before, after);
      this.broadcast("config.change", before, after);
    });
    this.defineSchema(App.schema);
    setLevel(config.get("log_level") || LogLevel.INFO);
    this.middleware(this.messageMiddleware.bind(this));
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
    this.configChangeLock = this.applyConfigChanges(before, after);

    try {
      await this.configChangeLock;
    } finally {
      this.configChangeLock = null;
    }
  }

  /**
   * 应用配置变更
   */
  private async applyConfigChanges(
    before: AppConfig,
    after: AppConfig
  ): Promise<void> {
    try {
      // 1. 更新日志级别
      if (after.log_level !== before.log_level) {
        setLevel(after.log_level || LogLevel.INFO);
      }

      // 2. 更新监听目录
      await this.updateWatchDirs(
        before.plugin_dirs || [],
        after.plugin_dirs || []
      );

      // 3. 更新插件加载
      await this.updatePlugins(before.plugins || [], after.plugins || []);
    } catch (error) {
      this.logger.error("Failed to apply configuration changes:", error);
      throw error;
    }
    // 4. 更新数据库连接
    if (JSON.stringify(before.database) !== JSON.stringify(after.database)) {
      this.database?.stop();
      if (after.database) {
        this.database = Registry.create(
          (this.config.database as any).dialect,
          this.config.database,
          Object.fromEntries(this.definitions)
        );
        await this.database!.start();
      }
    }
  }

  /**
   * 更新监听目录
   */
  private async updateWatchDirs(
    oldDirs: string[],
    newDirs: string[]
  ): Promise<void> {
    const oldResolved = oldDirs.map((dir) => path.resolve(process.cwd(), dir));
    const newResolved = newDirs.map((dir) => path.resolve(process.cwd(), dir));

    // 找出需要移除的目录
    const dirsToRemove = oldResolved.filter(
      (dir) => !newResolved.includes(dir)
    );
    // 找出需要添加的目录
    const dirsToAdd = newResolved.filter((dir) => !oldResolved.includes(dir));

    // 按需监听模式：仍需要更新目录列表用于路径解析，但不启动目录监听
    // 移除过时的监听目录
    for (const dir of dirsToRemove) {
      this.removeDir(dir);
    }

    // 添加新的监听目录
    for (const dir of dirsToAdd) {
      this.addDir(dir);
    }
  }

  /**
   * 更新插件加载
   */
  private async updatePlugins(
    oldPlugins: string[],
    newPlugins: string[]
  ): Promise<void> {
    // 找出需要卸载的插件
    const pluginsToUnload = oldPlugins.filter(
      (plugin) => !newPlugins.includes(plugin)
    );
    // 找出需要加载的插件
    const pluginsToLoad = newPlugins.filter(
      (plugin) => !oldPlugins.includes(plugin)
    );

    // 卸载不再需要的插件
    for (const pluginName of pluginsToUnload) {
      await this.unloadPlugin(pluginName);
    }

    // 加载新插件
    for (const pluginName of pluginsToLoad) {
      this.use(pluginName);
    }

    // 等待新插件加载完成
    if (pluginsToLoad.length > 0) {
      await sleep(200);
      await this.waitForReady();
    }
  }

  /**
   * 卸载插件
   */
  private async unloadPlugin(pluginName: string): Promise<void> {
    // 尝试找到插件 (使用 HMR 提供的方法)
    const plugin = this.findPluginByName<Plugin>(pluginName);
    if (plugin) {
      // 找到插件的文件路径
      const filePath = plugin.filename;

      // 销毁插件
      plugin.dispose();

      // 从依赖映射中移除
      this.dependencies.delete(filePath);

      this.logger.info(`Plugin ${pluginName} unloaded successfully`);
    } else {
      this.logger.warn(`Plugin ${pluginName} not found, skipping unload`);
    }
  }
  async receiveMessage<P extends RegisteredAdapter>(
    message: Message<AdapterMessage<P>>
  ) {
    const middlewares = this.dependencyList.reduce(
      (result, plugin) => {
        result.push(...(plugin.middlewares as MessageMiddleware<P>[]));
        return result;
      },
      [...this.middlewares] as MessageMiddleware<P>[]
    );
    const handle = compose(middlewares);
    await handle(message);
  }
  async messageMiddleware(message: Message, next: () => Promise<void>) {
    for (const command of this.commands) {
      const result = await command.handle(message, this);
      if (result) message.$reply(result);
    }
    return next();
  }
  get commands() {
    return this.dependencyList.reduce((result, plugin) => {
      result.push(...plugin.commands);
      return result;
    }, [] as MessageCommand[]);
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
    if (newConfig.plugin_dirs) {
      // 动态更新监听目录
      const currentDirs = this.dirs;
      const newDirs = newConfig.plugin_dirs;

      // 移除不再需要的目录
      for (const dir of currentDirs) {
        if (!newDirs.includes(dir)) {
          this.removeDir(dir);
        }
      }
      // 添加新的目录
      for (const dir of newDirs) {
        if (!currentDirs.includes(dir)) {
          this.addDir(dir);
        }
      }
    }
    this.logger.info("App configuration updated", this.config);
  }
  get definitions() {
    return this.dependencyList.reduce(
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
  }
  /** 使用插件 */
  use(filePath: string): void {
    this.emit("internal.add", filePath);
  }
  async #init() {
    // 首次初始化时，执行配置应用逻辑
    await this.handleConfigChange(App.defaultConfig, this.config);

    // 初始化数据库
    const definitions: Record<string, Definition> = {};
    for (const [name, schema] of this.definitions) {
      definitions[name] = schema;
    }
    if (this.config.database) {
      this.database = Registry.create(
        (this.config.database as any).dialect,
        this.config.database,
        definitions
      );
      this.logger.info(`database init...`);
      await this.database?.start();
      this.logger.info(`database init success`);
      this.dispatch("database.ready", this.database);
    } else {
      this.logger.info(`database not configured, skipping database init`);
    }
    // 等待所有插件就绪
    await this.waitForReady();
  }
  /** 启动App */
  async start(mode: "dev" | "prod" = "prod"): Promise<void> {
    await generateEnvTypes(process.cwd());
    await this.#init();
    if (this.database) {
      // 初始化日志传输器
      this.logTransport = new DatabaseLogTransport(this);
      addTransport(this.logTransport);
      this.logger.info(`database log transport registered`);
    }
    this.logger.info("started successfully");
    this.dispatch("app.ready");
  }

  /** 停止App */
  async stop(): Promise<void> {
    this.logger.info("Stopping app...");

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

function getPlugin(hmr: HMR<Plugin>, filename: string): Plugin {
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
  const newPlugin = new Plugin(parent, name, filename);

  // 添加到当前依赖的子依赖中
  parent.dependencies.set(filename, newPlugin);

  return newPlugin;
}
/** 获取App实例 */
export function useApp(): App {
  const hmr = HMR.currentHMR;
  if (!hmr) throw new Error("useApp must be called within a App Context");
  return hmr as unknown as App;
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
  const hmr = HMR.currentHMR;
  if (!hmr) throw new Error("usePlugin must be called within a App Context");

  try {
    const currentFile = getCallerFile(import.meta.url);
    return getPlugin(hmr as unknown as HMR<Plugin>, currentFile);
  } catch (error) {
    // 如果无法获取当前文件，尝试从当前依赖获取
    if (HMR.currentDependency) {
      return HMR.currentDependency as unknown as Plugin;
    }
    throw error;
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
