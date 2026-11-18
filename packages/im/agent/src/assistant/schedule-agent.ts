/**
 * #1250 b52: the Agent a scheduled job runs on (`action.agent`). Absent: the default `zhin`.
 */
import { DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';

/** Error text naming the Agents the caller may pick instead. */
export function scheduleAgentNotFound(name: string, available: readonly string[]): string {
  const list = available.length ? available.join('、') : DEFAULT_ZHIN_AGENT_NAME;
  return `Agent 不存在或无权使用：${name}。可用的 Agent：${list}`;
}

/**
 * Validates an optional `agent` argument against the Agents a caller may use. `undefined` / empty:
 * no Agent (the default). Returns the trimmed name, or an error listing the usable Agents.
 */
export function checkScheduleAgent(
  value: unknown,
  usable: readonly string[],
): { agent?: string } | { error: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return { error: 'agent 必须是 Agent 名称（字符串）' };
  const name = value.trim();
  if (!name) return {};
  return usable.includes(name) ? { agent: name } : { error: scheduleAgentNotFound(name, usable) };
}

/**
 * Agents a chat principal may hand a scheduled job to (#1250 b52): the default `zhin`, plus the
 * configured bindings (`ai.agents`) that are visible in the principal's own turn — the same set
 * `@name` routing offers them (`availableAgents` of the turn: platforms / scopes / permissions).
 * Without a turn (`visible` undefined) only the default is usable.
 */
export function usableScheduleAgents(
  bindings: readonly string[],
  visible: readonly string[] | undefined,
): readonly string[] {
  const names = bindings.includes(DEFAULT_ZHIN_AGENT_NAME) ? bindings : [DEFAULT_ZHIN_AGENT_NAME, ...bindings];
  return Object.freeze(names.filter(name => name === DEFAULT_ZHIN_AGENT_NAME || visible?.includes(name) === true));
}
