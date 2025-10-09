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
    };
}

/**
 * 性能监控器
 * 负责统计和管理性能数据
 */
export class PerformanceMonitor {
    readonly #stats: PerformanceStats;

    constructor() {
        this.#stats = {
            totalLoadTime: 0,
            totalReloadTime: 0,
            lastReloadTime: 0,
            reloadCount: 0,
            errors: 0,
            startTime: Date.now(),
            memoryUsage: {
                rss: process.memoryUsage().rss,
                heapTotal: process.memoryUsage().heapTotal,
                heapUsed: process.memoryUsage().heapUsed
            }
        };
    }

    /** 获取性能统计 */
    get stats(): Readonly<PerformanceStats> {
        return { ...this.#stats };
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
            `  Last Reload: ${this.#stats.lastReloadTime}ms`
        ].join('\n');
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