/**
 * ZhinAgent host 契约类型 SSOT — ideal 模块与 internal/agent-host 共用，不依赖 zhin-agent 门面。
 */
import type { Usage } from '@zhin.js/ai';
import type { Message, Plugin } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../config/zhin-agent-config.js';

export type { ZhinAgentConfig, CompactionConfig } from '../config/zhin-agent-config.js';

export type OnChunkCallback = (chunk: string, full: string) => void;

export interface HostPhaseTraceConfig {
  phaseTraceEnabled: boolean;
  onPhaseTrace?: (event: {
    phase: string;
    sessionId: string;
    extra: Record<string, unknown>;
  }) => void;
}

export interface HostPromptTraceConfig {
  promptTraceEnabled: boolean;
  promptTraceVerbose?: boolean;
}

export type HostTurnPath = 'chat' | 'fast' | 'agent' | 'multimodal' | 'rate_limited' | 'superseded';

export interface HostTurnMetrics {
  usage: Usage;
  mainUsage?: Usage;
  subagentUsage?: Usage;
  path: HostTurnPath;
  iterations?: number;
  model?: string;
  /** 本轮用户输入预览（日志表格） */
  userInput?: string;
  /** 模型思考链预览（日志表格） */
  thinking?: string;
  /** 最终回复预览（日志表格） */
  output?: string;
}

export interface HostEventEmitter {
  on(eventType: string, handler: (event: unknown) => void | Promise<void>): () => void;
  dispatch(event: string, payload: Plugin.AIEventPayload): Promise<void>;
  emit(event: string, payload: Plugin.AIEventPayload): void;
  createPayload(
    sessionId: string,
    commMessage: Message,
    mode: Plugin.AIEventPayload['mode'],
    extra?: Partial<Plugin.AIEventPayload>,
  ): Plugin.AIEventPayload;
  setHostPlugin(plugin: Plugin): void;
  getHostPlugin(): Plugin | null;
}

export interface HostPromptController {
  schedule(request: HostPromptTurnRequest): Promise<HostAgentLoopTurnResult>;
  scheduleStream(request: HostPromptStreamTurnRequest): AsyncGenerator<
    import('../event/turn-event.js').TurnEvent,
    HostAgentLoopTurnResult
  >;
  abort(): void;
  waitForIdle(): Promise<void>;
  isBusy(): boolean;
  subscribe(listener: (event: unknown, signal: AbortSignal) => void | Promise<void>): () => void;
}

export interface HostPromptStreamTurnRequest extends Omit<HostPromptTurnRequest, 'execute'> {
  execute: (
    initialMessages: import('@zhin.js/ai').AgentMessage[],
    hooks: HostPromptTurnHooks,
    signal: AbortSignal,
    turnId: string,
  ) => AsyncGenerator<import('../event/turn-event.js').TurnEvent, HostAgentLoopTurnResult>;
}

export interface HostPromptTurnRequest {
  turnId?: string;
  intent?: import('../turn/turn-ingress.js').TurnIntent;
  principal?: import('../turn/turn-ingress.js').TurnPrincipal;
  onAdmitted?: () => void;
  sessionKey: string;
  sessionId: string;
  userMessages: import('@zhin.js/ai').AgentMessage[];
  onChunk?: OnChunkCallback;
  signal?: AbortSignal;
  execute: (
    initialMessages: import('@zhin.js/ai').AgentMessage[],
    hooks: HostPromptTurnHooks,
    signal: AbortSignal,
    turnId: string,
  ) => Promise<HostAgentLoopTurnResult>;
}

export interface HostPromptTurnHooks {
  getSteeringMessages: () => Promise<import('@zhin.js/ai').AgentMessage[]>;
  getFollowUpMessages: () => Promise<import('@zhin.js/ai').AgentMessage[]>;
}

export interface HostAgentLoopTurnResult {
  reply: string;
  usage: Usage;
  path: 'chat' | 'agent' | 'multimodal';
  iterations: number;
  model: string;
  toolCalls: import('../core/tool-calls-user-format.js').ToolCallRecord[];
  thinking?: string;
}

export interface HostTurnTracker {
  begin(): void;
  waitForPendingSubagents(): Promise<void>;
  finalize(partial: Omit<HostTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage }): Promise<void>;
}

export type RequiredHostConfig = Required<ZhinAgentConfig>;
