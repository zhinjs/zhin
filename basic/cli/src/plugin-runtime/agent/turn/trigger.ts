import type { AITriggerConfig } from '@zhin.js/core';
import type { Message } from '@zhin.js/core/runtime';
import type { AgentCapabilities } from '@zhin.js/agent/runtime';
import type { WorkroomTurnContinuation } from '../workroom-port.js';

const DEFAULT_TRIGGER_TIMEOUT_MS = 60_000;
const DEFAULT_TRIGGER_ERROR_TEMPLATE = '❌ AI 处理失败: {error}';
const DEFAULT_AI_TRIGGER_PREFIXES = ['#', 'AI:', 'ai:'];
const DEFAULT_AI_TRIGGER_IGNORE_PREFIXES = ['/', '!', '！'];

export function resolveTriggerTimeoutMs(trigger?: AITriggerConfig): number {
  const raw = trigger?.timeout;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_TRIGGER_TIMEOUT_MS;
}

export function renderTriggerError(trigger: AITriggerConfig | undefined, detail: string): string {
  const template = trigger?.errorTemplate?.trim()
    ? trigger.errorTemplate
    : DEFAULT_TRIGGER_ERROR_TEMPLATE;
  return template.replace('{error}', detail);
}

export class TriggerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI 处理超时（${timeoutMs}ms）`);
    this.name = 'TriggerTimeoutError';
  }
}

/** Runs one ingress-owned turn with cancellation propagated through the entire turn. */
export function withTriggerTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TriggerTimeoutError(timeoutMs)), timeoutMs);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

export function routeSpecialistAgent(
  userText: string,
  capabilities: Pick<AgentCapabilities, 'agents'>,
  preferredAgentDefinitionId?: string,
  defaultAgentDefinitionId?: string,
  platform?: string,
): { readonly userText: string; readonly agent?: AgentCapabilities['agents'][number] } {
  if (preferredAgentDefinitionId) {
    if (preferredAgentDefinitionId === defaultAgentDefinitionId) return { userText };
    const preferred = capabilities.agents.find((item) =>
      item.name === preferredAgentDefinitionId
      || item.qualifiedName === preferredAgentDefinitionId);
    if (!preferred) {
      throw new Error(`Workroom Orchestrator Agent is unavailable: ${preferredAgentDefinitionId}`);
    }
    return { userText, agent: preferred };
  }
  const match = userText.match(/^@([^\s:：]+)[:：]?\s*/u);
  if (match) {
    const name = match[1]!.toLowerCase();
    const agent = capabilities.agents.find((item) => item.name.toLowerCase() === name);
    if (agent) return { userText: userText.slice(match[0].length).trim() || userText, agent };
  }
  if (!platform) return { userText };
  const platformAgents = capabilities.agents.filter(
    (agent) => agent.platforms?.includes(platform),
  );
  if (platformAgents.length > 1) {
    throw new Error(
      `Multiple specialist Agents target platform ${platform}: ${platformAgents.map((agent) => agent.qualifiedName).join(', ')}`,
    );
  }
  return platformAgents[0] ? { userText, agent: platformAgents[0] } : { userText };
}

export function matchAiTrigger(
  message: Message,
  trigger: AITriggerConfig | undefined,
): { content: string } | null {
  if (trigger?.enabled === false) return null;
  const text = message.content.trim();
  if (!text) return null;

  const ignorePrefixes = trigger?.ignorePrefixes?.length
    ? trigger.ignorePrefixes
    : DEFAULT_AI_TRIGGER_IGNORE_PREFIXES;
  for (const prefix of ignorePrefixes) {
    if (prefix && text.startsWith(prefix)) return null;
  }

  const isPrivate = message.conversation.kind === 'private';
  const prefixes = trigger?.prefixes?.length ? trigger.prefixes : DEFAULT_AI_TRIGGER_PREFIXES;
  for (const prefix of prefixes) {
    if (!prefix) continue;
    if (text.startsWith(prefix)) {
      const content = text.slice(prefix.length).trim();
      return content ? { content } : null;
    }
  }

  if (trigger?.respondToAt !== false
    && !isPrivate
    && (message.mentioned === true || message.metadata?.mentioned === true)) {
    return { content: stripMentionMarkup(text) };
  }
  if (trigger?.respondToPrivate !== false && isPrivate) return { content: text };

  const keywords = trigger?.keywords ?? [];
  if (isPrivate && keywords.length > 0) {
    const lowerText = text.toLowerCase();
    for (const keyword of keywords) {
      if (keyword && lowerText.includes(keyword.toLowerCase())) return { content: text };
    }
  }
  return null;
}

export function workroomOrchestratorSessionKey(
  continuation: Pick<WorkroomTurnContinuation, 'projectId' | 'agentDefinitionId'>,
): string {
  return `workroom:${encodeURIComponent(continuation.projectId)}:orchestrator:${encodeURIComponent(continuation.agentDefinitionId)}`;
}

export function restrictWorkroomAgentCapabilities(
  capabilities: AgentCapabilities,
  workroomTurn: boolean,
): AgentCapabilities {
  if (!workroomTurn) return capabilities;
  const forbidden = new Set(['spawn_task']);
  return Object.freeze({
    ...capabilities,
    tools: Object.freeze(capabilities.tools.filter(tool => !forbidden.has(tool.name))),
  });
}

export function resolveRuntimeAgentTrigger(
  message: Message,
  trigger: AITriggerConfig | undefined,
  workroomAgentTurn: boolean,
): { content: string } | null {
  if (!workroomAgentTurn) return matchAiTrigger(message, trigger);
  if (trigger?.enabled === false) return null;
  const text = message.content.trim();
  if (!text) return null;
  return { content: stripMentionMarkup(text) || text };
}

function stripMentionMarkup(text: string): string {
  return text
    .replace(/\[CQ:(?:at|mention),[^\]]*\]/giu, '')
    .replace(/<@!?[^>\s]+>/gu, '')
    .replace(/\[(?:at|mention):[^\]]*\]/giu, '')
    .trim();
}
