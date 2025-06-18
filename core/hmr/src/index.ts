import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { Module } from 'module';

// ============================================================================
// 工具函数
// ============================================================================

/** 合并配置对象 */
function mergeConfig<T extends object, U extends Partial<T>>(defaults: T, config: U): T & U {
  return { ...defaults, ...config } as T & U;
}

/** 创建错误对象 */
function createError(message: string, details?: Record<string, unknown>): Error {
  const error = new Error(message);
  if (details) {
    Object.assign(error, details);
  }
  return error;
}

/** 解析文件路径 */
function resolvePath(dir: string): string {
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

// ============================================================================
// 类型定义
// ============================================================================

/** 日志记录器接口 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** 默认的 Console 日志记录器 */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly name: string,
    private readonly enableDebug: boolean
  ) {}

  debug(message: string, ...args: unknown[]): void {
    if (this.enableDebug) {
      console.log(`[DEBUG] ${this.name}: ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[INFO] ${this.name}: ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${this.name}: ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[ERROR] ${this.name}: ${message}`, ...args);
  }
}

// ============================================================================
// 常量定义
// ============================================================================

/** 默认的可监听文件扩展名集合 */
const DEFAULT_WATCHABLE_EXTENSIONS = new Set(['.js', '.ts','.cjs', '.json']);

/** 堆栈跟踪解析正则表达式 */
const STACK_TRACE_REGEX = /at\s+.*\s+\((.+):\d+:\d+\)/;

/** 错误消息常量 */
const ERROR_MESSAGES = {
  CONTEXT_NOT_FOUND: 'Effect context not found',
  CALLER_FILE_NOT_FOUND: 'Cannot determine caller file',
  CIRCULAR_DEPENDENCY: 'Circular dependency detected',
  MODULE_NOT_FOUND: 'Module not found in dirs',
  PLUGIN_NOT_FOUND: 'Plugin not found',
  INVALID_CONFIG: 'Invalid configuration',
} as const;

/** 默认配置常量 */
const DEFAULT_CONFIG = {
  MAX_LISTENERS: 100, // 减少默认的事件监听器数量
  RELOAD_DEBOUNCE_MS: 50,
  HASH_ALGORITHM: 'md5' as const,
  ENABLE_DEBUG: false,
  WATCH_OPTIONS: {
    usePolling: true,
    interval: 1000, // 1秒的轮询间隔
    followSymlinks: false,
    ignoreInitial: false,
    awaitWriteFinish: false,
    persistent: true
  }
} as const;

/** 依赖解析结果 */
interface DependencyResolution {
  resolved: Map<string, PluginVersion>;
  conflicts: Array<{
    name: string;
    required: string;
    found: string;
  }>;
}

/** 默认 HMR 配置 */
const DEFAULT_HMR_CONFIG: Required<Omit<HMRConfig,'logger'>> & {
  logger: Logger;
} = {
  priority: 0,
  disable_dependencies: [],
  dirs: [],
  enabled: true,
  extensions: DEFAULT_WATCHABLE_EXTENSIONS,
  max_listeners: DEFAULT_CONFIG.MAX_LISTENERS,
  debounce: DEFAULT_CONFIG.RELOAD_DEBOUNCE_MS,
  algorithm: DEFAULT_CONFIG.HASH_ALGORITHM,
  debug: DEFAULT_CONFIG.ENABLE_DEBUG,
  version: '1.0.0',
  logger: new ConsoleLogger('hmr', DEFAULT_CONFIG.ENABLE_DEBUG)
};

// ============================================================================
// 高级类型定义 - 改进类型精确性和扩展性
// ============================================================================

// Context 接口
export interface Context<T = any> {
  name: string;
  value?: T;
  mounted?:(parent:Dependency) => T|Promise<T>;
  dispose?: (value:T) => void;
}

/** 插件版本信息接口 */
export interface PluginVersion {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** 依赖配置接口 */
export interface DependencyConfig {
  /** 依赖是否启用 */
  enabled?: boolean;
  /** 依赖优先级（数字越大优先级越高） */
  disable_dependencies?: string[];
  /** 依赖版本要求 */
  version?: string;
  priority?: number;
}

/** 监听器配置接口 */
export interface HMRConfig extends DependencyConfig {
  /** 可监听的文件扩展名 */
  extensions?: Set<string>;
  /** 要监听的目录列表 */
  dirs?: string[];
  /** 最大事件监听器数量 */
  max_listeners?: number;
  /** 重载防抖时间（毫秒） */
  debounce?: number;
  /** 哈希算法 */
  algorithm?: string;
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 自定义日志记录器 */
  logger?: Logger;
}

/** 插件事件类型映射 */
interface PluginEventMap {
  'add': [Dependency];
  'remove': [Dependency];
  'change': [Dependency];
  'error': [Dependency, Error];
  'dispose': [];
  'config-changed': [string, unknown];
  [key: string]: unknown[];
}

// ============================================================================
// 依赖基类 - 事件驱动的依赖系统基础（增强版）
// ============================================================================

/**
 * 依赖基类：提供事件系统和依赖层次结构管理
 *
 * 功能特性：
 * - 基于EventEmitter的事件系统
 * - 支持插件间的父子关系
 * - 提供插件查找和事件分发功能
 * - 支持哈希和修改时间管理（用于热重载）
 * - 配置管理系统
 * - 生命周期状态管理
 *
 * 设计模式：
 * - 观察者模式：事件系统
 * - 策略模式：可配置的行为
 *
 * @template P 依赖类型，必须继承自Dependency
 */
export class Dependency<P extends Dependency = any> extends EventEmitter {
  /** 文件内容的MD5哈希值，用于检测文件变化 */
  hash?: string;

  /** 文件最后修改时间，用于优化文件变化检测 */
  mtime?: Date;

  /** 上下文映射，只在需要时创建 */
  private _contexts?: Map<string,Context>;

  /** 必需的上下文集合，只在需要时创建 */
  private _requiredContexts?: Set<string>;

  /** 子依赖映射表，键为文件路径，值为依赖实例 */
  private _dependencies?: Map<string, P>;

  private readyPromise: Promise<void> | null = null;

  /** 依赖配置 */
  public config: DependencyConfig = {};

  /** 生命周期状态 */
  private lifecycleState: 'waiting' | 'ready' | 'disposed' = 'waiting';

  /**
   * 构造函数
   * @param name 依赖名称
   * @param filename 依赖文件路径
   * @param config 依赖配置
   */
  constructor(
    public parent:Dependency<P>|null,
    public name: string,
    public filename: string,
    config: DependencyConfig = {}
  ) {
    super();
    this.config = mergeConfig({ enabled: true, priority: 0 }, config);
    // 减少默认的事件监听器数量
    this.setMaxListeners(5);
  }

  // 懒加载 contexts
  get contexts(): Map<string,Context> {
    if (!this._contexts) {
      this._contexts = new Map();
    }
    return this._contexts;
  }

  // 懒加载 requiredContexts
  get requiredContexts(): Set<string> {
    if (!this._requiredContexts) {
      this._requiredContexts = new Set();
    }
    return this._requiredContexts;
  }

  // 懒加载 dependencies
  get dependencies(): Map<string, P> {
    if (!this._dependencies) {
      this._dependencies = new Map();
    }
    return this._dependencies;
  }

  /**
   * 获取依赖配置
   */
  getConfig(): Readonly<DependencyConfig> {
    return { ...this.config };
  }

  /**
   * 更新依赖配置
   * @param config 新的配置
   */
  updateConfig(config: Partial<DependencyConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    this.emit('config-changed', oldConfig, this.config);
  }

  /**
   * 获取生命周期状态
   */
  getLifecycleState(): 'waiting' | 'ready' | 'disposed' {
    return this.lifecycleState;
  }

  /**
   * 设置生命周期状态
   * @param state 新状态
   */
  setLifecycleState(state: 'waiting' | 'ready' | 'disposed'): void {
    const oldState = this.lifecycleState;
    this.lifecycleState = state;
    this.emit('lifecycle-changed', oldState, state);
  }

  /**
   * 在依赖树中查找指定文件路径的子依赖
   *
   * 算法：深度优先搜索
   * 1. 首先在直接子依赖中查找
   * 2. 如果未找到，递归在每个子依赖中查找
   *
   * @template T 返回的依赖类型
   * @param filename 要查找的文件路径
   * @returns 找到的依赖实例，未找到返回undefined
   */
  findChild<T extends P>(filename: string): T | void {
    // 直接查找
    const result = this.dependencies.get(filename) as T;
    if (result) return result;

    // 递归查找
    for (const dep of this.dependencies.values()) {
      const result = dep.findChild<T>(filename);
      if (result) return result;
    }
  }

  /**
   * 按名称查找依赖
   * @param name 依赖名称
   * @returns 找到的依赖实例
   */
  findPluginByName<T extends P>(name: string): T | void {
    // 在直接子依赖中查找
    for (const dependency of this.dependencies.values()) {
      if (dependency.name === name) return dependency as T;
    }

    // 递归查找
    for (const child of this.dependencies.values()) {
      const result = child.findPluginByName<T>(name);
      if (result) return result;
    }
  }

  /**
   * 获取所有启用的依赖
   * @returns 启用的依赖数组
   */
  getEnabledDependencies(): P[] {
    const enabled: P[] = [];

    for (const dependency of this.dependencies.values()) {
      if (dependency.getConfig().enabled) {
        enabled.push(dependency);
        enabled.push(...dependency.getEnabledDependencies());
      }
    }

    // 按优先级排序
    return enabled.sort((a, b) => (b.getConfig().priority || 0) - (a.getConfig().priority || 0));
  }

  /**
   * 分发事件到当前依赖及所有子依赖
   *
   * 事件传播策略：
   * 1. 首先在当前依赖触发事件
   * 2. 然后向下传播到所有启用的子依赖
   *
   * @param eventName 事件名称
   * @param args 事件参数
   */
  dispatch<K extends keyof PluginEventMap>(
    eventName: K,
    ...args: PluginEventMap[K]
  ): void;
  dispatch(eventName: string | symbol, ...args: unknown[]): void;
  dispatch(eventName: string | symbol, ...args: unknown[]): void {
    if(this.parent) return this.parent.dispatch(eventName, ...args);
    this.broadcast(eventName, ...args);
  }
  broadcast<K extends keyof PluginEventMap>(
    eventName: K,
    ...args: PluginEventMap[K]
  ): void;
  broadcast(eventName: string | symbol, ...args: unknown[]): void
  broadcast(eventName: string | symbol, ...args: unknown[]): void  {// 在当前插件触发事件
    this.emit(eventName, ...args);
    // 只向启用的子插件分发事件
    const enabledDependencies = this.getEnabledDependencies();
    for (const child of enabledDependencies) {
      child.emit(eventName, ...args);
    }
  }

  get dependencyList():P[]{
    const deps=Array.from(this.dependencies.values()).filter(dependency=>!this.config.disable_dependencies?.includes(dependency.name));
    return deps.reduce((acc,dependency)=>{
      acc.push(...dependency.dependencyList);
      return acc;
    },deps);
  }
  get allDependencies():P[]{
    if(this.parent) return this.parent.allDependencies;
    return this.dependencyList;
  }
  get contextList():Context[]{
    return Array.from(this.dependencies.values()).reduce((acc,dependency)=>{
      acc.push(...dependency.contexts.values());
      return acc;
    },[...this.contexts.values()] as Context[]);
  }
  createContext<T>(context:Context<T>):Context<T>{
    this.contexts.set(context.name,context);
    return context;
  }
  // 获取 Context 值
  useContext<T>(name: string): Context<T> {
    if(this.parent) return this.parent.useContext<T>(name);
    const context= this.contextList.find(context=>context.name===name);
    if(!context) throw new Error(`Context ${name} not found`);
    return context as Context<T>;
  }

  // 等待依赖就绪
  async waitForReady(): Promise<void> {
    if (this.lifecycleState==='ready') return;
    if (!this.readyPromise) {
      this.readyPromise = this.mounted();
    }
    return this.readyPromise;
  }
  async #waitContextReady():Promise<void>{
    if(!this.requiredContexts.size) return;
    if(Array.from(this.requiredContexts).every(name=>this.contexts.get(name)?.value)) return;
    return new Promise((resolve)=>{
      const arr=Array.from(this.requiredContexts);
      const listener=(parent:Dependency<P>)=>{
        if(arr.every(name=>parent.useContext(name)?.value)){
          this.off('context.ready',listener);
          resolve()
        };
      }
      this.on('context.ready',listener);
      listener(this.parent!);
    })
  }
  // 初始化异步操作
  async mounted(): Promise<void> {;
    // 等待所需的Context就绪
    await this.#waitContextReady();
    // 初始化当前依赖的Context
    for(const [name,context] of this.contexts){
      if(context.mounted) context.value=await context.mounted(this.parent!);
      this.dispatch('context.ready',this.parent);
    }
    // 初始化依赖
    const hooks=this.listeners('mounted')||[];
    // 按顺序执行所有异步钩子
    for (const hook of hooks) {
      await hook(this);
    }
    await Promise.all(Array.from(this.dependencies.values()).map(dependency=>dependency.mounted()));
    this.lifecycleState = 'ready';
  }
  dispose(): void {
    // 清理异步钩子
    if (this._contexts) {
      for (const [name, context] of this._contexts) {
        if (context.dispose) context.dispose(context.value);
        this.parent?.emit('context.dispose', context, this.parent);
        context.value = undefined;
      }
      this._contexts.clear();
      this._contexts = undefined;
    }

    if (this._requiredContexts) {
      this._requiredContexts.clear();
      this._requiredContexts = undefined;
    }

    if (this._dependencies) {
      for (const dep of this._dependencies.values()) {
        dep.dispose();
      }
      this._dependencies.clear();
      this._dependencies = undefined;
    }

    this.lifecycleState = 'disposed';
    this.readyPromise = null;

    // 清理所有事件监听器
    this.removeAllListeners();
  }
}

// ============================================================================
// 热重载系统 - 高性能的插件热重载系统
// ============================================================================

/**
 * 抽象热重载系统类：实现插件的热重载和生命周期管理
 *
 * 核心功能：
 * - 文件系统监听：监听多个目录的文件变化
 * - 智能变化检测：结合mtime和hash的双重检测机制
 * - 模块解析：类似Node.js的模块解析算法
 * - 插件生命周期：等待、就绪、销毁的完整管理
 * - 循环依赖检测：防止无限递归加载
 * - 内存管理：require缓存清理和资源释放
 *
 * 设计模式：
 * - 观察者模式：文件系统事件监听
 * - 模板方法模式：抽象的createDependency方法
 * - 单例模式：静态的上下文栈管理
 *
 * @template P 依赖类型，必须继承自Dependency
 */
export abstract class HMR<P extends Dependency = Dependency> extends Dependency<P> {
  // ========================================================================
  // 静态上下文管理 - 实现React Hooks风格的上下文
  // ========================================================================

  /** 监听器上下文栈，用于获取当前活跃的监听器 */
  private static _hmrStack?: HMR<any>[];

  /** 依赖上下文栈，用于获取当前正在处理的依赖 */
  private static _dependencyStack?: Dependency[];

  /** 模块扩展名缓存，避免重复获取 */
  private static _cachedExtensions?: string[];

  /** 正在加载的依赖路径集合，用于循环依赖检测 */
  private static _loadingDependencies?: Set<string>;

  // 懒加载静态属性
  static get hmrStack(): HMR<any>[] {
    if (!this._hmrStack) {
      this._hmrStack = [];
    }
    return this._hmrStack;
  }

  static get dependencyStack(): Dependency[] {
    if (!this._dependencyStack) {
      this._dependencyStack = [];
    }
    return this._dependencyStack;
  }

  static get cachedExtensions(): string[] | null {
    return this._cachedExtensions || null;
  }

  static set cachedExtensions(value: string[] | null) {
    this._cachedExtensions = value || undefined;
  }

  static get loadingDependencies(): Set<string> {
    if (!this._loadingDependencies) {
      this._loadingDependencies = new Set();
    }
    return this._loadingDependencies;
  }

  // ========================================================================
  // 实例字段 - 私有字段保证封装性
  // ========================================================================

  /** 目录监听器映射表 */
  #dirWatchers = new Map<string, fs.FSWatcher>();

  /** 要监听的目录列表 */
  #dirs: string[] = [];

  /** 可监听的文件扩展名集合，用于过滤无关文件 */
  #watchableExtensions = DEFAULT_WATCHABLE_EXTENSIONS;

  /** 监听器配置 */
  config!: HMRConfig;

  /** 性能监控数据 */
  #performanceStats = {
    startTime: Date.now(),
    reloads: 0,
    errors: 0,
    lastReloadTime: 0,
    totalReloadTime: 0,
    fileChanges: 0
  };

  /** 日志记录器 */
  #logger!: Logger;

  /** 重载防抖定时器映射 */
  #reloadTimers = new Map<string, NodeJS.Timeout>();

  /** 插件版本信息映射 */
  #pluginVersions = new Map<string, PluginVersion>();

  // ========================================================================
  // 静态上下文访问器 - 实现Hooks风格的API
  // ========================================================================

  /**
   * 获取当前活跃的监听器实例
   * 类似React的useContext，必须在监听器上下文中调用
   */
  static get currentHMR(): HMR {
    if (this.hmrStack.length === 0) {
      throw new Error(ERROR_MESSAGES.CONTEXT_NOT_FOUND);
    }
    return this.hmrStack[this.hmrStack.length - 1];
  }

  /**
   * 获取当前正在处理的插件实例
   * 用于在插件加载过程中获取上下文
   */
  static get currentDependency(): Dependency {
    if (this.dependencyStack.length === 0) {
      throw new Error(ERROR_MESSAGES.CONTEXT_NOT_FOUND);
    }
    return this.dependencyStack[this.dependencyStack.length - 1];
  }

  /**
   * 获取调用者的文件路径
   *
   * 算法：解析调用栈
   * 1. 获取当前调用栈
   * 2. 过滤掉指定的文件（避免获取到框架自身的路径）
   * 3. 返回第一个有效的调用者文件路径
   *
   * @param beside 要排除的文件路径
   * @returns 调用者文件的绝对路径
   */
  static getCurrentFile(beside: string = __filename): string {
    const callerFile = new Error().stack?.split('\n')
      .map(s => s.match(STACK_TRACE_REGEX)?.[1])
      .find(row => row && row !== beside && row !== __filename);

    if (!callerFile) {
      throw new Error(ERROR_MESSAGES.CALLER_FILE_NOT_FOUND);
    }
    return callerFile;
  }

  /**
   * 获取完整的调用栈
   * 用于调试和高级功能
   *
   * @param beside 要排除的文件路径
   * @returns 调用栈数组
   */
  static getCurrentStack(beside: string = __filename): string[] {
    const stack = new Error().stack?.split('\n')
      .map(s => s.match(STACK_TRACE_REGEX)?.[1])
      .filter((row): row is string => row !== undefined && row !== beside && row !== __filename);

    if (!stack?.length) {
      throw new Error(ERROR_MESSAGES.CALLER_FILE_NOT_FOUND);
    }
    return stack;
  }
  /**
   * 获取Node.js支持的模块扩展名
   *
   * 优化策略：
   * - 使用静态缓存避免重复获取
   * - 延迟初始化，按需加载
   *
   * @returns 支持的扩展名数组
   */
  private static getModuleExtensions(): string[] {
    if (!this.cachedExtensions) {
      this.cachedExtensions = Object.keys((Module as any)._extensions);
    }
    return this.cachedExtensions;
  }

  // ========================================================================
  // 测试接口 - 为测试提供内部状态访问
  // ========================================================================

  /**
   * 测试接口：提供对内部状态的受控访问
   *
   * 设计原则：
   * - 只在测试环境使用
   * - 不破坏封装性
   * - 提供最小必要的访问权限
   */
  public getTestInterface(): {
    watchableExtensions: Set<string>;
    isWatchableFile: (filename: string) => boolean;
    dirWatchers: Map<string, fs.FSWatcher>;
    getLoadingDependencies: () => Set<string>;
    getCachedExtensions: () => string[] | null;
    setCachedExtensions: (value: string[] | null) => void;
    getModuleExtensions: () => string[];
    import: (name: string, filePath: string, parent?: P) => void;
    hasFileChanged: (filePath: string, dependency: P) => boolean;
  } {
    return {
      watchableExtensions: this.#watchableExtensions,
      isWatchableFile: this.#isWatchableFile.bind(this),
      dirWatchers: this.#dirWatchers,
      getLoadingDependencies: () => HMR.loadingDependencies,
      getCachedExtensions: () => HMR.cachedExtensions,
      setCachedExtensions: (value: string[] | null) => {
        HMR.cachedExtensions = value;
      },
      getModuleExtensions: HMR.getModuleExtensions,
      import: (name: string, filePath: string, parent: P = this as unknown as P) => this.#import(name, filePath, parent),
      hasFileChanged: (filePath: string, dependency: P) => this.#hasFileChanged(filePath, dependency)
    };
  }

  // ========================================================================
  // 构造函数和初始化
  // ========================================================================

  /**
   * 构造函数：初始化文件监听器
   *
   * @param dirs 要监听的目录列表，默认为当前工作目录
   * @param config 监听器配置
   */
  constructor(name:string,filename:string,config: HMRConfig = {}) {
    super(null,name,filename,config);
    this.config = mergeConfig(DEFAULT_HMR_CONFIG, config);
    this.#dirs = this.config.dirs||[];

    // 初始化日志记录器
    this.#logger = config.logger ?? new ConsoleLogger(this.name, this.config.debug ?? DEFAULT_CONFIG.ENABLE_DEBUG);

    if (this.config.extensions) {
      this.#watchableExtensions = this.config.extensions;
    }

    this.setMaxListeners(5); // 减少默认的事件监听器数量
    this.#setupDirWatchers();

    this.on('internal.add', (filePath: string) => {
      this.#add(filePath);
    });
  }

  // ========================================================================
  // 文件过滤和监听设置
  // ========================================================================

  /**
   * 检查文件是否应该被监听
   *
   * 过滤策略：基于文件扩展名的白名单机制
   * 优势：减少无关文件的监听，提高性能
   *
   * @param filename 文件名
   * @returns 是否应该监听此文件
   */
  #isWatchableFile(filename: string): boolean {
    const ext = path.extname(filename);
    return this.#watchableExtensions.has(ext);
  }

  /**
   * 设置目录监听器
   */
  #setupDirWatchers(): void {
    const watchedDirs = new Set<string>();

    for (const dir of this.#dirs) {
      const absDir = resolvePath(dir);

      if (watchedDirs.has(absDir)) continue;
      watchedDirs.add(absDir);

      this.#setupDirWatcher(absDir);
    }
  }

  /**
   * 设置单个目录的监听器
   * @param dir 目录路径
   */
  #setupDirWatcher(dir: string): void {
    try {
      const watcher = fs.watch(dir, (filePath: string) => {
        this.#logger.debug('File changed', { filePath });
        const dependency = this.findChild<P>(filePath);
        if (dependency) {
          this.#handleFileChange(filePath, dependency);
        }
      });
      this.#dirWatchers.set(dir, watcher);
      this.#logger.info('Directory watcher setup', { dir });
    } catch (error) {
      this.#logger.error('Failed to setup directory watcher', { error, dir });
      this.emit('error', error);
    }
  }

  /**
   * 处理文件变化事件
   * 添加节流机制避免频繁触发
   */
  #handleFileChange(filePath: string, dependency: P): void {
    this.#performanceStats.fileChanges++;

    const fileChanged = this.#hasFileChanged(filePath, dependency);
    if (fileChanged) {
      this.#logger.debug('File changed detected', { filePath, dependency: dependency.name });
      this.emit('change', dependency);
      this.#scheduleReload(dependency);
    }
  }

  // ========================================================================
  // 智能文件变化检测
  // ========================================================================

  /**
   * 检测文件是否发生变化
   *
   * 优化算法：mtime优先 + hash兜底
   * 1. 首先检查文件修改时间(mtime)
   * 2. 只有mtime变化时才计算hash
   * 3. hash不同才认为文件真正变化
   *
   * 性能优势：
   * - 避免不必要的文件读取和hash计算
   * - mtime检查是O(1)操作，hash计算是O(n)操作
   * - 对于大文件优化效果显著
   *
   * @param filePath 文件路径
   * @param dependency 对应的依赖实例
   * @returns 文件是否发生变化
   */
  #hasFileChanged(filePath: string, dependency: P): boolean {
    try {
      const stats = fs.statSync(filePath);
      const currentMtime = stats.mtime;

      // mtime优先检查：如果mtime没变，文件肯定没变
      if (!dependency.mtime || currentMtime > dependency.mtime) {
        const newHash = this.#hashFile(filePath);

        // hash变化才认为文件真正变化
        if (newHash !== dependency.hash) {
          dependency.hash = newHash;
          dependency.mtime = currentMtime;
          return true;
        }

        // hash没变但mtime变了，更新mtime
        dependency.mtime = currentMtime;
      }

      return false;
    } catch (error) {
      // 文件可能已被删除，返回true触发重新加载逻辑
      return true;
    }
  }

  // ========================================================================
  // 模块解析系统
  // ========================================================================

  /**
   * 解析模块路径
   *
   * 解析算法：类似Node.js的模块解析
   * 1. 如果是绝对路径，直接返回
   * 2. 在搜索目录中查找
   * 3. 尝试添加各种扩展名
   * 4. 尝试查找index文件
   * 5. 使用require.resolve作为兜底
   *
   * 搜索策略：
   * - 优先在调用者所在目录搜索
   * - 然后在配置的监听目录中搜索
   * - 支持多种文件扩展名
   *
   * @param request 模块请求路径
   * @returns 解析后的绝对路径
   */
  #resolve(request: string): string {
    // 绝对路径直接返回
    if (path.isAbsolute(request)) return request;

    const searchDirs = [
      ...this.#dirs.map(dir =>
        path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
      )
    ];

    // 在搜索目录中查找
    for (const dir of searchDirs) {
      const extensions = HMR.getModuleExtensions();
      for (const ext of extensions) {
        const testPath = path.join(dir, request + ext);
        if (fs.existsSync(testPath)) return testPath;
      }
    }

    // 使用Node.js的模块解析作为兜底
    try {
      return require.resolve(request, { paths: searchDirs });
    } catch (e) {
      // 如果不是index文件，尝试查找index
      if (request.endsWith(path.sep + 'index')) {
        throw new Error(
          `[${request}]${ERROR_MESSAGES.MODULE_NOT_FOUND}: ${searchDirs.join(', ')}`
        );
      }
      return this.#resolve(request + path.sep + 'index');
    }
  }

  // ========================================================================
  // 插件生命周期管理
  // ========================================================================

  /**
   * 添加插件的便捷方法
   *
   * @param name 插件名称
   */
  #add(name: string): this {
    this.#import(name, this.#resolve(name));
    return this;
  }

  /**
   * 抽象方法：创建插件实例
   *
   * 模板方法模式：子类必须实现具体的插件创建逻辑
   *
   * @param name 插件名称
   * @param filePath 文件路径
   */
  abstract createDependency(name: string, filePath: string): P;

  /**
   * 解析插件依赖
   * 使用拓扑排序确保正确的加载顺序
   */
  #resolveDependencies(plugin: P): DependencyResolution {
    const resolved = new Map<string, PluginVersion>();
    const conflicts: DependencyResolution['conflicts'] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (name: string, version: string) => {
      if (temp.has(name)) {
        throw new Error(`Circular dependency detected: ${name}`);
      }
      if (visited.has(name)) {
        const existing = resolved.get(name);
        if (existing && existing.version !== version) {
          conflicts.push({
            name,
            required: version,
            found: existing.version
          });
        }
        return;
      }

      temp.add(name);
      const pluginVersion = this.#pluginVersions.get(name);
      if (!pluginVersion) {
        throw new Error(`Plugin not found: ${name}`);
      }

      // 检查依赖版本
      if (pluginVersion.dependencies) {
        for (const [depName, depVersion] of Object.entries(pluginVersion.dependencies)) {
          visit(depName, depVersion);
        }
      }

      temp.delete(name);
      visited.add(name);
      resolved.set(name, pluginVersion);
    };

    const version = this.#pluginVersions.get(plugin.name);
    if (version) {
      visit(plugin.name, version.version);
    }

    return { resolved, conflicts };
  }

  /**
   * 注册插件版本信息
   */
  registerPluginVersion(version: PluginVersion): void {
    this.#pluginVersions.set(version.name, version);
  }

  /**
   * 获取插件版本信息
   */
  getPluginVersion(name: string): PluginVersion | undefined {
    return this.#pluginVersions.get(name);
  }

  /**
   * 检查插件版本兼容性
   */
  checkVersionCompatibility(plugin: P): boolean {
    const resolution = this.#resolveDependencies(plugin);
    return resolution.conflicts.length === 0;
  }

  /**
   * 导入插件
   *
   * 加载策略：
   * 1. 重复加载检查
   * 2. 循环依赖检测
   * 3. 插件实例创建
   * 4. 文件信息记录（hash、mtime）
   * 5. 上下文设置
   * 6. 模块加载
   * 7. 事件通知
   * 8. 错误处理和清理
   *
   * 安全机制：
   * - 循环依赖检测防止无限递归
   * - 加载失败时自动清理资源
   * - 上下文栈的正确管理
   *
   * @param name 插件名称
   * @param filePath 文件路径
   * @param parent 父插件，默认为当前监听器
   */
  #import(name: string, filePath: string, parent: Dependency = this): void {
    if (this.dependencies.has(filePath)) return;

    if (HMR.loadingDependencies.has(filePath)) {
      throw createError(ERROR_MESSAGES.CIRCULAR_DEPENDENCY, { filePath });
    }

    const dependency = this.createDependency(name, filePath);

    // 检查版本兼容性
    if (!this.checkVersionCompatibility(dependency)) {
      throw createError('Version conflict detected', {
        plugin: name,
        filePath
      });
    }

    parent.dependencies.set(filePath, dependency);
    HMR.loadingDependencies.add(filePath);

    try {
      const stats = fs.statSync(filePath);
      dependency.hash = this.#hashFile(filePath);
      dependency.mtime = stats.mtime;

      dependency.setLifecycleState('waiting');

      HMR.hmrStack.push(this);
      HMR.dependencyStack.push(dependency);

      require(filePath);

      dependency.setLifecycleState('ready');

      this.emit('add', dependency);
    } catch (error) {
      parent.dependencies.delete(filePath);
      throw error;
    } finally {
      HMR.loadingDependencies.delete(filePath);
      HMR.hmrStack.pop();
      HMR.dependencyStack.pop();
    }
  }

  /**
   * 计算文件的哈希值（支持多种算法）
   */
  #hashFile(filePath: string): string {
    try {
      const stats = fs.statSync(filePath);
      // 对于小文件，直接使用 mtime 作为变化检测
      if (stats.size < 1024 * 1024) { // 1MB
        return stats.mtime.getTime().toString();
      }

      // 大文件才计算哈希
      const algorithm = this.config.algorithm || 'md5';
      return crypto
        .createHash(algorithm)
        .update(fs.readFileSync(filePath, 'utf-8'))
        .digest('hex');
    } catch (error) {
      this.#logger.error('Error calculating file hash', { error, filePath });
      return Date.now().toString(); // 出错时使用时间戳
    }
  }

  /**
   * 计划重新加载插件（带防抖功能）
   *
   * 防抖策略：
   * - 短时间内多次文件变化只触发一次重载
   * - 避免编辑器保存时的多次触发
   * - 提高性能和用户体验
   *
   * @param dependency 要重载的依赖
   */
  #scheduleReload(dependency: P): void {
    const dependencyKey = dependency.filename;

    // 清除之前的定时器
    const existingTimer = this.#reloadTimers.get(dependencyKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 设置新的防抖定时器
    const timer = setTimeout(() => {
      this.#performanceStats.reloads++;
      this.#performanceStats.lastReloadTime = Date.now();
      this.#logger.debug('Executing scheduled reload', { dependency: dependency.name });
      this.#reload(dependency);
      this.#reloadTimers.delete(dependencyKey);
    }, this.config.debounce || DEFAULT_CONFIG.RELOAD_DEBOUNCE_MS);

    this.#reloadTimers.set(dependencyKey, timer);
  }
  /**
   * 重新加载依赖
   */
  async #reload(dependency: P): Promise<void> {
    const parent = this.allDependencies.find(dep => dep.filename === dependency.parent?.filename) || this;
    const oldContexts = new Map(dependency.contexts);
    const contextNames = dependency.contextList.map(context => context.name);
    const contextDeps = this.allDependencies.filter(dep => dep.filename !== dependency.filename);

    try {
      this.#remove(dependency);
      this.#import(dependency.name, dependency.filename, parent);

      // 获取新创建的插件实例
      const newDependency = parent.dependencies.get(dependency.filename)!;

      // 恢复之前的 contexts
      for (const [name, context] of oldContexts) {
        newDependency.contexts.set(name, context);
      }

      // 确保新插件初始化
      await newDependency.mounted();

      // 重新加载依赖的插件
      await Promise.all(
        contextDeps
          .filter(dep => contextNames.some(name => dep.requiredContexts.has(name)))
          .map(dep => this.#reload(dep))
      );
    } catch (error) {
      this.#logger.error('Plugin reload failed', {
        plugin: dependency.name,
        error
      });
      throw error;
    }
  }

  /**
   * 移除插件
   *
   * 清理策略：
   * 1. 触发dispose事件（让插件自清理）
   * 2. 递归移除所有子插件
   * 3. 清理require缓存
   * 4. 从插件映射中移除
   * 5. 通知插件已移除
   *
   * 内存管理：
   * - 彻底清理require缓存防止内存泄漏
   * - 递归清理保证完整性
   *
   * @param dependency 要移除的依赖
   */
  #remove(dependency: P): void {
    // 设置销毁状态
    dependency.setLifecycleState('disposed');
    // 触发清理事件
    dependency.broadcast('dispose',dependency);
    dependency.dispose();
    const parent = dependency.parent ?? this;
    const cache = require.cache[dependency.filename];

    if (cache) {
      // 递归移除所有依赖的子插件
      cache.children.forEach(child => {
        if (parent.dependencies.has(child.filename)) {
          this.#remove(parent.dependencies.get(child.filename)!);
        }
      });
    }

    // 清理缓存和引用
    delete require.cache[dependency.filename];
    parent.dependencies.delete(dependency.filename);

    // 通知插件已移除
    this.emit('remove', dependency);
  }

  // ========================================================================
  // 资源清理和销毁
  // ========================================================================

  /**
   * 销毁监听器并清理所有资源
   */
  dispose(): void {
    // 移除所有插件
    this.dependencies.forEach((dependency) => this.#remove(dependency));

    // 关闭所有文件监听器
    this.#dirWatchers.forEach(watcher => {
      try {
        watcher.close();
      } catch (error) {
        this.#logger.error('Error closing watcher', { error });
      }
    });
    this.#dirWatchers.clear();

    // 清理静态缓存
    HMR._cachedExtensions = undefined;
    HMR._loadingDependencies = undefined;
    HMR._hmrStack = undefined;
    HMR._dependencyStack = undefined;

    // 清理事件监听器
    this.removeAllListeners();

    // 清理定时器
    this.#reloadTimers.forEach(timer => clearTimeout(timer));
    this.#reloadTimers.clear();

    // 清理版本信息
    this.#pluginVersions.clear();

    // 重置性能统计
    this.#performanceStats = {
      startTime: Date.now(),
      reloads: 0,
      errors: 0,
      lastReloadTime: 0,
      totalReloadTime: 0,
      fileChanges: 0
    };
  }

  // ========================================================================
  // 配置管理和性能监控
  // ========================================================================

  /**
   * 获取监听器配置
   * @returns 当前配置的只读副本
   */
  getConfig(): Readonly<HMRConfig> {
    return { ...this.config };
  }

  /**
   * 更新监听器配置
   * @param newConfig 新的配置项
   */
  updateHMRConfig(newConfig: Partial<HMRConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    // 更新相关设置
    if (newConfig.extensions) {
      this.#watchableExtensions = newConfig.extensions;
    }

    if (newConfig.max_listeners) {
      this.setMaxListeners(newConfig.max_listeners);
    }

    this.#logger.info('Configuration updated', { oldConfig, newConfig: this.config });
    this.emit('config-changed', oldConfig, this.config);
  }

  /**
   * 获取性能统计信息
   */
  getPerformanceStats(): {
    totalReloads: number;
    averageReloadTime: number;
    lastReloadTime: number;
    errors: number;
    fileChanges: number;
  } {
    const runtime = Date.now() - this.#performanceStats.startTime;
    return {
      totalReloads: this.#performanceStats.reloads,
      averageReloadTime: this.#performanceStats.reloads > 0 ?
        this.#performanceStats.totalReloadTime / this.#performanceStats.reloads : 0,
      lastReloadTime: this.#performanceStats.lastReloadTime,
      errors: this.#performanceStats.errors,
      fileChanges: this.#performanceStats.fileChanges
    };
  }

  /**
   * 重置性能统计
   */
  resetPerformanceStats(): void {
    this.#performanceStats = {
      startTime: Date.now(),
      reloads: 0,
      errors: 0,
      lastReloadTime: 0,
      totalReloadTime: 0,
      fileChanges: 0
    };
    this.#logger.info('Performance stats reset');
  }

  /**
   * 启用或禁用调试模式
   * @param enabled 是否启用调试
   */
  setDebugMode(enabled: boolean): void {
    this.config.debug = enabled;
    this.#logger.info(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 获取日志记录器
   */
  getLogger(): Logger {
    return this.#logger;
  }

  /**
   * 设置日志记录器
   */
  setLogger(logger: Logger): void {
    this.#logger = logger;
  }

  /**
   * 添加监听目录
   * @param dir 要添加的目录路径
   * @returns 是否成功添加
   */
  addWatchDir(dir: string): boolean {
    const absDir = resolvePath(dir);

    // 检查目录是否已存在
    if (this.#dirs.includes(absDir)) {
      this.#logger.warn('Directory already watched', { dir: absDir });
      return false;
    }

    // 检查目录是否存在
    if (!fs.existsSync(absDir)) {
      this.#logger.error('Directory does not exist', { dir: absDir });
      return false;
    }

    // 添加目录
    this.#dirs.push(absDir);

    // 设置目录监听器
    this.#setupDirWatcher(absDir);

    this.#logger.info('Directory added to watch list', { dir: absDir });
    this.emit('dir-added', absDir);

    return true;
  }

  /**
   * 移除监听目录
   * @param dir 要移除的目录路径
   * @returns 是否成功移除
   */
  removeWatchDir(dir: string): boolean {
    const absDir = resolvePath(dir);
    const index = this.#dirs.indexOf(absDir);

    if (index === -1) {
      this.#logger.warn('Directory not in watch list', { dir: absDir });
      return false;
    }

    // 关闭监听器
    const watcher = this.#dirWatchers.get(absDir);
    if (watcher) {
      watcher.close();
      this.#dirWatchers.delete(absDir);
    }

    // 移除目录
    this.#dirs.splice(index, 1);

    this.#logger.info('Directory removed from watch list', { dir: absDir });
    this.emit('dir-removed', absDir);

    return true;
  }

  /**
   * 更新监听目录列表
   * @param dirs 新的目录列表
   */
  updateWatchDirs(dirs: string[]): void {
    const oldDirs = new Set(this.#dirs);
    const newDirs = new Set(dirs.map(dir => resolvePath(dir)));

    // 移除不再需要的目录
    for (const dir of oldDirs) {
      if (!newDirs.has(dir)) {
        this.removeWatchDir(dir);
      }
    }

    // 添加新的目录
    for (const dir of newDirs) {
      if (!oldDirs.has(dir)) {
        this.addWatchDir(dir);
      }
    }

    this.#logger.info('Watch directories updated', {
      oldDirs: Array.from(oldDirs),
      newDirs: Array.from(newDirs)
    });
    this.emit('dirs-updated', Array.from(newDirs));
  }

  /**
   * 获取当前监听的目录列表
   * @returns 目录列表的只读副本
   */
  getWatchDirs(): ReadonlyArray<string> {
    return [...this.#dirs];
  }
}