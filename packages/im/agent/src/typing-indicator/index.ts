/**
 * 消息处理状态适配层
 *
 * 提供统一的接口来提示用户"AI 正在处理"，
 * 不同平台可以有不同的实现方式：
 * - ICQQ：消息回应表情
 * - 其他平台：发送一条消息
 * - 支持配置和自定义
 */

import type { Plugin } from '@zhin.js/core';

// ── 类型定义 ──────────────────────────────────────────────────────────

export type TypingIndicatorType =
  | 'reaction'      // 消息回应（表情）
  | 'message'       // 发送消息
  | 'typing'        // 输入状态（如果平台支持）
  | 'none';         // 不提示

export interface TypingIndicatorConfig {
  /** 提示类型 */
  type: TypingIndicatorType;
  /** 表情符号（reaction 类型） */
  emoji?: string;
  /** 消息内容（message 类型） */
  message?: string;
  /** 是否在完成后自动移除 */
  autoRemove?: boolean;
  /** 自动移除延迟（毫秒） */
  removeDelay?: number;
  /** 平台特定配置 */
  platformConfig?: Record<string, unknown>;
}

export interface TypingIndicatorOptions {
  /** 消息 ID */
  messageId?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 用户 ID */
  userId?: string;
  /** 群组 ID */
  groupId?: string;
  /** 平台 */
  platform: string;
  /** Endpoint ID */
  endpointId: string;
  /** 场景类型 */
  sceneType: 'private' | 'group' | 'channel';
}

export interface TypingIndicator {
  /** 开始提示 */
  start(): Promise<void>;
  /** 更新提示（可选） */
  update?(message: string): Promise<void>;
  /** 停止提示 */
  stop(): Promise<void>;
  /** 是否正在显示 */
  isActive(): boolean;
}

// ── 平台适配器接口 ────────────────────────────────────────────────────

export interface TypingIndicatorAdapter {
  /** 平台名称 */
  platform: string;
  /** 支持的提示类型 */
  supportedTypes: TypingIndicatorType[];
  /** 创建提示实例 */
  createIndicator(
    options: TypingIndicatorOptions,
    config: TypingIndicatorConfig,
  ): TypingIndicator;
}

// ── 默认配置 ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TypingIndicatorConfig = {
  type: 'reaction',
  emoji: '⏳',
  message: '正在处理中...',
  autoRemove: true,
  removeDelay: 5000,
};

// ── 反应式提示（默认） ────────────────────────────────────────────────

export class ReactionTypingIndicator implements TypingIndicator {
  private active = false;
  private reactionId: string | null = null;

  constructor(
    private options: TypingIndicatorOptions,
    private config: TypingIndicatorConfig,
    private addReaction: (
      messageId: string,
      emoji: string,
      options: TypingIndicatorOptions,
    ) => Promise<string | null>,
    private removeReaction: (messageId: string, reactionId: string) => Promise<void>,
  ) {}

  async start(): Promise<void> {
    if (this.active || !this.options.messageId) {
      return;
    }

    this.active = true;
    try {
      this.reactionId = await this.addReaction(
        this.options.messageId,
        this.config.emoji || '⏳',
        this.options,
      );
    } catch (error) {
      this.active = false;
      this.reactionId = null;
      console.error('[TypingIndicator] Failed to add reaction:', error);
    }
  }

  async stop(): Promise<void> {
    if (!this.active || !this.reactionId || !this.options.messageId) {
      return;
    }

    const messageId = this.options.messageId;
    const reactionId = this.reactionId;
    this.active = false;
    this.reactionId = null;

    try {
      await this.removeReaction(messageId, reactionId);
    } catch (error) {
      console.error('[TypingIndicator] Failed to remove reaction:', error);
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

// ── 消息式提示 ────────────────────────────────────────────────────────

function hasTypingSendTarget(options: TypingIndicatorOptions): boolean {
  if (options.userId) return true;
  if (
    (options.sceneType === 'group' || options.sceneType === 'channel') &&
    options.groupId
  ) {
    return true;
  }
  return Boolean(options.sessionId?.trim());
}

export class MessageTypingIndicator implements TypingIndicator {
  private active = false;
  private messageId: string | null = null;

  constructor(
    private options: TypingIndicatorOptions,
    private config: TypingIndicatorConfig,
    private sendMessage: (options: TypingIndicatorOptions, content: string) => Promise<string | null>,
    private deleteMessage: (messageId: string) => Promise<void>,
    private editMessage?: (messageId: string, content: string) => Promise<void>,
  ) {}

  async start(): Promise<void> {
    if (this.active || !hasTypingSendTarget(this.options)) {
      return;
    }

    this.active = true;
    try {
      this.messageId = await this.sendMessage(
        this.options,
        this.config.message || '正在处理中...',
      );
      if (!this.messageId) {
        this.active = false;
      }
    } catch (error) {
      this.active = false;
      this.messageId = null;
      console.error('[TypingIndicator] Failed to send message:', error);
    }
  }

  async update(message: string): Promise<void> {
    if (!this.active || !this.messageId) {
      return;
    }

    if (this.editMessage) {
      try {
        await this.editMessage(this.messageId, message);
      } catch (error) {
        console.error('[TypingIndicator] Failed to edit message:', error);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.active || !this.messageId) {
      return;
    }

    try {
      if (this.config.autoRemove) {
        await this.deleteMessage(this.messageId);
      }
      this.active = false;
      this.messageId = null;
    } catch (error) {
      console.error('[TypingIndicator] Failed to delete message:', error);
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

// ── 原生输入状态（平台 sendTyping / setTyping 等） ─────────────────────

export class NativeTypingIndicator implements TypingIndicator {
  private active = false;
  private keepaliveTimer?: ReturnType<typeof setInterval>;

  constructor(
    private options: TypingIndicatorOptions,
    private config: TypingIndicatorConfig,
    private startTyping: (options: TypingIndicatorOptions) => Promise<void>,
    private stopTyping: (options: TypingIndicatorOptions) => Promise<void>,
  ) {}

  async start(): Promise<void> {
    if (this.active || !hasTypingSendTarget(this.options)) {
      return;
    }
    this.active = true;
    try {
      await this.startTyping(this.options);
      const raw = this.config.platformConfig?.keepaliveIntervalMs;
      const intervalMs = typeof raw === 'number' && raw > 0 ? raw : 5_000;
      this.keepaliveTimer = setInterval(() => {
        void this.startTyping(this.options).catch((error) => {
          console.error('[TypingIndicator] keepalive failed:', error);
        });
      }, intervalMs);
    } catch (error) {
      this.active = false;
      if (this.keepaliveTimer) {
        clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = undefined;
      }
      console.error('[TypingIndicator] Failed to start native typing:', error);
    }
  }

  async stop(): Promise<void> {
    if (!this.active) {
      return;
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
    }
    try {
      await this.stopTyping(this.options);
    } catch (error) {
      console.error('[TypingIndicator] Failed to stop native typing:', error);
    } finally {
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

// ── 空提示（不显示） ──────────────────────────────────────────────────

export class NoneTypingIndicator implements TypingIndicator {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  isActive(): boolean {
    return false;
  }
}

// ── 提示管理器 ────────────────────────────────────────────────────────

export class TypingIndicatorManager {
  private adapters: Map<string, TypingIndicatorAdapter> = new Map();
  private activeIndicators: Map<string, TypingIndicator> = new Map();
  private defaultConfig: TypingIndicatorConfig;

  constructor(defaultConfig: Partial<TypingIndicatorConfig> = {}) {
    this.defaultConfig = { ...DEFAULT_CONFIG, ...defaultConfig };
  }

  /**
   * 注册平台适配器
   */
  registerAdapter(adapter: TypingIndicatorAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  /**
   * 获取平台适配器
   */
  getAdapter(platform: string): TypingIndicatorAdapter | undefined {
    return this.adapters.get(platform);
  }

  /**
   * 创建提示实例
   */
  createIndicator(
    options: TypingIndicatorOptions,
    config?: Partial<TypingIndicatorConfig>,
  ): TypingIndicator {
    const adapter = this.adapters.get(options.platform);
    if (!adapter) {
      console.warn(`[TypingIndicator] No adapter for platform: ${options.platform}`);
      return new NoneTypingIndicator();
    }

    const mergedConfig = { ...this.defaultConfig, ...config };

    // 检查平台是否支持该提示类型
    if (!adapter.supportedTypes.includes(mergedConfig.type)) {
      console.warn(
        `[TypingIndicator] Platform ${options.platform} does not support type: ${mergedConfig.type}`,
      );
      // 回退到第一个支持的类型
      if (adapter.supportedTypes.length > 0) {
        mergedConfig.type = adapter.supportedTypes[0];
      } else {
        return new NoneTypingIndicator();
      }
    }

    return adapter.createIndicator(options, mergedConfig);
  }

  /**
   * 开始提示
   */
  async start(
    options: TypingIndicatorOptions,
    config?: Partial<TypingIndicatorConfig>,
  ): Promise<TypingIndicator> {
    const key = this.getIndicatorKey(options);
    const existing = this.activeIndicators.get(key);
    if (existing) {
      return existing;
    }

    const indicator = this.createIndicator(options, config);
    this.activeIndicators.set(key, indicator);
    try {
      await indicator.start();
    } catch (error) {
      this.activeIndicators.delete(key);
      throw error;
    }

    return indicator;
  }

  /**
   * 停止提示
   */
  async stop(options: TypingIndicatorOptions): Promise<void> {
    const key = this.getIndicatorKey(options);
    const indicator = this.activeIndicators.get(key);

    if (indicator) {
      await indicator.stop();
      this.activeIndicators.delete(key);
    }
  }

  /**
   * 停止所有提示
   */
  async stopAll(): Promise<void> {
    for (const [key, indicator] of this.activeIndicators.entries()) {
      try {
        await indicator.stop();
      } catch (error) {
        console.error(`[TypingIndicator] Failed to stop indicator ${key}:`, error);
      }
    }
    this.activeIndicators.clear();
  }

  /**
   * 获取活跃的提示
   */
  getActiveIndicator(options: TypingIndicatorOptions): TypingIndicator | undefined {
    const key = this.getIndicatorKey(options);
    return this.activeIndicators.get(key);
  }

  /**
   * 生成指示器键
   */
  private getIndicatorKey(options: TypingIndicatorOptions): string {
    return `${options.platform}:${options.endpointId}:${options.sessionId || options.messageId}`;
  }

  async dispose(): Promise<void> {
    await this.stopAll();
    this.adapters.clear();
  }
}

// ── 预定义适配器 ──────────────────────────────────────────────────────

/**
 * ICQQ 适配器（使用消息回应）
 */
export class ReactionTypingIndicatorAdapter implements TypingIndicatorAdapter {
  readonly platform: string;
  readonly supportedTypes: TypingIndicatorType[] = ['reaction', 'message'];

  constructor(
    platform: string,
    private addReaction: (
      messageId: string,
      emoji: string,
      options: TypingIndicatorOptions,
    ) => Promise<string | null>,
    private removeReaction: (messageId: string, reactionId: string) => Promise<void>,
    private sendMessage: (options: TypingIndicatorOptions, content: string) => Promise<string | null>,
    private deleteMessage: (messageId: string) => Promise<void>,
    private editMessage?: (messageId: string, content: string) => Promise<void>,
  ) {
    this.platform = platform;
  }

  createIndicator(
    options: TypingIndicatorOptions,
    config: TypingIndicatorConfig,
  ): TypingIndicator {
    switch (config.type) {
      case 'reaction':
        return new ReactionTypingIndicator(
          options,
          config,
          this.addReaction,
          this.removeReaction,
        );
      case 'message':
        return new MessageTypingIndicator(
          options,
          config,
          this.sendMessage,
          this.deleteMessage,
          this.editMessage,
        );
      default:
        return new NoneTypingIndicator();
    }
  }
}

/**
 * 原生输入状态适配器（sendTyping / setTyping 等）
 */
export class NativeTypingIndicatorAdapter implements TypingIndicatorAdapter {
  readonly platform: string;
  readonly supportedTypes: TypingIndicatorType[] = ['typing', 'none'];

  constructor(
    platform: string,
    private startTyping: (options: TypingIndicatorOptions) => Promise<void>,
    private stopTyping: (options: TypingIndicatorOptions) => Promise<void>,
  ) {
    this.platform = platform;
  }

  createIndicator(
    options: TypingIndicatorOptions,
    config: TypingIndicatorConfig,
  ): TypingIndicator {
    switch (config.type) {
      case 'typing':
        return new NativeTypingIndicator(
          options,
          config,
          this.startTyping,
          this.stopTyping,
        );
      default:
        return new NoneTypingIndicator();
    }
  }
}

/**
 * 通用适配器（使用消息）
 */
export class GenericTypingIndicatorAdapter implements TypingIndicatorAdapter {
  readonly platform: string;
  readonly supportedTypes: TypingIndicatorType[] = ['message', 'none'];

  constructor(
    platform: string,
    private sendMessage: (options: TypingIndicatorOptions, content: string) => Promise<string | null>,
    private deleteMessage: (messageId: string) => Promise<void>,
    private editMessage?: (messageId: string, content: string) => Promise<void>,
  ) {
    this.platform = platform;
  }

  createIndicator(
    options: TypingIndicatorOptions,
    config: TypingIndicatorConfig,
  ): TypingIndicator {
    switch (config.type) {
      case 'message':
        return new MessageTypingIndicator(
          options,
          config,
          this.sendMessage,
          this.deleteMessage,
          this.editMessage,
        );
      default:
        return new NoneTypingIndicator();
    }
  }
}

// ── 全局实例 ──────────────────────────────────────────────────────────

let globalManager: TypingIndicatorManager | null = null;

/**
 * 获取全局提示管理器
 */
export function getTypingIndicatorManager(): TypingIndicatorManager {
  if (!globalManager) {
    globalManager = new TypingIndicatorManager();
  }
  return globalManager;
}

/**
 * 初始化提示管理器
 */
export function initTypingIndicatorManager(
  defaultConfig?: Partial<TypingIndicatorConfig>,
): TypingIndicatorManager {
  globalManager = new TypingIndicatorManager(defaultConfig);
  return globalManager;
}

export async function disposeTypingIndicatorManager(): Promise<void> {
  if (globalManager) {
    await globalManager.dispose();
    globalManager = null;
  }
}

// ── 便捷函数 ──────────────────────────────────────────────────────────

/**
 * 快速开始提示
 */
export async function startTypingIndicator(
  options: TypingIndicatorOptions,
  config?: Partial<TypingIndicatorConfig>,
): Promise<TypingIndicator> {
  return getTypingIndicatorManager().start(options, config);
}

/**
 * 快速停止提示
 */
export async function stopTypingIndicator(
  options: TypingIndicatorOptions,
): Promise<void> {
  return getTypingIndicatorManager().stop(options);
}
