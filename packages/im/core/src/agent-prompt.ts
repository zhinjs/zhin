/**
 * Agent system-prompt extension contract (per IM platform / adapter).
 *
 * Implementations live in adapter plugins; resolution runs in @zhin.js/agent.
 */
import type { AgentTool } from '@zhin.js/ai';
import type { ToolContext } from './types.js';

export type AgentPromptSlot =
  | 'orchestrator'
  | 'deferred_worker';

export interface AgentPromptBuildContext {
  slot: AgentPromptSlot;
  /** 含 platform / botId / scope（场景类型）/ sceneId（群号或私聊对端 ID）/ senderId / roles */
  toolContext: ToolContext;
  toolSearch: boolean;
  /** Truncated user message for intent hints (~500 chars). */
  userMessagePreview?: string;
  deferred?: {
    goal: string;
    toolQuery?: string;
    domainStats?: string;
  };
}

export interface AgentPromptSection {
  /** Stable id for debug / logs (e.g. platform.icqq.orchestrator). */
  id: string;
  title?: string;
  body: string;
  /** Lower sorts earlier; default 100. */
  priority?: number;
}

export interface AgentPromptContributor {
  readonly platform: string;

  buildSections(ctx: AgentPromptBuildContext): Promise<AgentPromptSection[] | null>;

  /** When true, platform may supply selectDeferredTools for this task. */
  matchesDeferredTask?(ctx: AgentPromptBuildContext): boolean;

  /** Non-null replaces default TF-IDF deferred tool selection. */
  selectDeferredTools?(
    query: string,
    goal: string,
    catalog: AgentTool[],
    maxTools: number,
  ): AgentTool[] | null;
}
