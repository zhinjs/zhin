/**
 * 性能统计数据接口
 */
export interface PerformanceStats {
    /** 总加载时间 */
    totalLoadTime: number;
    /** 总重载时间 */
    totalReloadTime: number;
    /** 上次重载时间 */
    lastReloadTime: number;
    /** 重载次数 */
    reloadCount: number;
    /** 错误次数 */
    errors: number;
    /** 启动时间 */
    startTime: number;
    /** 内存使用情况 */
    memoryUsage: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        arrayBuffers: number;
    };
    /** 内存峰值 */
    memoryPeak: {
        rss: number;
        heapUsed: number;
        timestamp: number;
    };
    /** GC 统计（如果可用） */
    gcStats?: {
        count: number;
        totalDuration: number;
        lastDuration: number;
    };
}

/**
 * 内存监控配置
 */
export interface MemoryMonitorConfig {
    /** 检查间隔（毫秒），默认 60000 (1分钟) */
    checkInterval?: number;
    /** 高内存阈值（百分比），默认 90 */
    highMemoryThreshold?: number;
    /** 是否监控 GC 事件 */
    monitorGC?: boolean;
    /** 是否只在开发环境启用 GC 监控 */
    gcOnlyInDev?: boolean;
}

/**
 * 性能监控器
 * 负责统计和管理性能数据
 * 
 * 核心原则：
 * - 监控不干预：只记录，不手动 GC
 * - 定期检查：不频繁，避免影响性能
 * - 提供洞察：帮助发现问题，而非解决问题
 */
export class PerformanceMonitor {
    readonly #stats: PerformanceStats;
    private monitorInterval?: NodeJS.Timeout;
    private gcObserver?: any;
    private config: Required<MemoryMonitorConfig>;
    private onHighMemory?: (stats: PerformanceStats) => void;

    constructor(config: MemoryMonitorConfig = {}) {
        const mem = process.memoryUsage();
        
        this.config = {
            checkInterval: config.checkInterval ?? 60000,
            highMemoryThreshold: config.highMemoryThreshold ?? 90,
            monitorGC: config.monitorGC ?? false,
            gcOnlyInDev: config.gcOnlyInDev ?? true
        };
        
        this.#stats = {
            totalLoadTime: 0,
            totalReloadTime: 0,
            lastReloadTime: 0,
            reloadCount: 0,
            errors: 0,
            startTime: Date.now(),
            memoryUsage: {
                rss: mem.rss,
                heapTotal: mem.heapTotal,
                heapUsed: mem.heapUsed,
                external: mem.external,
                arrayBuffers: mem.arrayBuffers
            },
            memoryPeak: {
                rss: mem.rss,
                heapUsed: mem.heapUsed,
                timestamp: Date.now()
            }
        };
        
        // 启动 GC 监控（如果配置了）
        if (this.config.monitorGC) {
            this.setupGCMonitoring();
        }
    }

    /** 获取性能统计 */
    get stats(): Readonly<PerformanceStats> {
        // 更新当前内存使用
        this.updateMemoryUsage();
        return { ...this.#stats };
    }
    
    /**
     * 启动定期内存监控
     * 遵循"监控不干预"原则：只观察，不手动 GC
     */
    startMonitoring(onHighMemory?: (stats: PerformanceStats) => void): void {
        if (this.monitorInterval) {
            return; // 已经在监控中
        }
        
        this.onHighMemory = onHighMemory;
        
        this.monitorInterval = setInterval(() => {
            this.checkMemory();
        }, this.config.checkInterval);
    }
    
    /**
     * 停止监控
     */
    stopMonitoring(): void {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = undefined;
        }
        
        if (this.gcObserver) {
            this.gcObserver.disconnect();
            this.gcObserver = undefined;
        }
    }
    
    /**
     * 更新内存使用情况
     */
    private updateMemoryUsage(): void {
        const mem = process.memoryUsage();
        
        this.#stats.memoryUsage = {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers
        };
        
        // 更新峰值
        if (mem.rss > this.#stats.memoryPeak.rss) {
            this.#stats.memoryPeak.rss = mem.rss;
            this.#stats.memoryPeak.timestamp = Date.now();
        }
        if (mem.heapUsed > this.#stats.memoryPeak.heapUsed) {
            this.#stats.memoryPeak.heapUsed = mem.heapUsed;
        }
    }
    
    /**
     * 检查内存使用情况
     * 核心原则：只监控和记录，不手动 GC
     */
    private checkMemory(): void {
        this.updateMemoryUsage();
        
        const mem = this.#stats.memoryUsage;
        const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;
        
        // 如果内存使用超过阈值，触发回调（但不手动 GC）
        if (heapPercent > this.config.highMemoryThreshold) {
            if (this.onHighMemory) {
                this.onHighMemory(this.#stats);
            }
        }
    }
    
    /**
     * 设置 GC 监控
     * 只在配置允许的情况下启用
     */
    private setupGCMonitoring(): void {
        // 如果配置了只在开发环境启用，检查环境
        if (this.config.gcOnlyInDev && process.env.NODE_ENV === 'production') {
            return;
        }
        
        try {
            const { PerformanceObserver } = require('perf_hooks');
            
            this.#stats.gcStats = {
                count: 0,
                totalDuration: 0,
                lastDuration: 0
            };
            
            this.gcObserver = new PerformanceObserver((list: any) => {
                const entries = list.getEntries();
                for (const entry of entries) {
                    if (this.#stats.gcStats) {
                        this.#stats.gcStats.count++;
                        this.#stats.gcStats.lastDuration = entry.duration;
                        this.#stats.gcStats.totalDuration += entry.duration;
                    }
                }
            });
            
            this.gcObserver.observe({ entryTypes: ['gc'] });
        } catch (error) {
            // GC 监控不可用（可能是 Node.js 版本问题）
        }
    }

    /** 创建计时器 */
    createTimer(): Timer {
        return new Timer();
    }

    /** 记录加载时间 */
    recordLoadTime(duration: number): void {
        this.#stats.totalLoadTime += duration;
    }

    /** 记录重载时间 */
    recordReloadTime(duration: number): void {
        this.#stats.lastReloadTime = duration;
        this.#stats.totalReloadTime += duration;
        this.#stats.reloadCount++;
    }

    /** 记录错误 */
    recordError(): void {
        this.#stats.errors++;
    }

    /** 获取平均重载时间 */
    getAverageReloadTime(): number {
        return this.#stats.reloadCount > 0 
            ? this.#stats.totalReloadTime / this.#stats.reloadCount 
            : 0;
    }

    /** 获取运行时间 */
    getUptime(): number {
        return Date.now() - this.#stats.startTime;
    }

    /** 重置统计 */
    reset(): void {
        this.#stats.totalLoadTime = 0;
        this.#stats.totalReloadTime = 0;
        this.#stats.lastReloadTime = 0;
        this.#stats.reloadCount = 0;
        this.#stats.errors = 0;
        this.#stats.startTime = Date.now();
    }

    /** 获取内存报告 */
    getMemoryReport(): string {
        this.updateMemoryUsage();
        
        const mem = this.#stats.memoryUsage;
        const peak = this.#stats.memoryPeak;
        const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;
        
        const lines = [
            `Memory Report:`,
            `  RSS: ${this.formatBytes(mem.rss)} (Peak: ${this.formatBytes(peak.rss)})`,
            `  Heap: ${this.formatBytes(mem.heapUsed)} / ${this.formatBytes(mem.heapTotal)} (${heapPercent.toFixed(2)}%)`,
            `  External: ${this.formatBytes(mem.external)}`,
            `  ArrayBuffers: ${this.formatBytes(mem.arrayBuffers)}`
        ];
        
        if (this.#stats.gcStats) {
            const avgGC = this.#stats.gcStats.count > 0 
                ? this.#stats.gcStats.totalDuration / this.#stats.gcStats.count 
                : 0;
            
            lines.push(
                `  GC Count: ${this.#stats.gcStats.count}`,
                `  GC Total Time: ${this.#stats.gcStats.totalDuration.toFixed(2)}ms`,
                `  GC Avg Time: ${avgGC.toFixed(2)}ms`,
                `  GC Last: ${this.#stats.gcStats.lastDuration.toFixed(2)}ms`
            );
        }
        
        return lines.join('\n');
    }
    
    /** 获取性能报告 */
    getReport(): string {
        const uptime = this.getUptime();
        const avgReload = this.getAverageReloadTime();
        
        return [
            `Performance Report:`,
            `  Uptime: ${this.formatDuration(uptime)}`,
            `  Total Load Time: ${this.#stats.totalLoadTime}ms`,
            `  Total Reload Time: ${this.#stats.totalReloadTime}ms`,
            `  Reload Count: ${this.#stats.reloadCount}`,
            `  Average Reload Time: ${avgReload.toFixed(2)}ms`,
            `  Errors: ${this.#stats.errors}`,
            `  Last Reload: ${this.#stats.lastReloadTime}ms`,
            ``,
            this.getMemoryReport()
        ].join('\n');
    }
    
    /** 获取完整报告（包含内存和GC信息） */
    getFullReport(): string {
        return this.getReport();
    }
    
    /** 格式化字节数 */
    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }

    /** 格式化持续时间 */
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
}

/**
 * 计时器类
 */
export class Timer {
    private startTime: number;
    private endTime?: number;

    constructor() {
        this.startTime = performance.now();
    }

    /** 停止计时并返回持续时间 */
    stop(): number {
        this.endTime = performance.now();
        return this.getDuration();
    }

    /** 获取持续时间 */
    getDuration(): number {
        const end = this.endTime ?? performance.now();
        return Math.round(end - this.startTime);
    }

    /** 重置计时器 */
    reset(): void {
        this.startTime = performance.now();
        this.endTime = undefined;
    }
}

/**
 * 使用示例：
 * 
 * ```typescript
 * import { PerformanceMonitor } from '@zhin.js/hmr';
 * 
 * // 创建监控器
 * const monitor = new PerformanceMonitor({
 *   checkInterval: 60000,  // 每分钟检查一次
 *   highMemoryThreshold: 90,  // 90% 阈值
 *   monitorGC: true,  // 监控 GC 事件
 *   gcOnlyInDev: true  // 只在开发环境监控 GC
 * });
 * 
 * // 启动监控（不会手动 GC，只记录）
 * monitor.startMonitoring((stats) => {
 *   // 高内存时的回调（不要在这里调用 gc()！）
 *   console.warn('High memory detected:');
 *   console.warn(`  Heap: ${stats.memoryUsage.heapUsed} / ${stats.memoryUsage.heapTotal}`);
 *   console.warn(`  RSS: ${stats.memoryUsage.rss}`);
 *   
 *   // ✅ 只记录日志，让 V8 决定何时 GC
 *   // ❌ 不要: if (global.gc) global.gc();
 * });
 * 
 * // 获取报告
 * console.log(monitor.getFullReport());
 * 
 * // 记录重载时间
 * const timer = monitor.createTimer();
 * await reloadPlugin();
 * monitor.recordReloadTime(timer.stop());
 * 
 * // 停止监控（清理资源）
 * monitor.stopMonitoring();
 * ```
 */ 