/**
 * 游戏棋盘消息辅助工具
 * 提供会话键生成和消息 ID 更新回调封装
 *
 * 注意：实际的发送/编辑逻辑由 Adapter.editMessage 统一处理
 * - 支持编辑的平台：调用平台 API 编辑
 * - 不支持编辑的平台：自动 fallback 到发送新消息
 */
import type { Message } from '@zhin.js/core';

/**
 * 构建频道唯一键（用于会话查找）
 */
export function channelKey(message: Message<any>): string {
  return `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
}
