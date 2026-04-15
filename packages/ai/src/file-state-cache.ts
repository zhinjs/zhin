/**
 * File State Cache — LRU 文件状态缓存
 *
 * 参考 Claude Code 的 fileStateCache.ts 设计：
 * 使用路径归一化 + 大小驱逐的 LRU 缓存，
 * 避免 AI 工具重复读取同一文件。
 *
 * 核心设计：
 *   1. 路径归一化（resolve + normalize）确保一致的缓存键
 *   2. 双限制驱逐：条目数上限 + 字节大小上限
 *   3. 支持部分内容缓存（offset + limit）
 *   4. write/edit 后自动更新缓存
 */

import * as path from 'node:path';

// ============================================================================
// 常量
// ============================================================================

/** 默认缓存条目数上限 */
export const DEFAULT_MAX_ENTRIES = 100;

/** 默认缓存字节数上限（25MB） */
export const DEFAULT_MAX_SIZE_BYTES = 25 * 1024 * 1024;

// ============================================================================
// 类型定义
// ============================================================================

/** 缓存的文件状态 */
export interface FileState {
  /** 文件内容 */
  content: string;
  /** 缓存时间戳 */
  timestamp: number;
  /** 读取偏移（如果是部分读取） */
  offset?: number;
  /** 读取限制（如果是部分读取） */
  limit?: number;
  /** 是否是部分内容 */
  isPartialView?: boolean;
}

// ============================================================================
// FileStateCache
// ============================================================================

/**
 * LRU 文件状态缓存
 *
 * 使用双向链表维护访问顺序，Map 存储内容。
 * 同时由条目数和总字节数两个维度控制缓存大小。
 */
export class FileStateCache {
  private cache: Map<string, FileState> = new Map();
  private accessOrder: string[] = []; // 最近访问的在末尾
  private totalBytes: number = 0;
  private maxEntries: number;
  private maxSizeBytes: number;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES, maxSizeBytes = DEFAULT_MAX_SIZE_BYTES) {
    this.maxEntries = maxEntries;
    this.maxSizeBytes = maxSizeBytes;
  }

  /**
   * 归一化文件路径
   */
  private normalizePath(filePath: string): string {
    return path.resolve(path.normalize(filePath));
  }

  /**
   * 计算内容字节数
   */
  private contentBytes(content: string): number {
    return Buffer.byteLength(content, 'utf-8');
  }

  /**
   * 获取缓存的文件状态
   */
  get(filePath: string): FileState | undefined {
    const key = this.normalizePath(filePath);
    const entry = this.cache.get(key);
    if (entry) {
      // 更新访问顺序（移到末尾）
      this.touchAccessOrder(key);
    }
    return entry;
  }

  /**
   * 设置文件状态缓存
   */
  set(filePath: string, state: FileState): void {
    const key = this.normalizePath(filePath);

    // 如果已存在，先减去旧的字节数
    const existing = this.cache.get(key);
    if (existing) {
      this.totalBytes -= this.contentBytes(existing.content);
    }

    const newBytes = this.contentBytes(state.content);

    // 单文件内容超过 maxSizeBytes 的 1/4，不缓存
    if (newBytes > this.maxSizeBytes / 4) {
      return;
    }

    this.cache.set(key, state);
    this.totalBytes += newBytes;
    this.touchAccessOrder(key);

    // 驱逐：条目数或字节数超限
    this.evictIfNeeded();
  }

  /**
   * 删除指定文件的缓存
   */
  delete(filePath: string): boolean {
    const key = this.normalizePath(filePath);
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.totalBytes -= this.contentBytes(entry.content);
    this.cache.delete(key);
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    return true;
  }

  /**
   * 检查是否有缓存
   */
  has(filePath: string): boolean {
    return this.cache.has(this.normalizePath(filePath));
  }

  /**
   * 清空全部缓存
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.totalBytes = 0;
  }

  /** 当前缓存条目数 */
  get size(): number {
    return this.cache.size;
  }

  /** 当前缓存总字节数 */
  get bytes(): number {
    return this.totalBytes;
  }

  // ── 内部方法 ──

  private touchAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  private evictIfNeeded(): void {
    // 条目数驱逐
    while (this.cache.size > this.maxEntries && this.accessOrder.length > 0) {
      this.evictLRU();
    }
    // 字节数驱逐
    while (this.totalBytes > this.maxSizeBytes && this.accessOrder.length > 0) {
      this.evictLRU();
    }
  }

  private evictLRU(): void {
    const key = this.accessOrder.shift();
    if (!key) return;

    const entry = this.cache.get(key);
    if (entry) {
      this.totalBytes -= this.contentBytes(entry.content);
      this.cache.delete(key);
    }
  }
}
