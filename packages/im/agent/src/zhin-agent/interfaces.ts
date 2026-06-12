/**
 * ZhinAgent 公共 API 接口定义
 *
 * 按职责拆分为 4 个接口，便于测试 mock 和依赖注入。
 * ZhinAgent 类实现所有接口；外部消费方按需使用具体接口而非完整类。
 */

import type { AgentMessage, AgentEvent, ImageContent, OutputElement } from '@zhin.js/ai';
import type { Message } from '../orchestrator/types.js';
import type { Tool } from '../orchestrator/types.js';
import type { SubagentManager } from '../subagent.js';
import type { ZhinAgentEventEmitter } from './event-emitter.js';
import type { ZhinAgentTurnMetrics } from './turn-metrics.js';
import type { OnChunkCallback } from './config.js';

// 提示：若此处 import 报错，说明尚未完全解耦。
// 请确保该文件只 import 类型（type-only），不引入运行时依赖。

/**
 * Turn 处理 —— 核心 AI 交互入口
 */
export interface IAgentTurnProcessor {
  process(
    content: string,
    commMessage: Message,
    externalTools?: Tool[],
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]>;

  processMultimodal(
    parts: import('@zhin.js/ai').ContentPart[],
    commMessage: Message,
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]>;

  prompt(
    input: string | AgentMessage | AgentMessage[],
    commMessage: Message,
    options?: { images?: ImageContent[]; onChunk?: OnChunkCallback },
  ): Promise<void>;

  steer(message: AgentMessage, commMessage: Message): void;
  followUp(message: AgentMessage, commMessage: Message): void;
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>): () => void;
  abort(): void;
  waitForIdle(): Promise<void>;
  isPromptBusy(): boolean;
  clearSteeringQueue(sessionKey?: string): void;
  clearFollowUpQueue(sessionKey?: string): void;
}

/**
 * 会话管理 —— 压缩、归档、持久化
 */
export interface IAgentSessionManager {
  compactSessionForCommMessage(commMessage: Message): Promise<{ ok: boolean; message: string }>;
  archiveSessionForCommMessage(commMessage: Message): Promise<boolean>;
  getLastTurnMetrics(): ZhinAgentTurnMetrics | null;
  /** @deprecated 消息事实源已迁至 im_transcripts / agent_messages */
  upgradeMemoryToDatabase(_msgModel: unknown, _sumModel: unknown): Promise<void>;
  upgradeProfilesToDatabase(model: any): void;
}

/**
 * 诊断与内省 —— 子 agent、事件发射器、内部状态
 */
export interface IAgentDiagnostics {
  getSubagentManager(): SubagentManager | null;
  getEventEmitter(): ZhinAgentEventEmitter;
  getLastTurnMetrics(): ZhinAgentTurnMetrics | null;
  /** @deprecated 使用 refs.zhinAgent.registerTool */
  registerTool(tool: import('@zhin.js/ai').AgentTool): () => void;
}

/**
 * 运行时配置 —— 上下文注入、绑定
 */
export interface IAgentConfigurator {
  configure(deps: Partial<import('./config.js').ZhinAgentDependencies>): void;
}
