/**
 * `ai.agents.<name>.priority` / `ai.agents.<name>.match` — inbound routing
 * fields that never took effect.
 *
 * IM inbound always resolves the `zhin` binding; the matcher that read these
 * fields had no production caller. They stay accepted for compatibility:
 * startup logs a warning, `zhin config check` reports them, and
 * `zhin config check --fix` deletes them. Other agents are still reached by
 * binding name (spawn_task, collaboration roles, assistant runtime).
 */
export const DEPRECATED_AGENT_BINDING_KEYS: Readonly<Record<string, string>> = Object.freeze({
  priority: '入站路由从未生效：IM 消息总是交给 ai.agents.zhin，其他 Agent 只按名字调用（spawn_task / 协作角色）。',
  match: '入站路由从未生效（包括 hasMedia 等全部条件）：IM 消息总是交给 ai.agents.zhin。图片等媒体请用 ai.multimodal.perception。',
});

export interface DeprecatedAgentBindingKey {
  readonly agent: string;
  readonly key: string;
  readonly reason: string;
}

/** Deprecated routing keys present under `ai.agents`, in agent then declaration order. */
export function findDeprecatedAgentBindingKeys(agents: unknown): DeprecatedAgentBindingKey[] {
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return [];
  const found: DeprecatedAgentBindingKey[] = [];
  for (const [agent, binding] of Object.entries(agents as Record<string, unknown>)) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) continue;
    for (const [key, reason] of Object.entries(DEPRECATED_AGENT_BINDING_KEYS)) {
      if (key in (binding as Record<string, unknown>)) found.push({ agent, key, reason });
    }
  }
  return found;
}

/** Copy of `binding` without the deprecated routing keys. */
export function stripDeprecatedAgentBindingKeys<T extends object>(binding: T): T {
  const rest = { ...binding } as Record<string, unknown>;
  for (const key of Object.keys(DEPRECATED_AGENT_BINDING_KEYS)) delete rest[key];
  return rest as T;
}
