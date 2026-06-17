/**
 * Agent system-prompt extension contract (per IM platform / adapter).
 *
 * Implementations live in adapter plugins; resolution runs in @zhin.js/agent.
 */
import type { Message } from './message.js';

export type AgentPromptSlot =
  | 'orchestrator'
  | 'deferred_worker';

/** Minimal tool shape for deferred catalog selection (no @zhin.js/ai import). */
export interface DeferredToolCatalogItem {
  name: string;
  description: string;
}

export interface AgentPromptBuildContext {
  slot: AgentPromptSlot;
  /** 当前 turn 的 Message 通讯上下文 */
  commMessage: Message<any>;
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
    catalog: DeferredToolCatalogItem[],
    maxTools: number,
  ): DeferredToolCatalogItem[] | null;
}
