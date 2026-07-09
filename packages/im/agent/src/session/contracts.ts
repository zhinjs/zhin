/**
 * Session System — 模块契约（与实现同步）。
 *
 * 实现：`SessionSystem.registerStrategy` + `prepareTextTurn` / `touchAfterTurn`；
 * IM/Agent 双 store 由 `ZhinAgentPrivate` 注入（`session-io` SSOT），
 * 非本模块内 `SessionStore` 注册表。`contracts.SessionStore` 为策略层抽象。
 */

import type { Message } from '@zhin.js/core';

export interface Session {
  sessionKey: string;
}

export interface CreateSessionInput {
  sessionKey: string;
  message: Message;
}

export interface SessionStore {
  findActive(sessionKey: string): Promise<Session | null>;
  create(input: CreateSessionInput): Promise<Session>;
  archive(sessionKey: string): Promise<void>;
}

export interface SessionStrategy {
  resolveSessionKey(message: Message): string;
  shouldArchive(message: Message): boolean;
}

export interface SessionSystemConfig {
  /** 预留扩展面 */
}
