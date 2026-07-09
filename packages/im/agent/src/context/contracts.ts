/**
 * Context System — 模块契约（与实现同步）。
 *
 * 实现：builder/injector 链 + `buildTextTurnContext`（turn 级编排入口）。
 * `BuildContext.host` 为生产路径注入的 `ZhinAgentPrivate` 只读面。
 */

import type { AgentMessage } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { TurnEnvelopeParts } from './envelope-parts.js';

export interface BuildContext {
  message: Message;
  inboundContent?: string;
  sessionKey?: string;
  /** 生产 turn 路径注入；builder 写入 envelope 片段 */
  host?: ZhinAgentPrivate;
  envelope?: Partial<TurnEnvelopeParts>;
}

export interface InjectContext {
  message: Message;
  inboundContent?: string;
  envelope?: Partial<TurnEnvelopeParts>;
}

export interface ContextBuilder {
  name: string;
  build(context: BuildContext): Promise<AgentMessage[]>;
}

export interface ContextInjector {
  name: string;
  inject(messages: AgentMessage[], context: InjectContext): AgentMessage[];
}

export interface ContextSystemConfig {
  /** 预留扩展面 */
}
