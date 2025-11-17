import { EventEmitter } from 'events';
import { Logger } from './types.js';
import { performGC } from './utils.js';

/**
 * 重载管理器
 * 负责防抖和重载队列管理
 */
export class ReloadManager extends EventEmitter {
    readonly #logger: Logger;
    readonly #debounceDelay: number;
    readonly #pendingReloads: Map<string, NodeJS.Timeout>;
    readonly #reloadQueue: Set<string>;
    #isProcessing: boolean = false;

    constructor(logger: Logger, debounceDelay: number = 100) {
        super();
        this.#logger = logger;
        this.#debounceDelay = debounceDelay;
        this.#pendingReloads = new Map();
        this.#reloadQueue = new Set();
    }

    /** 添加文件到重载队列 */
    scheduleReload(filePath: string): void {
        // 取消之前的定时器
        const existingTimer = this.#pendingReloads.get(filePath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // 设置新的定时器
        const timer = setTimeout(() => {
            this.#pendingReloads.delete(filePath);
            this.#reloadQueue.add(filePath);
            this.processQueue();
        }, this.#debounceDelay);

        this.#pendingReloads.set(filePath, timer);
    }

    /** 处理重载队列 */
    private async processQueue(): Promise<void> {
        if (this.#isProcessing || this.#reloadQueue.size === 0) {
            return;
        }

        this.#isProcessing = true;

        try {
            const files = Array.from(this.#reloadQueue);
            this.#reloadQueue.clear();

            for (const filePath of files) {
                try {
                    this.emit('reload-file', filePath);
                } catch (error) {
                    this.#logger.error(`Failed to reload ${filePath}`, { error });
                }
            }
            
            // 批量重载完成后进行垃圾回收
            performGC({ onReload: true }, `batch reload: ${files.length} files`);
        } finally {
            this.#isProcessing = false;
            
            // 如果在处理过程中又有新的文件加入队列，继续处理
            if (this.#reloadQueue.size > 0) {
                this.processQueue();
            }
        }
    }

    /** 取消文件的重载 */
    cancelReload(filePath: string): void {
        const timer = this.#pendingReloads.get(filePath);
        if (timer) {
            clearTimeout(timer);
            this.#pendingReloads.delete(filePath);
        }
        this.#reloadQueue.delete(filePath);
    }

    /** 立即重载文件 */
    reloadNow(filePath: string): void {
        this.cancelReload(filePath);
        this.#reloadQueue.add(filePath);
        this.processQueue();
    }

    /** 获取待处理的重载文件 */
    getPendingReloads(): string[] {
        return Array.from(this.#pendingReloads.keys());
    }

    /** 获取队列中的文件 */
    getQueuedReloads(): string[] {
        return Array.from(this.#reloadQueue);
    }

    /** 清空队列 */
    clearQueue(): void {
        // 清空定时器
        for (const timer of this.#pendingReloads.values()) {
            clearTimeout(timer);
        }
        this.#pendingReloads.clear();
        
        // 清空队列
        this.#reloadQueue.clear();
    }

    /** 获取队列状态 */
    getStatus(): {
        pending: number;
        queued: number;
        processing: boolean;
    } {
        return {
            pending: this.#pendingReloads.size,
            queued: this.#reloadQueue.size,
            processing: this.#isProcessing
        };
    }

    /** 销毁管理器 */
    dispose(): void {
        this.clearQueue();
        this.removeAllListeners();
    }
} 