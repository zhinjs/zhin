import { findDeprecatedAgentConfigKeys } from './deprecated-agent-keys.js';
import { findDeprecatedAgentBindingKeys, stripDeprecatedAgentBindingKeys } from './deprecated-agent-binding-keys.js';

/** Explicit maintenance of retired, nonfunctional switches. Model resources and
 * credential sources are preserved verbatim for the separate migration preview. */
export function applyAiConfigFixes(input: unknown): { ai: Record<string, unknown> | undefined; fixes: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ai: undefined, fixes: [] };
  const ai: Record<string, unknown> = { ...input }, fixes: string[] = [];
  const bindings = ai.agents;
  if (bindings && typeof bindings === 'object' && !Array.isArray(bindings)) {
    for (const { agent, key } of findDeprecatedAgentBindingKeys(bindings)) fixes.push(`removed deprecated ai.agents.${agent}.${key}`);
    ai.agents = Object.fromEntries(Object.entries(bindings).map(([name, value]) => [name,
      value && typeof value === 'object' && !Array.isArray(value) ? stripDeprecatedAgentBindingKeys(value) : value]));
  }
  if (ai.agent && typeof ai.agent === 'object' && !Array.isArray(ai.agent)) {
    const agent: Record<string, unknown> = { ...ai.agent };
    for (const { key } of findDeprecatedAgentConfigKeys(agent)) {
      delete agent[key]; fixes.push(`removed deprecated ai.agent.${key}`);
    }
    ai.agent = agent;
  }
  for (const key of ['allowedTools', 'disabledTools', 'toolSearch', 'memoryMcp']) if (Object.hasOwn(ai, key)) {
    delete ai[key]; fixes.push(`removed deprecated ai.${key}`);
  }
  const context = ai.context;
  if (context && typeof context === 'object' && !Array.isArray(context)
    && 'maxMessagesBeforeSummary' in context && !('summaryThreshold' in context)) {
    const next: Record<string, unknown> = { ...context, summaryThreshold: context.maxMessagesBeforeSummary };
    delete next.maxMessagesBeforeSummary; ai.context = next;
    fixes.push('renamed ai.context.maxMessagesBeforeSummary to summaryThreshold');
  }
  return { ai, fixes };
}
