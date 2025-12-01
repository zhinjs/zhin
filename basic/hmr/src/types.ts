// ============================================================================
// 基础类型定义
// ============================================================================

import type { Dependency } from './dependency.js';

/** 日志记录器接口 */
export interface Logger {
    debug(...args: any[]): void;
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
}

/** Context 接口 */
export interface Context<R = any,T extends Dependency=Dependency> {
    name: string;
    description:string
    value?: R;
    mounted?: (parent: T) => R | Promise<R>;
    dispose?: (value: R) => void;
}

/** 插件版本信息接口 */
export interface PluginVersion {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}

/** 依赖配置接口 */
export interface DependencyOptions {}

/** 监听器配置接口 */
export interface HMROptions extends DependencyOptions {
    /** 要监听的目录列表（用于生成 glob 模式） */
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
    /** 自定义 glob 模式（可选，如果不提供则自动生成） */
    patterns?: string[];
}

/** 依赖解析结果 */
export interface DependencyResolution {
    resolved: Map<string, PluginVersion>;
    conflicts: Array<{
        name: string;
        required: string;
        found: string;
    }>;
}

/** 插件事件类型映射 */
export interface PluginEventMap {
    'add': [Dependency];
    'remove': [Dependency];
    'change': [Dependency];
    'error': [Dependency, Error];
    'dispose': [];
    'config-changed': [string, unknown];
    [key: string]: unknown[];
}

/**
 * HMR 配置选项
 */
export interface HmrOptions {
    /** 日志记录器 */
    logger?: Logger;

    /** 监听的目录 */
    watchDirs?: string[];

    /** 监听的文件扩展名 */
    watchExtensions?: string[];

    /** 哈希算法 */
    hashAlgorithm?: string;

    /** 防抖延迟 (ms) */
    debounceDelay?: number;

    /** 最大监听器数量 */
    maxListeners?: number;

    /** 是否启用调试模式 */
    debug?: boolean;
}

/**
 * HMR 入口接口
 * 宿主对象必须实现此接口
 */
export interface HMREntry<T extends Dependency = Dependency> {
    dependencies: Map<string, T>;
    createDependency(name: string, filePath: string): T;
    findChild(filename: string): T | void;
    findParent(filename: string, callerFiles: string[]): Dependency;
}
