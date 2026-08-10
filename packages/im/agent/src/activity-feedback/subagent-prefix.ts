import type { AIEventPayload } from '../ai-event-subscriber.js';
import type { ResolvedActivityFeedbackPhaseConfig } from './types.js';

/**
 * Subagent activity feedback tag (e.g. researcher).
 * Prefer ai.agents / *.agent.md name; fall back to role; never use long task labels.
 */
export function resolveSubagentActivityTag(
  payload: Pick<AIEventPayload, 'source' | 'agentId'>,
): string | undefined {
  if (payload.source !== 'subagent') return undefined;
  const raw = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
  if (!raw) return 'subagent';
  // Keep tags short so IM prefixes stay readable ([researcher] 思考中...).
  if (raw.length > 32 || /\s/.test(raw)) return 'subagent';
  return raw;
}

export function formatSubagentActivityPrefix(tag: string): string {
  return `[${tag}]`;
}

export function withSubagentActivityPrefix(
  message: string,
  payload: Pick<AIEventPayload, 'source' | 'agentId'>,
): string {
  const tag = resolveSubagentActivityTag(payload);
  if (!tag) return message;
  const prefix = formatSubagentActivityPrefix(tag);
  const text = message.trim();
  if (!text) return prefix;
  if (text.startsWith(prefix)) return text;
  return `${prefix} ${text}`;
}

/** Prefix message-type phase configs for subagent status bubbles. */
export function applySubagentActivityPrefixToConfig(
  config: ResolvedActivityFeedbackPhaseConfig,
  payload: Pick<AIEventPayload, 'source' | 'agentId'>,
): ResolvedActivityFeedbackPhaseConfig {
  if (config.type !== 'message' || !config.message) return config;
  const message = withSubagentActivityPrefix(config.message, payload);
  if (message === config.message) return config;
  return { ...config, message };
}

/**
 * Isolate subagent typing indicators from the parent turn so both can
 * appear in the same IM session without stomping each other.
 */
export function resolveActivityFeedbackSessionId(
  payload: Pick<AIEventPayload, 'source' | 'agentId' | 'sessionId' | 'taskId'>,
): string {
  const base = payload.sessionId;
  const tag = resolveSubagentActivityTag(payload);
  if (!tag) return base;
  const task = typeof payload.taskId === 'string' && payload.taskId.trim()
    ? payload.taskId.trim().slice(0, 12)
    : 'task';
  return `${base}::agent:${tag}:${task}`;
}
