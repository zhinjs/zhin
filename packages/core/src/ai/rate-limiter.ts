/**
 * RateLimiter — AI 请求频率限制
 *
 * 防止单用户过度消耗 GPU/API 资源。
 *
 * 策略:
 *   1. 滑动窗口速率限制 — 每分钟 N 次请求
 *   2. 优雅降级 — 超限时返回友好提示而非静默丢弃
 */

import { Logger } from '@zhin.js/logger';

const logger = new Logger(null, 'RateLimiter');

// ============================================================================
// 配置
// ============================================================================

export interface RateLimitConfig {
  /** 每分钟最大请求数（默认 20） */
  maxRequestsPerMinute?: number;
  /** 冷却时间（秒），超限后需等待（默认 10） */
  cooldownSeconds?: number;
}

const DEFAULTS: Required<RateLimitConfig> = {
  maxRequestsPerMinute: 20,
  cooldownSeconds: 10,
};

// ============================================================================
// 类型
// ============================================================================

interface UserBucket {
  /** 最近请求的时间戳列表（ms） */
  timestamps: number[];
  /** 冷却结束时间（ms），0 表示无冷却 */
  cooldownUntil: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 如果被拒绝，返回友好提示 */
  message?: string;
  /** 需等待的秒数 */
  retryAfterSeconds?: number;
}

// ============================================================================
// RateLimiter
// ============================================================================

export class RateLimiter {
  private config: Required<RateLimitConfig>;
  private buckets: Map<string, UserBucket> = new Map();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config?: RateLimitConfig) {
    this.config = { ...DEFAULTS, ...config };
    // 定期清理过期的 bucket（每 5 分钟）
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * 检查请求是否被允许
   */
  check(userId: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(userId);

    if (!bucket) {
      bucket = { timestamps: [], cooldownUntil: 0 };
      this.buckets.set(userId, bucket);
    }

    // 1. 检查冷却期
    if (bucket.cooldownUntil > now) {
      const waitSec = Math.ceil((bucket.cooldownUntil - now) / 1000);
      return {
        allowed: false,
        message: `请稍等 ${waitSec} 秒后再发消息哦～消息太频繁啦 😊`,
        retryAfterSeconds: waitSec,
      };
    }

    // 2. 滑动窗口：清理 1 分钟前的时间戳
    const windowStart = now - 60_000;
    bucket.timestamps = bucket.timestamps.filter(t => t > windowStart);

    // 3. 检查速率
    if (bucket.timestamps.length >= this.config.maxRequestsPerMinute) {
      bucket.cooldownUntil = now + this.config.cooldownSeconds * 1000;
      const waitSec = this.config.cooldownSeconds;
      logger.warn(`User ${userId} rate limited: ${bucket.timestamps.length} requests in 1 min`);
      return {
        allowed: false,
        message: `你发消息太快啦，请等 ${waitSec} 秒后再试～`,
        retryAfterSeconds: waitSec,
      };
    }

    // 4. 记录这次请求
    bucket.timestamps.push(now);
    return { allowed: true };
  }

  /**
   * 清理长期不活跃的 bucket
   */
  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 分钟
    for (const [userId, bucket] of this.buckets) {
      const latest = bucket.timestamps[bucket.timestamps.length - 1] ?? 0;
      if (now - latest > staleThreshold && bucket.cooldownUntil < now) {
        this.buckets.delete(userId);
      }
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.buckets.clear();
  }
}
