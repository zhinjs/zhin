import type { ActivityFeedbackSourceCarrier } from './activity-feedback/operation-source.js';
import type { Locale } from '@zhin.js/plugin-runtime';

/** Agent-owned lifecycle event contract shared by Runtime publishers and subscribers. */
export type AIEventName =
  | 'ai.processing.start'
  | 'ai.processing.finish'
  | 'ai.processing.error'
  | 'ai.agent.start'
  | 'ai.agent.finish'
  | 'ai.thinking'
  | 'ai.tool.call'
  | 'ai.tool.result'
  | 'ai.response'
  | 'ai.typing.start'
  | 'ai.typing.stop'
  | 'ai.activity.queued.start'
  | 'ai.activity.queued.clear'
  | 'ai.mcp.connect.start'
  | 'ai.mcp.connect.finish'
  | 'ai.mcp.connect.error'
  | 'ai.session.new'
  | 'ai.session.compact'
  | 'ai.hook'
  | 'schedule.start'
  | 'schedule.finish'
  | 'schedule.error';

export type AIEventSource = 'zhin-agent' | 'ai-hook' | 'orchestrator-hook';
export type AIEventMode = 'text' | 'multimodal';
export type AIEventPath = 'chat' | 'fast' | 'agent' | 'multimodal' | 'rate_limited';

export interface AIEventPayload extends ActivityFeedbackSourceCarrier {
  /** Display language captured by the originating turn or scheduled task. */
  readonly locale?: Locale;
  sessionId: string;
  source: AIEventSource;
  mode?: AIEventMode;
  path?: AIEventPath;
  userId?: string;
  platform?: string;
  /** Configured endpoint id when known, else the Endpoint CapabilityId (display / policy key). */
  endpointKey?: string;
  /**
   * The originating message's conversation as the Runtime addresses it: `endpointId` is always the
   * Endpoint CapabilityId (`conversation.endpoint.id`), `kind` / `id` are the raw conversation ref.
   * Feature switches (ADR 0050 / 0055) resolve their key from this, never from `endpointKey`.
   */
  conversationRef?: Readonly<{ endpointId: string; kind?: string; id?: string }>;
  sceneId?: string;
  messageId?: string;
  scope?: string;
  content?: string;
  reply?: string;
  thinking?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  model?: string;
  iterations?: number;
  /** Framework progress is formatted by the display consumer, after its locale fallback resolves. */
  iterationProgress?: Readonly<{ current: number; total: number }>;
  reason?: string;
  status?: 'ok' | 'partial' | 'error';
  serverName?: string;
  loadedToolNames?: string[];
  hookType?: string;
  hookAction?: string;
  hookContext?: Record<string, unknown>;
  messages?: string[];
  compactedCount?: number;
  savedTokens?: number;
  totalTokensBefore?: number;
  totalTokensAfter?: number;
  keepTyping?: boolean;
}
