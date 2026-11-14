import type { ProviderGraph } from '@zhin.js/ai/provider';

/** The service a recorded provider id belongs to, and how people know it. */
export interface ProviderServiceDisplay {
  /** Stable merge key: the service id. */
  readonly key: string;
  /** Service label, else its driver id. Never a raw `services:<uuid>`. */
  readonly label: string;
}

export interface ProviderProfileDisplay extends ProviderServiceDisplay {
  readonly profileId: string;
  readonly profileLabel?: string;
  readonly model: string;
  /** `服务名 · 模型`. */
  readonly displayName: string;
}

/** Read-only display lookups over one graph revision; never exposes credentials or options. */
export interface ProviderDisplayIndex {
  /** `services:` / `accounts:` / `profiles:` id → its service; `undefined` when unknown. */
  resolveProvider(id: string): ProviderServiceDisplay | undefined;
  profile(id: string | undefined): ProviderProfileDisplay | undefined;
  /**
   * The profile an Agent binding actually runs on: `purposes.agents[name]` when assigned,
   * else the default `chat` purpose (adapter / endpoint / scene overrides are per conversation).
   */
  agentProfile(agentName?: string): (ProviderProfileDisplay & { readonly purpose: 'agent' | 'chat' }) | undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createProviderDisplayIndex(graph: ProviderGraph): ProviderDisplayIndex {
  const service = (id: string | undefined): ProviderServiceDisplay | undefined => {
    const entry = id ? graph.services[id] : undefined;
    if (!entry) return undefined;
    return { key: entry.id, label: nonEmpty(entry.label) ?? nonEmpty(entry.driver?.id) ?? entry.id };
  };
  const index: ProviderDisplayIndex = {
    resolveProvider(id) {
      if (Object.hasOwn(graph.services, id)) return service(id);
      if (Object.hasOwn(graph.accounts, id)) return service(graph.accounts[id]!.serviceId);
      if (Object.hasOwn(graph.profiles, id)) {
        const account = graph.accounts[graph.profiles[id]!.accountId];
        return account ? service(account.serviceId) : undefined;
      }
      return undefined;
    },
    profile(id) {
      if (!id || !Object.hasOwn(graph.profiles, id)) return undefined;
      const profile = graph.profiles[id]!;
      const owner = index.resolveProvider(id);
      if (!owner) return undefined;
      const label = nonEmpty(profile.label);
      return {
        ...owner,
        profileId: profile.id,
        ...(label ? { profileLabel: label } : {}),
        model: profile.model,
        displayName: `${owner.label} · ${profile.model}`,
      };
    },
    agentProfile(agentName) {
      const agents = graph.purposes.agents;
      const assigned = agentName && agents && Object.hasOwn(agents, agentName) ? index.profile(agents[agentName]) : undefined;
      if (assigned) return { ...assigned, purpose: 'agent' };
      const chat = index.profile(graph.purposes.defaults.chat);
      return chat ? { ...chat, purpose: 'chat' } : undefined;
    },
  };
  return Object.freeze(index);
}
