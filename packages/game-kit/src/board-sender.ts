/**
 * 游戏棋盘会话键工具。
 *
 * Plugin Runtime 下游戏逻辑操作的是 game-kit 自有的 `GameMessageLike`
 * （由 `messageFromCommandInput` 从 CommandContext.input 桥接而来），
 * 不再依赖 `@zhin.js/core` 的 Message 类型或 Adapter.editMessage 交互路径。
 */
import type { GameMessageLike } from './command-message.js';

/**
 * 构建频道唯一键（用于会话查找）
 */
export function channelKey(message: GameMessageLike): string {
  return `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
}
