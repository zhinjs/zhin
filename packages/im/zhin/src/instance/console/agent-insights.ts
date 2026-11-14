import { sessionDisplayNameOf, usageModelDisplayName } from '@zhin.js/gateway/usage';
import type { ProviderDisplayIndex } from '../inference/provider-display.js';

/**
 * Live Agent facts for the Console workbench (#1250): which provider / model each binding
 * actually runs on (the effective purpose binding, not the legacy `ai.agents.*.provider`
 * config fields), and the most recent turns from the trace archive.
 */
export interface AgentInsightsSource {
  /** Current provider graph as display lookups; `undefined` when inference storage is unavailable. */
  providerDisplay(): Promise<ProviderDisplayIndex | undefined>;
  /** Newest-last raw turn traces (the archive's own order); never includes request bodies in the projection. */
  recentTraces(limit: number): Promise<readonly unknown[]>;
}

export interface AgentBindingInput {
  readonly name: string;
  readonly provider?: string;
  readonly model?: string;
  readonly nickname?: string;
  readonly mcpServers?: readonly string[];
  readonly hasAgentFile?: boolean;
}

const UNSET = new Set(['', '-']);
const set = (value: unknown): string | undefined => typeof value === 'string' && !UNSET.has(value.trim()) ? value.trim() : undefined;

/**
 * Binding rows for `/introspection/bindings`. `provider` / `model` keep their meaning (what to show)
 * but now come from the effective purpose binding; the legacy config values stay in
 * `configuredProvider` / `configuredModel`.
 */
export function projectAgentBindings(
  bindings: readonly AgentBindingInput[],
  display: ProviderDisplayIndex | undefined,
): readonly Record<string, unknown>[] {
  return bindings.map((binding) => {
    const configuredProvider = set(binding.provider);
    const configuredModel = set(binding.model);
    const effective = display?.agentProfile(binding.name);
    return {
      name: binding.name,
      ...(binding.nickname ? { nickname: binding.nickname } : {}),
      provider: effective?.label ?? configuredProvider ?? '-',
      model: effective?.model ?? configuredModel ?? '-',
      ...(effective
        ? {
            displayName: effective.displayName,
            serviceId: effective.key,
            profileId: effective.profileId,
            ...(effective.profileLabel ? { profileLabel: effective.profileLabel } : {}),
            purpose: effective.purpose,
            bindingSource: 'purpose',
          }
        : { bindingSource: configuredProvider || configuredModel ? 'config' : 'none' }),
      ...(configuredProvider ? { configuredProvider } : {}),
      ...(configuredModel ? { configuredModel } : {}),
      mcpServers: [...(binding.mcpServers ?? [])],
      hasAgentFile: binding.hasAgentFile ?? false,
    };
  });
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** `/introspection/recent-turns` rows: counts, names and status only — no message or request text. */
export function projectRecentTurns(
  traces: readonly unknown[],
  display: ProviderDisplayIndex | undefined,
  limit: number,
): readonly Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const raw of [...traces].reverse()) {
    if (rows.length >= limit) break;
    const trace = raw as Record<string, any> | null;
    if (!trace || typeof trace !== 'object' || typeof trace.turn_id !== 'string' || typeof trace.session_key !== 'string') continue;
    const startedAt = num(trace.started_at);
    if (startedAt === undefined) continue;
    const calls: unknown[] = Array.isArray(trace.model_calls) ? trace.model_calls : [];
    const models = new Set<string>();
    for (const call of calls as Record<string, unknown>[]) {
      const provider = typeof call?.provider === 'string' ? call.provider : '';
      const model = typeof call?.model === 'string' ? call.model : '';
      if (!model) continue;
      models.add(usageModelDisplayName(provider, model, provider ? display?.resolveProvider(provider)?.label : undefined));
    }
    const sessionDisplayName = sessionDisplayNameOf(trace);
    const principal = typeof trace.principal?.display_name === 'string' ? trace.principal.display_name : undefined;
    rows.push({
      turnId: trace.turn_id,
      sessionKey: trace.session_key,
      ...(sessionDisplayName ? { sessionDisplayName } : {}),
      ...(principal ? { principal } : {}),
      startedAt,
      ...(num(trace.duration_ms) !== undefined ? { durationMs: trace.duration_ms } : {}),
      status: typeof trace.termination?.status === 'string' ? trace.termination.status : 'unknown',
      modelCalls: calls.length,
      totalTokens: num(trace.usage?.total_tokens) ?? 0,
      models: [...models],
    });
  }
  return rows;
}
