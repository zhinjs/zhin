import path from "path";
import { SideEffect, GlobalContext, Models } from "@zhin.js/types";
import {
  HMR,
  Context,
  Logger,
  getCallerFile,
  getCallerFiles,
} from "@zhin.js/hmr";
import {
  AdapterMessage,
  AppConfig,
  BeforeSendHandler,
  RegisteredAdapter,
  SendOptions,
} from "./types.js";
import { Message } from "./message.js";
import { fileURLToPath } from "url";
import { generateEnvTypes } from "./types-generator.js";
import logger, { setName } from "@zhin.js/logger";
import { sleep } from "./utils.js";

// 创建静态logger用于配置加载等静态操作
setName("Zhin");
import { MessageMiddleware, Plugin } from "./plugin.js";
import { Adapter } from "./adapter";
import { MessageCommand } from "./command";
import { Component } from "./component";
import { RelatedDatabase,DocumentDatabase,KeyValueDatabase,Schema,Registry} from "@zhin.js/database";

// ============================================================================
// App 类（Zhin.js 应用主入口，负责插件热重载、配置管理、消息分发等）
// ============================================================================
/**
 * App类：Zhin.js 应用主入口，负责插件热重载、配置管理、消息分发等。
 * 继承自 HMR，支持插件生命周期、适配器管理、数据库集成等。
 */
export class App extends HMR<Plugin> {
  static currentPlugin: Plugin;
  private config: AppConfig;
  adapters: string[] = [];
  database?: RelatedDatabase<any,Models>|DocumentDatabase<any,Models>|KeyValueDatabase<any,Models>;
  /**
   * 构造函数：初始化应用，加载配置，注册全局异常处理
   * @param config 可选的应用配置，若为空则自动查找配置文件
   */
  constructor(config?: Partial<AppConfig>) {
    // 如果没有传入配置或配置为空对象，尝试自动加载配置文件
    let finalConfig: AppConfig;
    if (!config || Object.keys(config).length === 0) {
      try {
        // 异步加载配置，这里需要改为同步初始化
        logger.info("🔍 正在查找配置文件...");
        finalConfig = App.loadConfigSync();
        logger.info("✅ 配置文件加载成功");
      } catch (error) {
        logger.warn("⚠️  配置文件加载失败，使用默认配置", {
          error: error instanceof Error ? error.message : String(error),
        });
        finalConfig = Object.assign({}, App.defaultConfig);
      }
    } else {
      // 合并默认配置和传入的配置
      finalConfig = Object.assign({}, App.defaultConfig, config);
    }

    // 调用父类构造函数
    super("Zhin", {
      logger,
      dirs: finalConfig.plugin_dirs || [],
      extensions: new Set([".js", ".ts"]),
      debug: finalConfig.debug,
    });
    this.on("message.send", this.sendMessage.bind(this));
    process.on("uncaughtException", (e) => {
      this.logger.error(e);
    });
    process.on("unhandledRejection", (e) => {
      this.logger.error(e);
    });
    this.config = finalConfig;
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
    plugin_dirs: ["./plugins"],
    plugins: [],
    bots: [],
    debug: false,
  };
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
  getConfig(): Readonly<AppConfig> {
    return { ...this.config };
  }

  /** 更新App配置 */
  /**
   * 更新App配置
   * @param config 部分配置项，将与现有配置合并
   */
  updateConfig(config: Partial<AppConfig>): void {
    this.config = { ...this.config, ...config };

    // 更新HMR配置
    if (config.plugin_dirs) {
      // 动态更新监听目录
      const currentDirs = this.getWatchDirs();
      const newDirs = config.plugin_dirs;

      // 移除不再需要的目录
      for (const dir of currentDirs) {
        if (!newDirs.includes(dir)) {
          this.removeWatchDir(dir);
        }
      }

      // 添加新的目录
      for (const dir of newDirs) {
        if (!currentDirs.includes(dir)) {
          this.addWatchDir(dir);
        }
      }
    }

    this.logger.info("App configuration updated", this.config);
  }
  get schemas(){
    return this.dependencyList.reduce((result, plugin) => {
      plugin.schemas.forEach((schema, name) => {
        result.set(name, schema);
      });
      return result;
    }, new Map<string,Schema<any>>());
  }
  /** 使用插件 */
  use(filePath: string): void {
    this.emit("internal.add", filePath);
  }

  /** 启动App */
  async start(mode: "dev" | "prod" = "prod"): Promise<void> {
    await generateEnvTypes(process.cwd());
    // 加载插件
    for (const pluginName of this.config.plugins || []) {
      this.use(pluginName);
    }
    await sleep(200);
    const schemas:Record<string,Schema>={};
    for (const [name, schema] of this.schemas) {
      schemas[name]=schema;
    }
    this.database=Registry.create((this.config.database as any).dialect,this.config.database,schemas);
    await this.database?.start();
    this.logger.info(`database init success`);
    this.dispatch("database.ready",this.database);
    // 等待所有插件就绪
    await this.waitForReady();
    this.logger.info("started successfully");
    this.dispatch("app.ready");
  }

  /** 停止App */
  async stop(): Promise<void> {
    this.logger.info("Stopping app...");
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
  schema: Schema<T>,
) {
  const plugin = usePlugin();
  return plugin.defineModel(name, schema);
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
      await adapter.start(plugin);
      return adapter;
    },
    dispose() {
      return adapter.stop(plugin);
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
export function onDatabaseReady(callback: (database: RelatedDatabase<any,Models>|DocumentDatabase<any,Models>|KeyValueDatabase<any,Models>) => PromiseLike<void>) {
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
export function addComponent<T = {}, D = {}, P = Component.Props<T>>(
  component: Component<T, D, P>
): void {
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

/** 获取App实例（用于高级操作） */
export function getAppInstance(): App {
  return useApp();
}

/** 获取插件日志记录器 */
export function useLogger(): Logger {
  const plugin = usePlugin();
  return plugin.logger;
}
