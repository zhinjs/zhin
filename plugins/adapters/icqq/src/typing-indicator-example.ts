/**
 * ICQQ Typing Indicator 使用示例
 *
 * 展示如何在 ICQQ 适配器中集成消息处理状态提示
 */

import type { IcqqEndpoint } from './endpoint.js';
import type { IcqqAdapter } from './adapter.js';
import {
  ICQQTypingIndicatorManager,
  enableTypingIndicator,
  createICQQTypingIndicatorManager,
  type ICQQTypingIndicatorConfig,
} from './typing-indicator.js';

// ── 示例 1: 在适配器中启用 Typing Indicator ──────────────────────────

/**
 * 在 ICQQ 适配器初始化时启用 Typing Indicator
 */
export function enableTypingIndicatorForAdapter(adapter: IcqqAdapter): void {
  // 遍历所有 Endpoint 实例
  for (const [endpointId, endpoint] of adapter.endpoints.entries()) {
    const manager = enableTypingIndicator(endpoint, {
      enabled: true,
      defaultEmoji: '⏳',
      autoRemove: true,
      removeDelay: 5000,
      // 私聊使用消息提示
      privateConfig: {
        type: 'message',
        message: '正在思考中...',
        autoRemove: true,
        removeDelay: 3000,
      },
      // 群聊使用表情回应
      groupConfig: {
        type: 'reaction',
        emoji: '⏳',
        autoRemove: true,
        removeDelay: 5000,
      },
    });

    console.log(`[ICQQ] Typing indicator enabled for endpoint: ${endpointId}`);
  }
}

// ── 示例 2: 在消息处理中使用 Typing Indicator ─────────────────────────

/**
 * 在消息处理流程中使用 Typing Indicator
 *
 * 使用示例：
 * ```typescript
 * // 在消息处理开始时
 * const indicator = await startTypingIndicator(endpoint, {
 *   messageId: message.$id,
 *   sessionId: `${message.$channel.type}:${message.$channel.id}`,
 *   userId: message.$sender.id,
 *   groupId: message.$channel.type === 'group' ? message.$channel.id : undefined,
 *   sceneType: message.$channel.type as 'private' | 'group',
 * });
 *
 * try {
 *   // 执行 AI 处理
 *   const result = await processMessage(message);
 *   return result;
 * } finally {
 *   // 处理完成后停止提示
 *   await indicator.stop();
 * }
 * ```
 */
export async function withTypingIndicator<T>(
  endpoint: IcqqEndpoint,
  options: {
    messageId?: string;
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType: 'private' | 'group';
  },
  fn: () => Promise<T>,
): Promise<T> {
  // 获取或创建 Typing Indicator 管理器
  let manager = endpoint.$typingIndicator;
  if (!manager) {
    manager = enableTypingIndicator(endpoint);
  }

  // 开始提示
  const indicator = await manager.start(options);

  try {
    // 执行实际处理
    const result = await fn();
    return result;
  } finally {
    // 停止提示
    await indicator.stop();
  }
}

// ── 示例 3: 自定义配置 ────────────────────────────────────────────────

/**
 * 自定义 Typing Indicator 配置
 */
export const customConfigs: Record<string, Partial<ICQQTypingIndicatorConfig>> = {
  // 简洁模式：只使用表情
  minimal: {
    enabled: true,
    defaultEmoji: '💭',
    autoRemove: true,
    removeDelay: 3000,
    privateConfig: {
      type: 'reaction',
      emoji: '💭',
    },
    groupConfig: {
      type: 'reaction',
      emoji: '💭',
    },
  },

  // 详细模式：使用消息提示
  verbose: {
    enabled: true,
    defaultEmoji: '⏳',
    autoRemove: true,
    removeDelay: 5000,
    privateConfig: {
      type: 'message',
      message: '正在处理您的请求，请稍候...',
      autoRemove: true,
      removeDelay: 5000,
    },
    groupConfig: {
      type: 'message',
      message: '正在思考中...',
      autoRemove: true,
      removeDelay: 3000,
    },
  },

  // 禁用模式
  disabled: {
    enabled: false,
  },
};

// ── 示例 4: 在插件中集成 ──────────────────────────────────────────────

/**
 * 在 ICQQ 插件中集成 Typing Indicator
 *
 * 在 `index.ts` 中添加：
 * ```typescript
 * import { enableTypingIndicatorForAdapter } from './typing-indicator-example.js';
 *
 * // 在适配器 mounted 后启用
 * provide({
 *   name: "icqq",
 *   mounted: async (p: Plugin) => {
 *     const adapter = new IcqqAdapter(p);
 *     await adapter.start();
 *
 *     // 启用 Typing Indicator
 *     enableTypingIndicatorForAdapter(adapter);
 *
 *     return adapter;
 *   },
 * });
 * ```
 */

// ── 示例 5: 监听消息事件 ──────────────────────────────────────────────

/**
 * 监听消息事件并自动添加 Typing Indicator
 */
export function setupTypingIndicatorHooks(adapter: IcqqAdapter): void {
  // 监听消息接收事件
  adapter.on('message.receive', async (message) => {
    const endpoint = adapter.endpoints.get(message.$endpoint);
    if (!endpoint) return;

    // 获取或创建 Typing Indicator 管理器
    let manager = endpoint.$typingIndicator;
    if (!manager) {
      manager = enableTypingIndicator(endpoint);
    }

    // 开始提示
    const indicator = await manager.start({
      messageId: message.$id,
      sessionId: `${message.$channel.type}:${message.$channel.id}`,
      userId: message.$sender.id,
      groupId: message.$channel.type === 'group' ? message.$channel.id : undefined,
      sceneType: message.$channel.type as 'private' | 'group',
    });

    // 注意：这里只是示例，实际应该在消息处理完成后停止
    // 通常由消息处理流程控制
  });
}

// ── 示例 6: 批量操作 ──────────────────────────────────────────────────

/**
 * 批量管理多个 Endpoint 的 Typing Indicator
 */
export class BatchTypingIndicatorManager {
  private managers: Map<string, ICQQTypingIndicatorManager> = new Map();

  /**
   * 注册 Endpoint
   */
  registerEndpoint(endpoint: IcqqEndpoint, config?: Partial<ICQQTypingIndicatorConfig>): void {
    const manager = enableTypingIndicator(endpoint, config);
    this.managers.set(endpoint.$id, manager);
  }

  /**
   * 开始提示
   */
  async start(
    endpointId: string,
    options: {
      messageId?: string;
      sessionId: string;
      userId?: string;
      groupId?: string;
      sceneType: 'private' | 'group';
    },
  ): Promise<void> {
    const manager = this.managers.get(endpointId);
    if (manager) {
      await manager.start(options);
    }
  }

  /**
   * 停止提示
   */
  async stop(endpointId: string, options: { sessionId: string }): Promise<void> {
    const manager = this.managers.get(endpointId);
    if (manager) {
      await manager.stop(options);
    }
  }

  /**
   * 停止所有提示
   */
  async stopAll(): Promise<void> {
    for (const manager of this.managers.values()) {
      await manager.stopAll();
    }
  }

  /**
   * 获取 Endpoint 的管理器
   */
  getManager(endpointId: string): ICQQTypingIndicatorManager | undefined {
    return this.managers.get(endpointId);
  }
}
