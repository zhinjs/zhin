/**
 * Whether a `purposes.agents.<key>` model choice takes effect (#1250 agent-purpose-binding-ignored,
 * #1270). Pure: the run-time selection ({@link selectLanguagePurpose}) and the management view
 * (`purposeEffects`) use the same rules, so the Console can show a choice that the runtime ignores.
 *
 * `purposes.agents` is one key space shared by Agent bindings (`ai.agents.<binding>`) and
 * sub-agents. A sub-agent is looked up by its plugin-qualified name (`<plugin>__<agent>`) first;
 * its bare name only when no other sub-agent shares it and no binding uses it. A plugin's
 * sub-agent never resolves to a binding's purpose: without a usable key of its own it runs on
 * `chat`. A project's own sub-agent (`agents/<name>/` of the root plugin, whose qualified name is
 * its bare name) and an `ai.agents.<name>` binding of the same name are one agent, so that key is
 * its explicit choice (#1250 batch 21).
 *
 * Precedence for a sub-agent turn: its effective `purposes.agents.<key>` model wins over every
 * chat override (session, `purposes.adapters.<adapter>.chat`, `purposes.endpoints.<endpoint>.chat`,
 * `purposes.scenes.<scene>.chat`); only without one does it run on `chat`, where those overrides
 * apply before the global `purposes.chat`.
 */

/** A sub-agent as the purpose lookup sees it. */
export interface SubAgentPurposeTarget {
  readonly name: string;
  readonly qualifiedName?: string;
  /** Another sub-agent of the same turn (or project) has the same bare name. */
  readonly bareNameShared?: boolean;
}

/** Why a `purposes.agents` key does not reach a sub-agent. */
export type AgentPurposeIgnoredReason = 'binding-name' | 'ambiguous' | 'no-target';
/**
 * Why a purpose choice takes no effect (`purposeEffects`). Agent keys: {@link AgentPurposeIgnoredReason}.
 * ADR 0066 D7: `ambient-not-configured` (no `ai.trigger.ambient` section: interjection never runs),
 * `no-conversations` (no group has it on and no feature switch turns it on), `mode-off` (a decision
 * purpose that is off: its Profile is never called).
 */
export type PurposeIgnoredReason = AgentPurposeIgnoredReason | 'ambient-not-configured' | 'no-conversations' | 'mode-off';

export type SubAgentPurposeEffect =
  /** The sub-agent runs on `purposes.agents.<key>`. */
  | Readonly<{ status: 'effective'; key: string }>
  /** A configured key names the sub-agent, but the sub-agent runs on chat because of `reason`. */
  | Readonly<{ status: 'ignored'; key: string; reason: Exclude<AgentPurposeIgnoredReason, 'no-target'> }>
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
    // A root-plugin sub-agent (qualified name = bare name) is the binding of that name (#1250 batch 21).
    const sameAgent = qualified === agent.name && qualified !== 'zhin';
    return bindingNames.has(qualified) && !sameAgent
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
    /**
     * Sub-agents that run on this key: every one for `target: 'sub-agent'`; for `target: 'binding'`,
     * the project's own sub-agent of the binding's name (the same agent, #1250 batch 21).
     */
    agents?: readonly string[];
    /**
     * `target: 'binding'` only: sub-agents of the same name that do NOT use this key (it belongs
     * to the binding, `reason: 'binding-name'`); they run on chat unless keyed by qualified name.
     */
    ignoredAgents?: readonly string[];
    reason?: 'binding-name';
  }>
  | Readonly<{ status: 'ignored'; reason: AgentPurposeIgnoredReason; agents?: readonly string[] }>;

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
  const ignored = new Map<string, { reason: Exclude<AgentPurposeIgnoredReason, 'no-target'>; agents: string[] }>();
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
    if (bindingNames.has(key)) {
      // The binding uses its own key (and so does the project's sub-agent of that name);
      // a plugin sub-agent that was meant by it is reported alongside.
      const meant = ignored.get(key);
      result[key] = Object.freeze({ status: 'effective', target: 'binding',
        ...(agents?.length ? { agents: Object.freeze(agents.sort()) } : {}),
        ...(meant ? { ignoredAgents: Object.freeze(meant.agents.sort()), reason: 'binding-name' as const } : {}) });
    } else if (agents?.length) result[key] = Object.freeze({ status: 'effective', target: 'sub-agent', agents: Object.freeze(agents.sort()) });
    else {
      const meant = ignored.get(key);
      result[key] = meant
        ? Object.freeze({ status: 'ignored', reason: meant.reason, agents: Object.freeze(meant.agents.sort()) })
        : Object.freeze({ status: 'ignored', reason: 'no-target' });
    }
  }
  return Object.freeze(result);
}
