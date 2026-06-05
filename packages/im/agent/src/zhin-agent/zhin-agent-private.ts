/**
 * Internal surface for turn-pipeline / tool-orchestration modules.
 * Not part of the public API.
 */
import type { AIProvider, AgentTool, ContentPart, Usage } from '@zhin.js/ai';
import type { OutputElement } from '@zhin.js/ai';
import type { ChatHistoryContext } from '@zhin.js/ai';
import type { IMSessionStore, MemoryIMSessionStore } from '@zhin.js/ai';
import type { ModelRegistry } from '@zhin.js/ai';
import type { Plugin } from '@zhin.js/core';
import type { Tool, ToolContext } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { SubagentManager } from '../subagent.js';
import type { UserProfileStore } from '../user-profile.js';
import type { ConversationMemory } from '@zhin.js/ai';
import type { SessionManager } from '@zhin.js/ai';
import type { RateLimiter } from '@zhin.js/ai';
import type { ZhinAgentEventEmitter } from './event-emitter.js';
import type { TurnTracker } from './turn-tracker.js';
import type { DeferredWorkerRunner } from '../deferred-worker-runner.js';
import type { ZhinAgentConfig, OnChunkCallback } from './config.js';
import type { PhaseTraceConfig } from './phase-trace.js';
import type { ZhinAgentTurnMetrics } from './turn-metrics.js';
import type { ResolvedAgentBinding } from '../config/types.js';

export interface ZhinAgentPrivate {
  readonly config: Required<ZhinAgentConfig>;
  readonly provider: AIProvider;
  readonly activeBinding: ResolvedAgentBinding | null;
  getTurnProvider(): AIProvider;
  readonly skillRegistry: SkillRegistry | null;
  readonly orchestrator: AgentOrchestrator | null;
  readonly sessions: SessionManager;
  readonly chatHistory: ChatHistoryContext | null;
  readonly imSessionStore: IMSessionStore | MemoryIMSessionStore;
  readonly memory: ConversationMemory;
  readonly externalTools: Map<string, AgentTool>;
  readonly userProfiles: UserProfileStore;
  readonly rateLimiter: RateLimiter;
  readonly subagentManager: SubagentManager | null;
  readonly bootstrapContext: string;
  readonly activeSkillsContext: string;
  readonly skillsSummaryXML: string;
  readonly modelRegistry: ModelRegistry | null;
  readonly phaseConfig: PhaseTraceConfig;
  readonly emitter: ZhinAgentEventEmitter;
  deferredCatalog: AgentTool[];
  readonly deferredWorkerRunner: DeferredWorkerRunner;
  lastToolSearchDeferredStats?: string;
  readonly turnTracker: TurnTracker;

  waitForMemoryPersistence(): Promise<void>;
  beginActiveTurn(): void;
  finalizeActiveTurn(
    partial: Omit<ZhinAgentTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage },
  ): Promise<void>;
  emitSessionNewEvent(
    sessionId: string,
    context: ToolContext,
    mode: 'text' | 'multimodal',
    content: string,
    reply: string,
  ): void;
  emitSessionCompactEvent(
    sessionId: string,
    context: ToolContext,
    mode: 'text' | 'multimodal',
    info: {
      microSavedTokens: number;
      autoSavedTokens: number;
      totalTokensBefore: number;
      totalTokensAfter: number;
    },
  ): void;
  buildDisciplinedPrompt(basePrompt: string): string;
  resolveAgentToolsForTurn(
    allTools: AgentTool[],
    context: ToolContext,
  ): { tools: AgentTool[]; deferredStats?: string };
  runDeferredWorker(
    goal: string,
    toolQuery: string | undefined,
    context: ToolContext,
    allTools: AgentTool[],
  ): Promise<string>;
}

export function asPrivate(agent: {
  getTurnProvider(): AIProvider;
  getActiveBinding(): ResolvedAgentBinding | null;
}): ZhinAgentPrivate {
  return agent as unknown as ZhinAgentPrivate;
}

export type { OnChunkCallback, OutputElement, Tool, ToolContext, Plugin, ContentPart };
