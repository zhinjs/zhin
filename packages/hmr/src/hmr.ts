import * as path from 'path';
import * as fs from 'fs';
import { Dependency } from './dependency.js';
import {HMROptions, Logger} from './types.js';
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
import {getLogger} from "@zhin.js/logger";

// ============================================================================
// 默认HMR配置
// ============================================================================

const DEFAULT_HMR_OPTIONS: Required<Omit<HMROptions,'logger'>> & {
    logger: Logger;
} = {
    dirs: [],
    max_listeners: DEFAULT_CONFIG.MAX_LISTENERS,
    debounce: DEFAULT_CONFIG.RELOAD_DEBOUNCE_MS,
    algorithm: DEFAULT_CONFIG.HASH_ALGORITHM,
    debug: DEFAULT_CONFIG.ENABLE_DEBUG,
    patterns: [],  // 默认为空，将自动生成
    logger: getLogger('HMR')
};

// ============================================================================
// HMR 类
// ============================================================================

/**
 * HMR 基类：提供热模块替换功能
 * 继承自Dependency，内部组合各个功能模块
 */
export abstract class HMR<P extends Dependency = Dependency> extends Dependency<P, HMROptions> {
    /** HMR 栈，用于跟踪当前活动的 HMR 实例 */
    private static _hmrStack?: HMR<any>[];
    /** 依赖栈，用于跟踪当前活动的依赖 */
    private static _dependencyStack?: Dependency[];
    #dirs:string[]=[];
    /** 缓存的扩展名 */
    private static _cachedExtensions?: Set<string>;
    /** 正在加载的依赖集合 */
    private static _loadingDependencies?: Set<string>;
    /** 获取 HMR 栈 */
    static get hmrStack(): HMR<any>[] {
        if (!this._hmrStack) {
            this._hmrStack = [];
        }
        return this._hmrStack;
    }

    /** 获取依赖栈 */
    static get dependencyStack(): Dependency[] {
        if (!this._dependencyStack) {
            this._dependencyStack = [];
        }
        return this._dependencyStack;
    }

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

    /** 获取当前活动的 HMR 实例 */
    static get currentHMR(): HMR {
        const hmrStack = this.hmrStack;
        if (hmrStack.length === 0) {
            throw createError('No active HMR Context');
        }
        return hmrStack[hmrStack.length - 1];
    }

    /** 获取当前活动的依赖 */
    static get currentDependency(): Dependency {
        const dependencyStack = this.dependencyStack;
        if (dependencyStack.length === 0) {
            throw createError('No active dependency Context');
        }
        return dependencyStack[dependencyStack.length - 1];
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
    protected readonly fileWatcher: FileWatcher;
    
    /** 模块加载器 */
    protected readonly moduleLoader: ModuleLoader<P>;
    
    /** 性能监控器 */
    protected readonly performanceMonitor: PerformanceMonitor;
    
    /** 重载管理器 */
    protected readonly reloadManager: ReloadManager;
    protected readonly pendingDependencies: Set<string> = new Set();

    /** 私有日志记录器 */
    logger: Logger;

    constructor(options: HMROptions = {}) {
        const finalOptions = mergeConfig(DEFAULT_HMR_OPTIONS, options);
        super(null, 'HMR', getCallerFile(), finalOptions);
        this.logger = finalOptions.logger;

        // 初始化功能模块
        this.fileWatcher = new FileWatcher(this.logger);
        this.#dirs=finalOptions.dirs?.map(dir=>path.resolve(dir))||[]

        this.moduleLoader = new ModuleLoader<P>(
            this,
            this.logger,
            finalOptions.algorithm || 'md5'
        );

        this.performanceMonitor = new PerformanceMonitor();

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
        
        // 添加到 HMR 栈
        HMR.hmrStack.push(this);
        HMR.dependencyStack.push(this);
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

    /** 抽象方法：创建依赖 */
    abstract createDependency(name: string, filePath: string): P;

    /** 添加插件 */
    #add(filePath: string): void {
        const resolvedPath = this.resolve(filePath);
        const name = path.basename(filePath, path.extname(filePath));
        // 如果已经存在，先移除
        if (this.dependencies.has(resolvedPath)) {
            this.#remove(resolvedPath);
        }
        this.pendingDependencies.add(resolvedPath);
        
        // 按需监听：为这个插件文件添加监听
        const unwatchFile = this.watchFile(resolvedPath);
        
        // 异步导入模块
        this.moduleLoader.add(name,resolvedPath).catch((error) => {
            this.logger.error(`Failed to load plugin: ${name}`, { 
                filePath: resolvedPath, 
                error 
            });
            this.performanceMonitor.recordError();
            this.emit('error', error);
            // 如果加载失败，移除监听
            unwatchFile();
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
            const extensions =HMR.cachedExtensions;
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
        // 停止所有功能模块
        this.fileWatcher.dispose();
        this.moduleLoader.dispose();
        this.reloadManager.dispose();

        // 从 HMR 栈中移除
        const hmrIndex = HMR.hmrStack.indexOf(this);
        if (hmrIndex !== -1) {
            HMR.hmrStack.splice(hmrIndex, 1);
        }

        const depIndex = HMR.dependencyStack.indexOf(this);
        if (depIndex !== -1) {
            HMR.dependencyStack.splice(depIndex, 1);
        }

        super.dispose();
        
        // 手动垃圾回收
        performGC({ onDispose: true }, `HMR dispose: ${this.filename}`);
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
} 
HMR.cachedExtensions = DEFAULT_WATCHABLE_EXTENSIONS;