/**
 * 子 agent system prompt 净化：剥离父级编排指令（spawn_task / tool_search 等）
 */
import type { AgentDispatcher, AgentRole, AgentTask } from './orchestrator/agent-dispatcher.js';

export function sanitizeSubagentSystemPrompt(prompt: string): string {
  const withoutSections = removePromptSections(prompt, ['orchestration', '主编排']);
  return redactOrchestrationTerms(withoutSections).trim();
}

function removePromptSections(prompt: string, sectionNames: readonly string[]): string {
  const lines = prompt.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = readMarkdownHeading(line);
    if (heading) {
      const lower = heading.toLowerCase();
      skipping = sectionNames.some((name) => lower === name.toLowerCase());
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

function readMarkdownHeading(line: string): string | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('#')) return null;
  let i = 0;
  while (i < trimmed.length && trimmed[i] === '#') i++;
  return trimmed.slice(i).trim();
}

function redactOrchestrationTerms(text: string): string {
  return text
    .replaceAll('spawn_task', '[orchestration-redacted]')
    .replaceAll('tool_search', '[orchestration-redacted]')
    .replaceAll('run_deferred_task', '[orchestration-redacted]');
}

export function buildSubagentRolePrompt(
  dispatcher: AgentDispatcher,
  role: AgentRole,
  task: AgentTask,
): string {
  return sanitizeSubagentSystemPrompt(dispatcher.buildRolePrompt(role, task));
}
