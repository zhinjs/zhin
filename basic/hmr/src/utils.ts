import * as path from 'path';
import { Logger } from './types.js';
import { fileURLToPath } from 'url';

// ============================================================================
// 工具函数
// ============================================================================

/** 合并配置对象 */
export function mergeConfig<T extends object, U extends Partial<T>>(defaults: T, config: U): T & U {
    return { ...defaults, ...config } as T & U;
}

/** 创建错误对象 */
export function createError(message: string, details?: Record<string, unknown>): Error {
    const error = new Error(message);
    if (details) {
        Object.assign(error, details);
    }
    return error;
}

/** 解析文件路径 */
export function resolvePath(filename: string, dir: string = process.cwd()): string {
    return path.isAbsolute(filename) ? filename : path.resolve(dir, filename);
}
export function getCallerFile(beside: string = import.meta.url): string {

    return getCallerFiles(beside)?.[0]
}
export function getCallerFiles(beside: string = import.meta.url): string[] {
    const prepareStackTrace = Error.prepareStackTrace;
    if(beside.startsWith('file:')) beside=fileURLToPath(beside)
    const filename = fileURLToPath(import.meta.url)
    Error.prepareStackTrace = (_, stack) => [...stack.map(item => {
        const result = item.getFileName()
        if (result?.startsWith('file:')) return fileURLToPath(result)
        return result;
    })];
    const error = new Error();
    const stack = error.stack as unknown as string[];
    Error.prepareStackTrace = prepareStackTrace;
    return stack.filter(Boolean).filter(item => item !== beside && item !== filename && !item.startsWith('node:'))
}
// ============================================================================
// 日志记录器实现
// ============================================================================

/** 默认的 Console 日志记录器 */
export class ConsoleLogger implements Logger {
    constructor(
        private readonly name: string,
        private readonly enableDebug: boolean=process.env.NODE_ENV==='development'
    ) { }

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
export const DEFAULT_WATCHABLE_EXTENSIONS = new Set(['.js','.jsx','.tsx','.cjs', '.ts', '.mjs', '.mts', '.json']);

/** 堆栈跟踪解析正则表达式 */
export const STACK_TRACE_REGEX = /at\s+.*\s+\((.+):\d+:\d+\)/;

/** 错误消息常量 */
export const ERROR_MESSAGES = {
    CONTEXT_NOT_FOUND: 'Effect Context not found',
    CONTEXT_NOT_MOUNTED:'Effect Context not mounted',
    CALLER_FILE_NOT_FOUND: 'Cannot determine caller file',
    CIRCULAR_DEPENDENCY: 'Circular dependency detected',
    MODULE_NOT_FOUND: 'Module not found in dirs',
    PLUGIN_NOT_FOUND: 'Plugin not found',
    INVALID_CONFIG: 'Invalid configuration',
    DEPENDENCY_NOT_FOUND: 'Dependency not found',
    DEPENDENCY_DISPOSED: 'Dependency has been disposed',
} as const;

/** 默认配置常量 */
export const DEFAULT_CONFIG = {
    MAX_LISTENERS: 100,
    RELOAD_DEBOUNCE_MS: 50,
    HASH_ALGORITHM: 'md5' as const,
    ENABLE_DEBUG: false,
} as const;
// @ts-ignore
export const isBun=typeof Bun!=='undefined'
// @ts-ignore
export const isCommonJS=!import.meta?.url?.startsWith('file:')
/**
 * 垃圾回收配置
 */
export interface GCConfig {
    /** 是否启用手动垃圾回收 */
    enabled: boolean;
    /** 垃圾回收后的延迟（毫秒） */
    delay: number;
    /** 是否在重载时进行垃圾回收 */
    onReload: boolean;
    /** 是否在销毁时进行垃圾回收 */
    onDispose: boolean;
}

/**
 * 默认垃圾回收配置
 * 注意：生产环境不建议启用手动 GC，V8 的自动 GC 已经足够智能
 */
export const DEFAULT_GC_CONFIG: GCConfig = {
    enabled: process.env.NODE_ENV === 'development',  // 只在开发环境启用
    delay: 0,
    onReload: false,  // 不在重载时 GC
    onDispose: false  // 不在销毁时 GC
};

/**
 * 执行手动垃圾回收
 * @param config 垃圾回收配置
 * @param context 上下文信息（用于日志）
 * 
 * ⚠️ 注意：不建议在生产环境频繁调用此函数
 * V8 的自动 GC 已经足够智能，手动 GC 可能会:
 * 1. 打断正常执行流程
 * 2. 造成不必要的性能损失
 * 3. 干扰 V8 的优化算法
 * 
 * 只在以下情况考虑使用：
 * - 调试/分析内存问题
 * - 大批量数据处理后 (>1000 次操作)
 */
export function performGC(config: Partial<GCConfig> = {}, context?: string): void {
    const finalConfig = { ...DEFAULT_GC_CONFIG, ...config };
    
    // 生产环境直接返回
    if (process.env.NODE_ENV === 'production') {
        return;
    }
    
    if (!finalConfig.enabled || !global.gc) {
        return;
    }
    
    try {
        global.gc();
        
        if (finalConfig.delay > 0) {
            // 使用setImmediate来避免阻塞
            setImmediate(() => {
                // 延迟后的额外清理
            });
        }
    } catch  {}
}

/**
 * 检查垃圾回收是否可用
 * @returns 是否支持手动垃圾回收
 */
export function isGCAvailable(): boolean {
    return typeof global.gc === 'function';
}

/**
 * 获取内存使用情况
 * @returns 内存使用统计
 */
export function getMemoryUsage(): {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
} {
    return process.memoryUsage();
}
