/**
 * 通用游戏会话接口
 * 定义回合制游戏的基础会话结构
 */
import type { Message } from 'zhin.js';

/** 会话状态 */
export type GameStatus = 'active' | 'won' | 'draw' | 'aborted';

/** 通用游戏会话接口 */
export interface GameSession {
  /** 会话 ID */
  id: string;
  /** 适配器名称 */
  adapter: string;
  /** Endpoint 名称 */
  endpoint: string;
  /** 频道类型 */
  channel_type: 'private' | 'group' | 'channel';
  /** 频道 ID */
  channel_id: string;
  /** 频道唯一键 */
  channel_key: string;
  /** 棋盘消息 ID（用于编辑） */
  board_message_id: string;
  /** 当前状态 */
  status: GameStatus;
  /** 更新时间戳 */
  updated_at: number;
  /** 创建时间戳 */
  created_at: number;
}

/** 回合制游戏会话（2 人对战） */
export interface TurnBasedSession extends GameSession {
  /** 玩家 1 ID */
  player_1: string;
  /** 玩家 2 ID */
  player_2: string;
  /** 玩家 1 显示名 */
  player_1_name: string;
  /** 玩家 2 显示名 */
  player_2_name: string;
  /** 当前回合（1 或 2） */
  turn: 1 | 2;
  /** 胜者（0=无，1=玩家1，2=玩家2） */
  winner: 0 | 1 | 2;
  /** 步数 */
  move_count: number;
}

/** 生成会话 ID */
export function generateSessionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 获取当前回合玩家 ID */
export function currentPlayerId(session: TurnBasedSession): string {
  return session.turn === 1 ? session.player_1 : session.player_2;
}

/** 判断用户是否为本局玩家 */
export function isPlayer(session: TurnBasedSession, userId: string): boolean {
  return session.player_1 === userId || session.player_2 === userId;
}

/** 判断是否轮到该用户 */
export function isPlayerTurn(session: TurnBasedSession, userId: string): boolean {
  return currentPlayerId(session) === userId;
}

/** 获取玩家编号（1 或 2），非玩家返回 null */
export function playerNumber(session: TurnBasedSession, userId: string): 1 | 2 | null {
  if (session.player_1 === userId) return 1;
  if (session.player_2 === userId) return 2;
  return null;
}

/** 切换回合 */
export function nextTurn(current: 1 | 2): 1 | 2 {
  return current === 1 ? 2 : 1;
}

/** 从 Message 提取发送者显示名 */
export function senderDisplayName(message: Message<any>): string {
  const name = message.$sender.name?.trim();
  return name || message.$sender.id;
}
