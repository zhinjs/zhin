import * as path from 'path';
import * as fs from 'fs';
import { Dependency } from './dependency.js';
import {HMROptions, Logger, HMREntry} from './types.js';
import {
    DEFAULT_WATCHABLE_EXTENSIONS, 
    STACK_TRACE_REGEX, 
    DEFAULT_CONFIG,
    mergeConfig,
    createError,
    getCallerFile,
    performGC
} from './utils.js';
import { FileWatcher } from './file-watcher.js';
import { ModuleLoader } from './module-loader.js';
import { PerformanceMonitor } from './performance.js';
import { ReloadManager } from './reload-manager.js';
import { resolvePath } from './utils.js';
import { fileURLToPath } from 'url';
// import {getLogger} from "@zhin.js/logger"; // Removed dependency
import { EventEmitter } from 'events';

// ============================================================================
// 默认HMR配置
// ============================================================================

class ConsoleLogger implements Logger {
    debug(...args: any[]) { if (process.env.DEBUG) console.debug('[HMR DEBUG]', ...args); }
    info(...args: any[]) { console.info('[HMR INFO]', ...args); }
    warn(...args: any[]) { console.warn('[HMR WARN]', ...args); }
    error(...args: any[]) { console.error('[HMR ERROR]', ...args); }
}

const DEFAULT_HMR_OPTIONS: Required<Omit<HMROptions,'logger'>> & {
    logger: Logger;
} = {
    dirs: [],
    max_listeners: DEFAULT_CONFIG.MAX_LISTENERS,
    debounce: DEFAULT_CONFIG.RELOAD_DEBOUNCE_MS,
    algorithm: DEFAULT_CONFIG.HASH_ALGORITHM,
    debug: DEFAULT_CONFIG.ENABLE_DEBUG,
    patterns: [],  // 默认为空，将自动生成
    logger: new ConsoleLogger()
};

// ============================================================================
// HMRManager 类
// ============================================================================

/**
 * HMR 管理器：提供热模块替换功能
 * 不再继承 Dependency，而是组合使用
 */
export class HMRManager<P extends Dependency = Dependency> extends EventEmitter {
    #dirs:string[]=[];
    /** 缓存的扩展名 */
    private static _cachedExtensions?: Set<string>;
    /** 正在加载的依赖集合 */
    private static _loadingDependencies?: Set<string>;

    /** 获取缓存的扩展名 */
    static get cachedExtensions(): Set<string> {
        return this._cachedExtensions|| DEFAULT_WATCHABLE_EXTENSIONS;
    }

    /** 设置缓存的扩展名 */
    static set cachedExtensions(value: Set<string> | null) {
        this._cachedExtensions = value || undefined;
    }

    /** 获取正在加载的依赖集合 */
    static get loadingDependencies(): Set<string> {
        if (!this._loadingDependencies) {
            this._loadingDependencies = new Set();
        }
        return this._loadingDependencies;
    }

    /** 获取当前文件路径 */
    static getCurrentFile(beside: string = fileURLToPath(import.meta.url)): string {
        const originPrepareStackTrace = Error.prepareStackTrace;
        const currentFile=fileURLToPath(import.meta.url)
        Error.prepareStackTrace = (_, stack: NodeJS.CallSite[]) => {
            const filePath = stack.map(item => item.getFileName() || '')
                .filter(Boolean)
                .filter(item => item !== beside && item !== currentFile&& !item.startsWith('node:'))
            return Array.from(new Set(filePath))
        };
        const stack = new Error().stack;
        Error.prepareStackTrace = originPrepareStackTrace;
        if (!stack) {
            throw new Error('Caller file not found');
        }
        return (stack as any)[0];
    }

    /** 获取当前调用栈 */
    static getCurrentStack(beside: string = fileURLToPath(import.meta.url)): string[] {
        const stack = new Error().stack;
        if (!stack) return [];

        const files: string[] = [];
        const lines = stack.split('\n');
        for (const line of lines) {
            const match = line.match(STACK_TRACE_REGEX);
            if (match && match[1] && match[1] !== beside) {
                const filePath = match[1];
                // 处理 file:// URL
                if (filePath.startsWith('file://')) {
                    files.push(new URL(filePath).pathname);
                } else {
                    files.push(filePath);
                }
            }
        }
        return files;
    }

    // ============================================================================
    // 功能模块组合
    // ============================================================================

    /** 文件监听器 */
    public readonly fileWatcher: FileWatcher;
    
    /** 模块加载器 */
    public readonly moduleLoader: ModuleLoader<P>;
    
    /** 性能监控器 */
    public readonly performanceMonitor: PerformanceMonitor;
    
    /** 重载管理器 */
    public readonly reloadManager: ReloadManager;
    public readonly pendingDependencies: Set<string> = new Set();

    /** 私有日志记录器 */
    logger: Logger;
    options: HMROptions;

    constructor(
        private entry: P & HMREntry<P>,
        options: HMROptions = {}
    ) {
        super();
        const finalOptions = mergeConfig(DEFAULT_HMR_OPTIONS, options);
        this.options = finalOptions;
        this.logger = finalOptions.logger;

        // 初始化功能模块
        this.fileWatcher = new FileWatcher(this.logger);
        this.#dirs=finalOptions.dirs?.map(dir=>path.resolve(dir))||[]

        this.moduleLoader = new ModuleLoader<P>(
            this,
            this.logger,
            finalOptions.algorithm || 'md5'
        );

        // 初始化性能监控器（遵循"监控不干预"原则）
        this.performanceMonitor = new PerformanceMonitor({
            checkInterval: 60000,  // 每分钟检查一次
            highMemoryThreshold: 90,  // 90% 阈值
            monitorGC: finalOptions.debug || process.env.NODE_ENV === 'development',  // 开发环境或 debug 模式启用 GC 监控
            gcOnlyInDev: true  // 只在开发环境监控 GC
        });
        
        // 启动性能监控
        this.performanceMonitor.startMonitoring((stats) => {
            const heapPercent = (stats.memoryUsage.heapUsed / stats.memoryUsage.heapTotal) * 100;
            const rssMB = (stats.memoryUsage.rss / 1024 / 1024).toFixed(2);
            
            this.logger.warn(`⚠️  High memory usage detected: ${heapPercent.toFixed(2)}%`);
            this.logger.warn(`   RSS: ${rssMB} MB`);
            this.logger.warn(`   Heap: ${(stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(stats.memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
            
            // ✅ 只记录日志，不手动 GC
            // ❌ 不要: if (global.gc) global.gc();
            
            // 发出事件，让使用者可以响应
            this.emit('memory.high', stats);
        });

        this.reloadManager = new ReloadManager(
            this.logger,
            finalOptions.debounce || 100
        );

        // 设置最大监听器数量
        this.setMaxListeners(finalOptions.max_listeners);

        // 设置事件监听
        this.setupEventListeners();
        // 设置内部事件监听
        this.on('internal.add', (filePath: string) => {
            this.#add(filePath);
        });
    }

    get dependencies() {
        return this.entry.dependencies;
    }

    // 代理 createDependency 到 entry
    createDependency(name: string, filePath: string): P {
        return this.entry.createDependency(name, filePath);
    }

    get dirs(){
        return this.#dirs
    }
    set dirs(value:string[]){
        this.#dirs=value
    }
    /** 设置事件监听器 */
    private setupEventListeners(): void {
        // 文件变化监听
        this.fileWatcher.on('file-change', (filePath: string, eventType: string) => {
            if (eventType === 'change' && this.moduleLoader.hasFileChanged(filePath)) {
                this.reloadManager.scheduleReload(filePath);
            }
        });

        // 重载文件
        this.reloadManager.on('reload-file', async (filePath: string) => {
            await this.#reloadFile(filePath);
        });

        // 模块加载器事件转发
        this.moduleLoader.on('add', (dependency: P) => {
            this.emit('add', dependency);
        });

        this.moduleLoader.on('remove', (dependency: P) => {
            this.emit('remove', dependency);
        });

        this.moduleLoader.on('reload', (filePath: string) => {
            this.emit('reload', filePath);
        });

        this.moduleLoader.on('error', (error: any) => {
            this.performanceMonitor.recordError();
            this.emit('error', error);
        });
    }
    watching(filePath:string|string[],callback:()=>void){
        if(!Array.isArray(filePath)) filePath=[filePath]
        const disposes:(()=>void)[]=[]
        for(const fileUrl of filePath){
            disposes.push(this.fileWatcher.watching(fileUrl,callback))
            this.logger.info(`start watching "${path.relative(process.cwd(),fileUrl)}"`)
        }
        this.on('dispose',()=>{
            while (disposes.length){
                const dispose=disposes.shift()
                dispose?.()
            }
        })
    }

    /** 添加插件 */
    #add(filePath: string): void {
        const resolvedPath = this.resolve(filePath);
        const name = path.basename(filePath, path.extname(filePath));
        
        // Prevent concurrent loading of the same plugin
        if (this.pendingDependencies.has(resolvedPath)) {
            return;
        }

        // 如果已经存在，先移除
        if (this.dependencies.has(resolvedPath)) {
            this.#remove(resolvedPath);
        }
        this.pendingDependencies.add(resolvedPath);
        // 按需监听：为这个插件文件添加监听
        const unwatchFile = process.env.NODE_ENV === 'development' ? this.watchFile(resolvedPath) : ()=>{};
        
        // 异步导入模块
        this.moduleLoader.add(name,resolvedPath).catch((error) => {
            this.logger.error(`Failed to load plugin: ${name}`, { 
                filePath: resolvedPath, 
                error 
            });
            this.performanceMonitor.recordError();
            this.emit('error', error);
            // 如果加载失败，移除监听
            if(process.env.NODE_ENV === 'development') unwatchFile();
        }).finally(()=>{
            this.pendingDependencies.delete(resolvedPath);
        })
    }

    /** 移除插件 */
    #remove(filePath: string): void {
        // 移除监听
        this.unwatchFile(filePath);
        // 移除模块
        this.moduleLoader.remove(filePath);
    }

    /** 重载文件 */
    async #reloadFile(filePath: string): Promise<void> {
        const timer = this.performanceMonitor.createTimer();
        const relativePath = path.relative(process.cwd(), filePath);
        
        try {
            this.logger.info(`Reloading file: ${relativePath}`);
            
            await this.moduleLoader.reload(filePath);
            
            const duration = timer.stop();
            this.performanceMonitor.recordReloadTime(duration);
            this.logger.info(`${relativePath} reloaded successfully in ${duration}ms`);
        } catch (error) {
            this.performanceMonitor.recordError();
            this.logger.error(`Failed to reload file: ${relativePath}`, { error });
            this.emit('error', error);
            
            // 不抛出异常，允许后续重载尝试
            // 错误已经被记录，用户可以看到具体的错误信息
        }
    }

    /** 等待所有依赖就绪 */
    async waitForReady(): Promise<void> {
        await new Promise(resolve=>{
            const interval = setInterval(()=>{
                if(this.pendingDependencies.size === 0){
                    clearInterval(interval);
                    resolve(void 0);
                }
            },100)
        })
        const promises = this.dependencies.values();
        await Promise.all(Array.from(promises).map(dep => dep.waitForReady()));

    }

    /** 获取依赖列表 */
    get dependencyList(): P[] {
        return Array.from(this.dependencies.values());
    }

    /** 广播事件 */
    broadcast(event: string, ...args: any[]): void {
        this.emit(event, ...args);
        for (const dep of this.dependencies.values()) {
            dep.emit(event, ...args);
        }
    }

    /** 查找插件 */
    findPluginByName<T extends P>(name: string): T | void {
        const result = this.moduleLoader.findDependency(name);
        return result as T | void;
    }

    /** 添加监听目录 */
    addDir(dir: string): void {
        this.#dirs=[
            ...this.#dirs,
            dir
        ]
    }

    /** 移除监听目录 */
    removeDir(dir: string): boolean {
        const resolvedDir = path.resolve(dir);
        if (!this.#dirs.includes(resolvedDir)) {
            return false;
        }
        this.#dirs = this.#dirs.filter(d => d !== resolvedDir);
        return true;
    }
    
    /**
     * 监听单个文件（按需监听）
     * @param filePath 文件路径
     * @returns 清理函数
     */
    watchFile(filePath: string): () => void {
        return this.fileWatcher.watchFile(filePath);
    }
    
    /**
     * 停止监听单个文件
     * @param filePath 文件路径
     */
    unwatchFile(filePath: string): void {
        this.fileWatcher.unwatchFile(filePath);
    }


    /** 更新HMR配置 */
    updateOptions(options: Partial<HMROptions>): void {
        this.options = { ...this.options, ...options };
        this.#dirs= this.options.dirs?.map(dir=>path.resolve(dir))||[]
        if (this.options.max_listeners) {
            this.setMaxListeners(this.options.max_listeners);
        }
    }

    /** 获取性能统计信息 */
    getPerformanceStats() {
        return this.performanceMonitor.stats;
    }

    /** 解析文件路径 */
    resolve(filePath: string): string {
        const dirs=this.#dirs
        for (const dir of this.#dirs) {
            const resolvedPath = resolvePath(filePath, dir);
            if(fs.existsSync(resolvedPath)){
                const stat=fs.statSync(resolvedPath)
                if(stat.isFile()) return resolvedPath
                return this.resolve(FileWatcher.getDirDep(resolvedPath))
            }
            // 尝试常见的文件扩展名
            const extensions =HMRManager.cachedExtensions;
            for (const ext of extensions) {
                const fullPath = resolvedPath + ext;
                if (fs.existsSync(fullPath)) {
                    return fullPath;
                }
            }
        }
        throw new Error(`File not found: ${filePath}\n${this.#dirs.join('\n')}`);
    }
    /** 获取性能报告 */
    getPerformanceReport(): string {
        return this.performanceMonitor.getReport();
    }

    /** 获取重载管理器状态 */
    getReloadStatus() {
        return this.reloadManager.getStatus();
    }

    /** 导入插件 */
    async import(name: string, filePath: string): Promise<P> {
        return await this.moduleLoader.import(name, filePath);
    }

    /** 检查文件是否有变化 */
    hasFileChanged(filePath: string): boolean {
        return this.moduleLoader.hasFileChanged(filePath);
    }
    /** 销毁 HMR */
    dispose(): void {
        this.emit('dispose');
        
        // 停止所有功能模块
        this.fileWatcher.dispose();
        this.moduleLoader.dispose();
        this.reloadManager.dispose();
        
        // 停止性能监控
        this.performanceMonitor.stopMonitoring();

        this.removeAllListeners();
        
        // ✅ V8 会自动处理 GC，不需要手动调用
        // ❌ 不要: performGC({ onDispose: true }, `HMR dispose: ${this.filename}`);
    }


    /** 设置调试模式 */
    setDebugMode(enabled: boolean): void {
        this.options.debug = enabled;
        this.logger.info(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    }

    /** 获取测试接口 */
    public getTestInterface() {
        return {
            fileWatcher: this.fileWatcher,
            moduleLoader: this.moduleLoader,
            performanceMonitor: this.performanceMonitor,
            reloadManager: this.reloadManager
        };
    }
    // 为了兼容性，保留查找功能
    findChild(filename: string) {
        return this.entry.findChild(filename);
    }
    
    findParent(filename: string, callerFiles: string[]) {
        return this.entry.findParent(filename, callerFiles);
    }
} 
HMRManager.cachedExtensions = DEFAULT_WATCHABLE_EXTENSIONS;