import type { ConsoleAgentRuntime } from '@zhin.js/host-http';
import type { RuntimeSnapshot, SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  resolveCurrentAgentConsole,
  resolveCurrentAgentIntrospection,
} from './agent-console.js';
import { AgentConfigProjection } from './agent-config-projection.js';
import { projectAgentBindings, projectRecentTurns, type AgentBindingInput, type AgentInsightsSource } from './agent-insights.js';
import {
  listGenerationCommands,
  listGenerationComponents,
  listGenerationMiddlewares,
  listGenerationPromptSections,
  listGenerationTools,
  renderGenerationComponent,
  previewGenerationComponentDelivery,
} from './agent-feature-projection.js';

const RECENT_TURNS_LIMIT = 20;

async function providerDisplayOf(insights: AgentInsightsSource | undefined) {
  try { return await insights?.providerDisplay(); } catch { return undefined; }
}

function createAgentRuntime(
  projectRoot: string,
  getSnapshot: () => RuntimeSnapshot,
  insights?: AgentInsightsSource,
): ConsoleAgentRuntime {
  const configuration = new AgentConfigProjection(projectRoot);
  const liveBindings = (): readonly AgentBindingInput[] | undefined => {
    const live = resolveCurrentAgentConsole(getSnapshot())?.listBindings();
    if (!live?.length) return undefined;
    return live.map(binding => ({ name: binding.name, provider: binding.providerAlias, model: binding.model,
      ...(binding.nickname ? { nickname: binding.nickname } : {}),
      ...(Array.isArray((binding as { mcpServers?: unknown }).mcpServers) ? { mcpServers: (binding as unknown as { mcpServers: string[] }).mcpServers } : {}) }));
  };
  return {
    sessionTree: resolveCurrentAgentConsole(getSnapshot())?.sessionTree,
    introspection: {
      commands: () => listGenerationCommands(getSnapshot(), projectRoot),
      middlewares: () => listGenerationMiddlewares(getSnapshot(), projectRoot),
      components: () => listGenerationComponents(getSnapshot(), projectRoot),
      renderComponent: input => renderGenerationComponent(getSnapshot(), input),
      previewComponentDelivery: input => previewGenerationComponentDelivery(getSnapshot(), input),
      // #1250: show what each binding actually runs on (purpose binding), not legacy config fields.
      bindings: async () => projectAgentBindings(
        liveBindings() ?? configuration.listBindings() as unknown as readonly AgentBindingInput[],
        await providerDisplayOf(insights),
      ),
      recentTurns: async () => {
        if (!insights) return [];
        const [traces, display] = await Promise.all([insights.recentTraces(RECENT_TURNS_LIMIT), providerDisplayOf(insights)]);
        // Same string redaction pass as the trace archive routes (credentials in names / keys).
        const { redactStrings } = await import('@zhin.js/agent/trace');
        return redactStrings(projectRecentTurns(traces, display, RECENT_TURNS_LIMIT));
      },
      tools: () => listGenerationTools(getSnapshot(), projectRoot),
      promptSections: () => listGenerationPromptSections(getSnapshot(), projectRoot),
      mcp: () => mergeMcpServers(configuration, getSnapshot()),
      testMcp: async (name: string) => {
        // No Agent in this generation (AI off, or an Agent without the test): 503, not an internal error.
        const test = resolveCurrentAgentIntrospection(getSnapshot())?.testMcpServer;
        if (!test) return 'agent-unavailable' as const;
        return await test(name);
      },
    },
  };
}

export function createAgentRuntimeLeaseResolver(
  projectRoot: string,
  snapshots?: SnapshotReader,
  insights?: AgentInsightsSource,
): (() => { value: ConsoleAgentRuntime; release(): void } | null) | undefined {
  if (!snapshots) return undefined;
  return () => {
    let lease: ReturnType<SnapshotReader['acquire']>;
    try {
      lease = snapshots.acquire();
    } catch {
      return null;
    }
    return {
      value: createAgentRuntime(projectRoot, () => lease.value, insights),
      release: () => lease.release(),
    };
  };
}

/** Configured MCP servers (not connected until the Agent reports them) merged with the Agent's live view. */
export function listMcpServerStatus(projectRoot: string, snapshot: RuntimeSnapshot): readonly Record<string, unknown>[] {
  return mergeMcpServers(new AgentConfigProjection(projectRoot), snapshot).rows;
}

/**
 * Row `status` (#1250), so a "not connected" row always says why:
 * - `connected`: the Agent holds a live connection;
 * - `failed`: the last connect failed — `lastError` carries `{ category, message, exitCode?, at }`;
 *   the only state that goes to the attention inbox;
 * - `idle`: loaded by the Agent but not connected yet — "waiting to connect" (待连接), as in the `ready` log. The
 *   configured servers connect when the generation is activated, so this is the short window before;
 * - `not_loaded`: in the configuration but not loaded by the running Agent (Agent off, or not reloaded yet).
 *
 * Batch 28: the configured servers are generation-owned MCP features. The Agent used to report only
 * its own `resourceHub.mcps` registry, which they never enter, so every configured server read
 * `not_loaded` while the Agent had connected it (`[agent] ready | … | mcp: github`).
 */
export type McpServerRowStatus = 'connected' | 'failed' | 'idle' | 'not_loaded';

function mergeMcpServers(
  configuration: AgentConfigProjection,
  snapshot: RuntimeSnapshot,
): { rows: readonly Record<string, unknown>[] } {
  const rows = new Map<string, Record<string, unknown>>();
  for (const entry of configuration.listMcpServers()) {
    rows.set(entry.name, {
      name: entry.name,
      connected: false,
      toolCount: 0,
      transport: entry.transport,
      status: 'not_loaded' satisfies McpServerRowStatus,
    });
  }
  const introspection = resolveCurrentAgentIntrospection(snapshot);
  for (const entry of introspection?.listMcpServers() ?? []) {
    const configured = rows.get(entry.name);
    const status: McpServerRowStatus = entry.connected ? 'connected' : entry.lastError ? 'failed' : 'idle';
    rows.set(entry.name, {
      name: entry.name,
      connected: entry.connected,
      toolCount: entry.toolCount,
      ...(configured?.transport === undefined ? {} : { transport: configured.transport }),
      status,
      ...(!entry.connected && entry.lastError ? { lastError: entry.lastError } : {}),
    });
  }
  return { rows: [...rows.values()] };
}
