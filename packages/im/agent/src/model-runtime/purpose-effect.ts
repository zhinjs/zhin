/**
 * Whether a `purposes.agents.<key>` model choice takes effect (#1250 agent-purpose-binding-ignored,
 * #1270). Pure: the run-time selection ({@link selectLanguagePurpose}) and the management view
 * (`purposeEffects`) use the same rules, so the Console can show a choice that the runtime ignores.
 *
 * `purposes.agents` is one key space shared by Agent bindings (`ai.agents.<binding>`) and
 * sub-agents. A sub-agent is looked up by its plugin-qualified name (`<plugin>__<agent>`) first;
 * its bare name only when no other sub-agent shares it and no binding uses it. A sub-agent never
 * resolves to a binding's purpose: without a usable key of its own it runs on `chat`.
 */

/** A sub-agent as the purpose lookup sees it. */
export interface SubAgentPurposeTarget {
  readonly name: string;
  readonly qualifiedName?: string;
  /** Another sub-agent of the same turn (or project) has the same bare name. */
  readonly bareNameShared?: boolean;
}

/** Why a key does not reach a sub-agent. */
export type PurposeIgnoredReason = 'binding-name' | 'ambiguous' | 'no-target';

export type SubAgentPurposeEffect =
  /** The sub-agent runs on `purposes.agents.<key>`. */
  | Readonly<{ status: 'effective'; key: string }>
  /** A configured key names the sub-agent, but the sub-agent runs on chat because of `reason`. */
  | Readonly<{ status: 'ignored'; key: string; reason: Exclude<PurposeIgnoredReason, 'no-target'> }>
  /** No key is configured for the sub-agent: it runs on chat. */
  | Readonly<{ status: 'unconfigured' }>;

/** Purpose effect for one sub-agent, given the configured `purposes.agents` keys. */
export function subAgentPurposeEffect(
  configuredKeys: ReadonlySet<string>,
  agent: SubAgentPurposeTarget,
  bindingNames: ReadonlySet<string>,
): SubAgentPurposeEffect {
  const qualified = agent.qualifiedName?.trim();
  if (qualified && configuredKeys.has(qualified)) {
    return bindingNames.has(qualified)
      ? Object.freeze({ status: 'ignored', key: qualified, reason: 'binding-name' })
      : Object.freeze({ status: 'effective', key: qualified });
  }
  if (configuredKeys.has(agent.name)) {
    if (bindingNames.has(agent.name)) return Object.freeze({ status: 'ignored', key: agent.name, reason: 'binding-name' });
    if (agent.bareNameShared) return Object.freeze({ status: 'ignored', key: agent.name, reason: 'ambiguous' });
    return Object.freeze({ status: 'effective', key: agent.name });
  }
  return Object.freeze({ status: 'unconfigured' });
}

/** Effect of one `purposes.agents.<key>` entry, for the management view. */
export type PurposeKeyEffect =
  | Readonly<{
    status: 'effective'; target: 'binding' | 'sub-agent';
    /** Sub-agents (`target: 'sub-agent'`) that run on this key. */
    agents?: readonly string[];
    /**
     * `target: 'binding'` only: sub-agents of the same name that do NOT use this key (it belongs
     * to the binding, `reason: 'binding-name'`); they run on chat unless keyed by qualified name.
     */
    ignoredAgents?: readonly string[];
    reason?: 'binding-name';
  }>
  | Readonly<{ status: 'ignored'; reason: PurposeIgnoredReason; agents?: readonly string[] }>;

/**
 * Effect of every configured `purposes.agents` key: used by an Agent binding, by sub-agents
 * (listed by qualified name), or ignored. `subAgents` is every sub-agent of the project; their
 * `bareNameShared` is derived here from the list when not given.
 */
export function purposeKeyEffects(
  configuredKeys: Iterable<string>,
  subAgents: readonly SubAgentPurposeTarget[],
  bindingNames: ReadonlySet<string>,
): Readonly<Record<string, PurposeKeyEffect>> {
  const keys = new Set([...configuredKeys].filter(key => key !== 'zhin'));
  const counts = new Map<string, number>();
  for (const agent of subAgents) counts.set(agent.name, (counts.get(agent.name) ?? 0) + 1);
  const effective = new Map<string, string[]>();
  const ignored = new Map<string, { reason: Exclude<PurposeIgnoredReason, 'no-target'>; agents: string[] }>();
  for (const agent of subAgents) {
    const target = { ...agent, bareNameShared: agent.bareNameShared ?? (counts.get(agent.name) ?? 0) > 1 };
    const effect = subAgentPurposeEffect(keys, target, bindingNames);
    const label = agent.qualifiedName ?? agent.name;
    if (effect.status === 'effective') effective.set(effect.key, [...(effective.get(effect.key) ?? []), label]);
    else if (effect.status === 'ignored') {
      const entry = ignored.get(effect.key) ?? { reason: effect.reason, agents: [] };
      entry.agents.push(label);
      ignored.set(effect.key, entry);
    }
  }
  const result: Record<string, PurposeKeyEffect> = {};
  for (const key of [...keys].sort()) {
    const agents = effective.get(key);
    if (agents?.length) result[key] = Object.freeze({ status: 'effective', target: 'sub-agent', agents: Object.freeze(agents.sort()) });
    else if (bindingNames.has(key)) {
      // The binding uses its own key; a sub-agent that was meant by it is reported alongside.
      const meant = ignored.get(key);
      result[key] = Object.freeze({ status: 'effective', target: 'binding',
        ...(meant ? { ignoredAgents: Object.freeze(meant.agents.sort()), reason: 'binding-name' as const } : {}) });
    } else {
      const meant = ignored.get(key);
      result[key] = meant
        ? Object.freeze({ status: 'ignored', reason: meant.reason, agents: Object.freeze(meant.agents.sort()) })
        : Object.freeze({ status: 'ignored', reason: 'no-target' });
    }
  }
  return Object.freeze(result);
}
