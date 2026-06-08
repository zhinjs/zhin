/**
 * 子 agent system prompt 净化：剥离父级编排指令（spawn_task / tool_search 等）
 */
import type { AgentDispatcher, AgentRole, AgentTask } from './orchestrator/agent-dispatcher.js';

export function sanitizeSubagentSystemPrompt(prompt: string): string {
  let out = prompt;
  out = out.replace(/##?\s*Orchestration[\s\S]*?(?=\n##|\n#|$)/gi, '');
  out = out.replace(/##?\s*主编排[\s\S]*?(?=\n##|\n#|$)/gi, '');
  out = out
    .replace(/\bspawn_task\b/gi, '[orchestration-redacted]')
    .replace(/\btool_search\b/gi, '[orchestration-redacted]')
    .replace(/\brun_deferred_task\b/gi, '[orchestration-redacted]');
  return out.trim();
}

export function buildSubagentRolePrompt(
  dispatcher: AgentDispatcher,
  role: AgentRole,
  task: AgentTask,
): string {
  return sanitizeSubagentSystemPrompt(dispatcher.buildRolePrompt(role, task));
}
