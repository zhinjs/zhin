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
        return projectRecentTurns(traces, display, RECENT_TURNS_LIMIT);
      },
      tools: () => listGenerationTools(getSnapshot(), projectRoot),
      promptSections: () => listGenerationPromptSections(getSnapshot(), projectRoot),
      mcp: () => mergeMcpServers(configuration, getSnapshot()),
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
    });
  }
  const introspection = resolveCurrentAgentIntrospection(snapshot);
  for (const entry of introspection?.listMcpServers() ?? []) {
    rows.set(entry.name, {
      name: entry.name,
      connected: entry.connected,
      toolCount: entry.toolCount,
    });
  }
  return { rows: [...rows.values()] };
}
